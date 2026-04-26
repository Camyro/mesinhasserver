// api/news.js — Vercel/Express serverless function
// Busca notícias dos portais via mesinhasserver/api/chat com web search

const axios = require("axios");

const CHAT_API = "https://mesinhasserver/api/chat";

const PORTALS = [
  { id: "g1",      name: "G1",      color: "#e8001c", logo: "G1",     domain: "g1.globo.com"    },
  { id: "sbt",     name: "SBT",     color: "#00529c", logo: "SBT",    domain: "sbt.com.br"      },
  { id: "estadao", name: "Estadão", color: "#1a1a1a", logo: "Est.",    domain: "estadao.com.br"  },
  { id: "band",    name: "Band",    color: "#f5a623", logo: "Band",    domain: "band.uol.com.br" },
];

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
      {
        message: prompt,
        forceEngine: "mistral",
        webSearch: true,
      },
      { timeout: 45000, headers: { "Content-Type": "application/json" } }
    );

    const raw = res.data?.reply || "";

    // Tenta extrair JSON da resposta
    let jsonStr = raw.trim();
    // Remove markdown se houver
    jsonStr = jsonStr.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    // Pega só o array
    const start = jsonStr.indexOf("[");
    const end = jsonStr.lastIndexOf("]");
    if (start === -1 || end === -1) throw new Error("JSON array não encontrado");
    jsonStr = jsonStr.slice(start, end + 1);

    const items = JSON.parse(jsonStr);

    return items
      .filter((i) => i && i.titulo)
      .slice(0, 6)
      .map((i) => ({
        ...i,
        portal: portal.name,
        portalId: portal.id,
        portalColor: portal.color,
        link: i.link || `https://${portal.domain}`,
      }));
  } catch (e) {
    console.error(`Erro ao buscar ${portal.name}:`, e.message);
    return [];
  }
}

function groupByTopic(allNews) {
  // Agrupa notícias do mesmo assunto entre portais diferentes
  const groups = [];
  const used = new Set();

  for (let i = 0; i < allNews.length; i++) {
    if (used.has(i)) continue;
    const item = allNews[i];
    const group = { id: `g${i}`, items: [item], tema: item.titulo.slice(0, 50), categoria: item.categoria };
    used.add(i);

    // Encontra notícias similares (mesmo assunto em portais diferentes)
    for (let j = i + 1; j < allNews.length; j++) {
      if (used.has(j)) continue;
      const other = allNews[j];
      if (other.portalId === item.portalId) continue; // mesmo portal, pula

      const tituloA = item.titulo.toLowerCase();
      const tituloB = other.titulo.toLowerCase();

      // Palavras-chave em comum (ignora stop words)
      const stopWords = new Set(["de","do","da","dos","das","no","na","nos","nas","em","com","que","por","para","os","as","um","uma","ao","à","é","e","o","a"]);
      const wordsA = tituloA.split(/\W+/).filter(w => w.length > 3 && !stopWords.has(w));
      const wordsB = tituloB.split(/\W+/).filter(w => w.length > 3 && !stopWords.has(w));
      const shared = wordsA.filter(w => wordsB.includes(w));

      if (shared.length >= 2 || (shared.length >= 1 && item.categoria === other.categoria)) {
        group.items.push(other);
        used.add(j);
      }
    }

    groups.push(group);
  }

  // Ordena: grupos com mais portais primeiro
  return groups.sort((a, b) => b.items.length - a.items.length);
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // Busca todos os portais em paralelo
    const results = await Promise.all(PORTALS.map(fetchNewsFromPortal));
    const allNews = results.flat();

    if (allNews.length === 0) {
      return res.status(503).json({ error: "Nenhuma notícia encontrada. Tente novamente." });
    }

    const groups = groupByTopic(allNews);

    return res.status(200).json({
      groups,
      allNews,
      portals: PORTALS,
      fetchedAt: new Date().toISOString(),
      total: allNews.length,
    });
  } catch (err) {
    console.error("ERRO /api/news:", err.message);
    return res.status(500).json({ error: "Erro interno ao buscar notícias." });
  }
};