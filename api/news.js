import OpenAI from "openai";
import axios  from "axios";

const client   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const CHAT_API = "https://mesinhasserver.vercel.app/api/chat";

const PORTALS = [
  { id: "g1",      name: "G1",      color: "#e8001c", domain: "g1.globo.com",      searchHint: "site:g1.globo.com"      },
  { id: "sbt",     name: "SBT",     color: "#00529c", domain: "sbt.com.br",         searchHint: "site:sbt.com.br"         },
  { id: "estadao", name: "Estadão", color: "#1a1a1a", domain: "estadao.com.br",     searchHint: "site:estadao.com.br"     },
  { id: "band",    name: "Band",    color: "#f5a623", domain: "band.uol.com.br",    searchHint: "site:band.uol.com.br"    },
];

// ══════════════════════════════════════════════════════════════════════════════
//  EXTRAI JSON ARRAY
// ══════════════════════════════════════════════════════════════════════════════
function extractJsonArray(raw) {
  let s = (raw || "").trim()
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  const start = s.indexOf("[");
  const end   = s.lastIndexOf("]");
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(s.slice(start, end + 1)); }
  catch { return null; }
}

// ══════════════════════════════════════════════════════════════════════════════
//  BUSCA NOTÍCIAS DE UM PORTAL — ÚLTIMA 1H
// ══════════════════════════════════════════════════════════════════════════════
async function fetchNewsFromPortal(portal) {
  const now  = new Date();
  const hora = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const hoje = now.toLocaleDateString("pt-BR");

  const prompt = `Agora são ${hora} de ${hoje} (horário de Brasília).

Faça uma busca web usando "${portal.searchHint}" para encontrar as notícias MAIS RECENTES publicadas nos últimos 60 minutos no portal ${portal.name}.

REGRAS OBRIGATÓRIAS:
1. SOMENTE notícias publicadas ou atualizadas nos últimos 60 minutos. Se não houver suficientes, expanda para 2 horas. NUNCA inclua notícias de ontem ou mais antigas.
2. Busque ativamente nas seções: home, últimas notícias, breaking news do ${portal.domain}.
3. Verifique o timestamp de cada notícia — inclua apenas as com "há X minutos" ou "há 1 hora" ou horário compatível com os últimos 60min.
4. Traga o MÁXIMO possível de notícias (mínimo 5, sem limite máximo).
5. Os links devem ser URLs REAIS e completas do ${portal.domain} — não invente links.

Responda SOMENTE com um array JSON válido, sem markdown, sem texto extra:
[{"titulo":"...","resumo":"2-3 frases do conteúdo real","categoria":"Política|Economia|Esportes|Tecnologia|Brasil|Mundo|Entretenimento","link":"https://${portal.domain}/...","hora":"há X minutos","portal":"${portal.name}","portalId":"${portal.id}"}]`;

  try {
    const response = await client.responses.create({
      model: "gpt-4o-mini",
      tools: [{ type: "web_search_preview" }],
      tool_choice: { type: "web_search_preview" },
      input: prompt,
    });

    const raw   = response.output_text || "";
    const items = extractJsonArray(raw);
    if (!items || items.length === 0) {
      console.warn(`${portal.name}: sem itens JSON na resposta`);
      return [];
    }

    const result = items
      .filter(i => i && i.titulo && i.titulo.length > 5)
      .map(i => ({
        ...i,
        portal:      portal.name,
        portalId:    portal.id,
        portalColor: portal.color,
        link:        i.link?.startsWith("http") ? i.link : `https://${portal.domain}`,
      }));

    console.log(`${portal.name}: ${result.length} notícias da última 1h`);
    return result;

  } catch (e) {
    console.error(`${portal.name}: erro —`, e?.message || e);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  DEDUPLICAÇÃO POR TÍTULO
// ══════════════════════════════════════════════════════════════════════════════
function dedup(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.titulo.toLowerCase().replace(/[^\wÀ-ú\s]/g, "").replace(/\s+/g, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
//  AGRUPAMENTO SEMÂNTICO VIA IA (Cerebras via /api/chat existente)
// ══════════════════════════════════════════════════════════════════════════════
async function groupByTopicAI(allNews) {
  if (allNews.length === 0) return [];

  const lista = allNews.map((n, i) => `${i}: [${n.portalId.toUpperCase()}] ${n.titulo}`).join("\n");

  const prompt = `Você é um editor de jornalismo. Abaixo há uma lista numerada de títulos de notícias de diferentes portais brasileiros publicadas na última hora.

Agrupe os títulos que cobrem EXATAMENTE O MESMO FATO ou evento. Dois títulos só devem estar no mesmo grupo se tratam do mesmo acontecimento específico — não agrupe por tema geral (ex: "futebol" não é grupo; tem que ser o mesmo jogo ou anúncio específico).

Títulos:
${lista}

Responda SOMENTE com um array JSON onde cada elemento é um array de índices do mesmo grupo:
[[0,3,7],[1],[2,5],[4,6,8],...]

Regras:
- Cada índice deve aparecer exatamente uma vez
- Grupos com um único item são normais e esperados
- Não agrupe por tema amplo, apenas por fato específico idêntico
- Retorne apenas o JSON puro, sem texto antes ou depois`;

  try {
    const res = await axios.post(
      CHAT_API,
      { message: prompt, forceEngine: "cerebras" },
      { headers: { "Content-Type": "application/json" }, timeout: 30000 }
    );

    const raw    = res.data?.reply || "";
    const groups = extractJsonArray(raw);

    if (!groups || !Array.isArray(groups) || groups.length === 0) {
      console.warn("groupByTopicAI: resposta inválida — usando fallback");
      return groupByTopicFallback(allNews);
    }

    const usedIndices = new Set();
    const result = [];

    for (const group of groups) {
      if (!Array.isArray(group)) continue;
      const valid = group.filter(i => Number.isInteger(i) && i >= 0 && i < allNews.length && !usedIndices.has(i));
      if (valid.length === 0) continue;
      valid.forEach(i => usedIndices.add(i));
      result.push({
        id:        `g${result.length}`,
        items:     valid.map(i => allNews[i]),
        categoria: allNews[valid[0]].categoria,
      });
    }

    // Itens não incluídos pelo modelo (segurança)
    for (let i = 0; i < allNews.length; i++) {
      if (!usedIndices.has(i)) {
        result.push({ id: `g${result.length}`, items: [allNews[i]], categoria: allNews[i].categoria });
      }
    }

    return result.sort((a, b) => b.items.length - a.items.length);

  } catch (e) {
    console.warn("groupByTopicAI: erro —", e?.message, "— usando fallback");
    return groupByTopicFallback(allNews);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  FALLBACK: agrupamento por palavras (caso Cerebras falhe)
// ══════════════════════════════════════════════════════════════════════════════
function groupByTopicFallback(allNews) {
  const groups = [];
  const used   = new Set();
  const stop   = new Set([
    "de","do","da","dos","das","no","na","nos","nas","em","com","que","por",
    "para","os","as","um","uma","ao","à","é","e","o","a","se","já","após",
    "mais","sobre","pelo","pela","entre","isso","este","essa","seus","suas",
  ]);

  for (let i = 0; i < allNews.length; i++) {
    if (used.has(i)) continue;
    const item  = allNews[i];
    const group = { id: `g${i}`, items: [item], categoria: item.categoria };
    used.add(i);

    for (let j = i + 1; j < allNews.length; j++) {
      if (used.has(j)) continue;
      const other  = allNews[j];
      if (other.portalId === item.portalId) continue;
      const wA     = item.titulo.toLowerCase().split(/\W+/).filter(w => w.length > 4 && !stop.has(w));
      const wB     = other.titulo.toLowerCase().split(/\W+/).filter(w => w.length > 4 && !stop.has(w));
      const shared = wA.filter(w => wB.includes(w));
      if (shared.length >= 3) {
        group.items.push(other);
        used.add(j);
      }
    }

    groups.push(group);
  }

  return groups.sort((a, b) => b.items.length - a.items.length);
}

// ══════════════════════════════════════════════════════════════════════════════
//  HANDLER PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Método não permitido" });

  try {
    // 1. Busca os 4 portais em paralelo
    const results = await Promise.all(PORTALS.map(fetchNewsFromPortal));
    const allNews = dedup(results.flat());

    console.log(`Total após dedup: ${allNews.length} notícias`);

    if (allNews.length === 0)
      return res.status(503).json({
        error: "Nenhuma notícia encontrada na última hora. Tente novamente em alguns minutos.",
      });

    // 2. Agrupamento semântico via Cerebras
    const groups = await groupByTopicAI(allNews);

    return res.status(200).json({
      groups,
      allNews,
      portals: PORTALS,
      fetchedAt: new Date().toISOString(),
      total: allNews.length,
    });

  } catch (err) {
    console.error("ERRO /api/news:", err?.message || err);
    return res.status(500).json({ error: "Erro interno ao buscar notícias." });
  }
}