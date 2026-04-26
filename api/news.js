import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PORTALS = [
  { id: "g1",      name: "G1",      color: "#e8001c", domain: "g1.globo.com"    },
  { id: "sbt",     name: "SBT",     color: "#00529c", domain: "sbt.com.br"      },
  { id: "estadao", name: "Estadão", color: "#1a1a1a", domain: "estadao.com.br"  },
  { id: "band",    name: "Band",    color: "#f5a623", domain: "band.uol.com.br" },
];

// Cada portal é varrido por estas fatias de categoria.
// Múltiplas buscas em paralelo = cobertura total das 24h sem estourar o limite de tokens por resposta.
const CATEGORY_SLICES = [
  "Política e Economia",
  "Brasil e Mundo",
  "Esportes",
  "Tecnologia e Entretenimento",
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
//  UMA BUSCA: portal + fatia de categoria
// ══════════════════════════════════════════════════════════════════════════════
async function fetchSlice(portal, categorySlice, hoje) {
  const prompt = `Hoje é ${hoje}. Pesquise na web as notícias mais importantes e recentes das últimas 24 horas publicadas no portal ${portal.name} (${portal.domain}) sobre as categorias: ${categorySlice}.

Traga o MÁXIMO de notícias que conseguir encontrar (mínimo 8, sem limite superior).
Responda SOMENTE com um array JSON válido, sem markdown, sem texto extra.
Cada item deve ter exatamente estes campos:
- titulo: string (título original da notícia)
- resumo: string (2-3 frases resumindo o conteúdo)
- categoria: string (Política, Economia, Esportes, Tecnologia, Brasil, Mundo ou Entretenimento)
- link: string (URL completa e real da notícia em ${portal.domain})
- hora: string (ex: "há 2 horas", "há 8 horas" ou "14h30")
- portal: "${portal.name}"
- portalId: "${portal.id}"

Retorne apenas o array JSON puro, sem nenhum texto antes ou depois.`;

  try {
    const response = await client.responses.create({
      model: "gpt-4o-mini",
      tools: [{ type: "web_search_preview" }],
      input: prompt,
    });

    const raw = response.output_text || "";
    const items = extractJsonArray(raw);
    if (!items || items.length === 0) return [];

    return items
      .filter(i => i && i.titulo)
      .map(i => ({
        ...i,
        portal:      portal.name,
        portalId:    portal.id,
        portalColor: portal.color,
        link:        i.link || `https://${portal.domain}`,
      }));
  } catch (e) {
    console.error(`${portal.name} [${categorySlice}]: erro —`, e?.message || e);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  DEDUPLICAÇÃO POR TÍTULO (remove duplicatas entre fatias do mesmo portal)
// ══════════════════════════════════════════════════════════════════════════════
function dedup(items) {
  const seen = new Set();
  return items.filter(item => {
    // Normaliza o título para comparação: minúsculas, sem pontuação, sem espaços duplos
    const key = item.titulo.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
//  BUSCA TODAS AS FATIAS DE UM PORTAL EM PARALELO
// ══════════════════════════════════════════════════════════════════════════════
async function fetchNewsFromPortal(portal) {
  const hoje = new Date().toLocaleDateString("pt-BR");

  // Todas as fatias de categoria em paralelo
  const sliceResults = await Promise.all(
    CATEGORY_SLICES.map(slice => fetchSlice(portal, slice, hoje))
  );

  const raw = sliceResults.flat();
  const unique = dedup(raw);

  console.log(`${portal.name}: ${unique.length} notícias únicas (${raw.length} brutas)`);
  return unique;
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