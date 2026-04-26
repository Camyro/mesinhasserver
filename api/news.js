import axios from "axios";

const CHAT_API = "https://mesinhasserver/api/chat";

const PORTALS = [
  { id: "g1",      name: "G1",      color: "#e8001c", domain: "g1.globo.com"    },
  { id: "sbt",     name: "SBT",     color: "#00529c", domain: "sbt.com.br"      },
  { id: "estadao", name: "Estadão", color: "#1a1a1a", domain: "estadao.com.br"  },
  { id: "band",    name: "Band",    color: "#f5a623", domain: "band.uol.com.br" },
];

// ══════════════════════════════════════════════════════════════════════════════
//  BUSCA NOTÍCIAS DE UM PORTAL VIA MISTRAL + WEB SEARCH
// ══════════════════════════════════════════════════════════════════════════════
async function fetchNewsFromPortal(portal) {
  const prompt = `Busque as 6 notícias mais recentes e importantes do portal ${portal.name} (${portal.domain}).
Para cada notícia retorne um JSON com os campos:
- titulo: string
- resumo: string (2-3 frases)
- categoria: string (ex: Política, Economia, Esportes, Tecnologia, Brasil, Mundo, Entretenimento)
- link: string (URL real da notícia no ${portal.domain})
- hora: string (quando foi publicada, ex: "há 2 horas" ou horário)
- portal: "${portal.name}"
- portalId: "${portal.id}"

Responda SOMENTE com um array JSON válido, sem markdown, sem explicações, sem texto extra.
Exemplo: [{"titulo":"...", "resumo":"...", "categoria":"...", "link":"...", "hora":"...", "portal":"${portal.name}", "portalId":"${portal.id}"}]`;

  try {
    const res = await axios.post(
      CHAT_API,
      { message: prompt, forceEngine: "mistral", webSearch: true },
      { headers: { "Content-Type": "application/json" }, timeout: 50000 }
    );

    const raw = res.data?.reply || "";
    let jsonStr = raw.trim()
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();

    const start = jsonStr.indexOf("[");
    const end   = jsonStr.lastIndexOf("]");
    if (start === -1 || end === -1) throw new Error("JSON array não encontrado na resposta");
    jsonStr = jsonStr.slice(start, end + 1);

    const items = JSON.parse(jsonStr);

    return items
      .filter((i) => i && i.titulo)
      .slice(0, 6)
      .map((i) => ({
        ...i,
        portal:      portal.name,
        portalId:    portal.id,
        portalColor: portal.color,
        link:        i.link || `https://${portal.domain}`,
      }));
  } catch (e) {
    console.error(`Erro ao buscar ${portal.name}:`, e.message);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  AGRUPAMENTO POR ASSUNTO
// ══════════════════════════════════════════════════════════════════════════════
function groupByTopic(allNews) {
  const groups = [];
  const used   = new Set();
  const stopWords = new Set([
    "de","do","da","dos","das","no","na","nos","nas","em","com",
    "que","por","para","os","as","um","uma","ao","à","é","e","o","a",
    "se","já","após","mais","sobre","pelo","pela","entre","isso","este",
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
    return res.status(405).json({ error: "Método não permitido", model: "-" });

  try {
    const results = await Promise.all(PORTALS.map(fetchNewsFromPortal));
    const allNews = results.flat();

    if (allNews.length === 0)
      return res.status(503).json({ error: "Nenhuma notícia encontrada. Tente novamente." });

    const groups = groupByTopic(allNews);

    return res.status(200).json({
      groups,
      allNews,
      portals: PORTALS,
      fetchedAt: new Date().toISOString(),
      total: allNews.length,
    });
  } catch (err) {
    console.error("ERRO /api/news:", err?.response?.data || err.message || err);
    return res.status(500).json({ error: "Erro interno ao buscar notícias." });
  }
}