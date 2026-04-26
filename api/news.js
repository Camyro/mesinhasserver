import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PORTALS = [
  { id: "g1",      name: "G1",      color: "#e8001c", domain: "g1.globo.com"    },
  { id: "sbt",     name: "SBT",     color: "#00529c", domain: "sbt.com.br"      },
  { id: "estadao", name: "Estadão", color: "#1a1a1a", domain: "estadao.com.br"  },
  { id: "band",    name: "Band",    color: "#f5a623", domain: "band.uol.com.br" },
];

// ══════════════════════════════════════════════════════════════════════════════
//  EXTRAI JSON ARRAY DA RESPOSTA DO MODELO
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
//  BUSCA NOTÍCIAS DE UM PORTAL VIA OPENAI + WEB SEARCH
// ══════════════════════════════════════════════════════════════════════════════
async function fetchNewsFromPortal(portal) {
  const hoje = new Date().toLocaleDateString("pt-BR");

  const prompt = `Hoje é ${hoje}. Pesquise na web as 6 notícias mais recentes publicadas na última 1 hora (ou nas últimas 6 horas se não houver suficientes) no portal ${portal.name} (${portal.domain}).

Responda SOMENTE com um array JSON válido, sem markdown, sem texto extra.
Cada item deve ter exatamente estes campos:
- titulo: string (título original da notícia)
- resumo: string (2-3 frases resumindo o conteúdo)
- categoria: string (Política, Economia, Esportes, Tecnologia, Brasil, Mundo ou Entretenimento)
- link: string (URL completa e real da notícia em ${portal.domain})
- hora: string (ex: "há 2 horas" ou "14h30")
- portal: "${portal.name}"
- portalId: "${portal.id}"

Retorne apenas o array JSON puro, sem nenhum texto antes ou depois.`;

  try {
    const response = await client.responses.create({
      model: "gpt-4o-mini",
      tools: [{ type: "web_search_preview" }],
      input: prompt,
    });

    // Extrai o texto da resposta (output_text já é o conteúdo final)
    const raw = response.output_text || "";

    const items = extractJsonArray(raw);
    if (items && items.length > 0) {
      console.log(`${portal.name}: ${items.length} notícias encontradas`);
      return items
        .filter(i => i && i.titulo)
        .slice(0, 6)
        .map(i => ({
          ...i,
          portal:      portal.name,
          portalId:    portal.id,
          portalColor: portal.color,
          link:        i.link || `https://${portal.domain}`,
        }));
    }

    console.warn(`${portal.name}: resposta sem JSON válido`);
    return [];

  } catch (e) {
    console.error(`${portal.name}: erro na busca —`, e?.message || e);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  AGRUPAMENTO POR ASSUNTO (igual ao original, sem alteração)
// ══════════════════════════════════════════════════════════════════════════════
function groupByTopic(allNews) {
  const groups   = [];
  const used     = new Set();
  const stopWords = new Set([
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
      const other = allNews[j];
      if (other.portalId === item.portalId) continue;

      const wordsA = item.titulo.toLowerCase().split(/\W+/).filter(w => w.length > 3 && !stopWords.has(w));
      const wordsB = other.titulo.toLowerCase().split(/\W+/).filter(w => w.length > 3 && !stopWords.has(w));
      const shared = wordsA.filter(w => wordsB.includes(w));

      if (shared.length >= 2 || (shared.length >= 1 && item.categoria === other.categoria)) {
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
    // Busca os 4 portais em paralelo
    const results = await Promise.all(PORTALS.map(fetchNewsFromPortal));
    const allNews = results.flat();

    console.log(`Total de notícias coletadas: ${allNews.length}`);

    if (allNews.length === 0)
      return res.status(503).json({
        error: "Nenhuma notícia encontrada. Verifique a chave OPENAI_API_KEY ou tente novamente.",
      });

    const groups = groupByTopic(allNews);

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