import axios from "axios";

const CHAT_API = "https://mesinhasserver.vercel.app/api/chat";

const PORTALS = [
  {
    id:    "g1",
    name:  "G1",
    color: "#e8001c",
    domain: "g1.globo.com",
    feeds: [
      "https://g1.globo.com/rss/g1/",
      "https://g1.globo.com/rss/g1/politica/",
      "https://g1.globo.com/rss/g1/economia/",
      "https://g1.globo.com/rss/g1/mundo/",
      "https://g1.globo.com/rss/g1/esportes/",
      "https://g1.globo.com/rss/g1/tecnologia/",
    ],
  },
  {
    id:    "sbt",
    name:  "SBT",
    color: "#00529c",
    domain: "sbt.com.br",
    feeds: [
      "https://www.sbt.com.br/jornalismo/rss",
    ],
  },
  {
    id:    "estadao",
    name:  "Estadão",
    color: "#1a1a1a",
    domain: "estadao.com.br",
    feeds: [
      "https://estadao.com.br/arc/outboundfeeds/rss/",
      "https://estadao.com.br/arc/outboundfeeds/rss/?hierarchy=politica",
      "https://estadao.com.br/arc/outboundfeeds/rss/?hierarchy=economia",
      "https://estadao.com.br/arc/outboundfeeds/rss/?hierarchy=esportes",
      "https://estadao.com.br/arc/outboundfeeds/rss/?hierarchy=internacional",
    ],
  },
  {
    id:    "band",
    name:  "Band",
    color: "#f5a623",
    domain: "band.uol.com.br",
    feeds: [
      "https://www.band.uol.com.br/noticias/rss",
    ],
  },
];

// ══════════════════════════════════════════════════════════════════════════════
//  PARSE RSS — extrai itens do XML sem dependência externa
// ══════════════════════════════════════════════════════════════════════════════
function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];

    const get = (tag) => {
      // Tenta com CDATA primeiro, depois texto simples
      const cdataRe = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`, "i");
      const plainRe = new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, "i");
      const c = cdataRe.exec(block);
      if (c) return c[1].trim();
      const p = plainRe.exec(block);
      return p ? p[1].trim() : "";
    };

    const title   = get("title");
    const link    = get("link") || get("guid");
    const pubDate = get("pubDate");
    const desc    = get("description");

    if (!title || !link) continue;

    items.push({ title, link, pubDate, desc });
  }

  return items;
}

// ══════════════════════════════════════════════════════════════════════════════
//  FETCH DE UM FEED RSS
// ══════════════════════════════════════════════════════════════════════════════
async function fetchFeed(url) {
  try {
    const res = await axios.get(url, {
      timeout: 10000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NewsAggregator/1.0)",
        "Accept": "application/rss+xml, application/xml, text/xml, */*",
      },
    });
    return parseRSS(res.data || "");
  } catch (e) {
    console.warn(`Feed falhou (${url}): ${e.message}`);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  DETECTA CATEGORIA PELO LINK / TÍTULO
// ══════════════════════════════════════════════════════════════════════════════
function detectCategory(title, link) {
  const t = (title + " " + link).toLowerCase();
  if (/politi|congresso|senado|câmara|ministro|governo|presidente|eleicao|partido/.test(t)) return "Política";
  if (/economi|mercado|bolsa|dolar|inflacao|pib|juros|banco|empresa|negocio/.test(t))        return "Economia";
  if (/futebol|esporte|campeonato|copa|olimpi|atleta|jogo|placar|gol|nba|nfl/.test(t))       return "Esportes";
  if (/tecnolog|inteligencia|ia|startup|celular|iphone|android|internet|app/.test(t))        return "Tecnologia";
  if (/mundo|internacional|guerra|eua|china|russia|europa|oriente|africa/.test(t))           return "Mundo";
  if (/entreteni|cinema|musica|serie|celebr|famoso|show|festival|arte/.test(t))              return "Entretenimento";
  return "Brasil";
}

// ══════════════════════════════════════════════════════════════════════════════
//  FILTRA NOTÍCIAS DAS ÚLTIMAS N HORAS
// ══════════════════════════════════════════════════════════════════════════════
function withinHours(pubDate, hours) {
  if (!pubDate) return true; // sem data = inclui por segurança
  try {
    const d = new Date(pubDate);
    if (isNaN(d.getTime())) return true;
    return (Date.now() - d.getTime()) <= hours * 3_600_000;
  } catch {
    return true;
  }
}

function formatAge(pubDate) {
  if (!pubDate) return "";
  try {
    const diff = Math.floor((Date.now() - new Date(pubDate).getTime()) / 60000);
    if (diff < 1)  return "agora mesmo";
    if (diff < 60) return `há ${diff} min`;
    const h = Math.floor(diff / 60);
    return `há ${h}h`;
  } catch {
    return "";
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
//  BUSCA TODOS OS FEEDS DE UM PORTAL E FILTRA ÚLTIMA 1H (fallback 3h)
// ══════════════════════════════════════════════════════════════════════════════
async function fetchPortalNews(portal) {
  const feedResults = await Promise.all(portal.feeds.map(fetchFeed));
  const allItems = feedResults.flat();

  // Tenta 1h primeiro; se vier vazio, aceita 3h
  let filtered = allItems.filter(i => withinHours(i.pubDate, 1));
  if (filtered.length < 3) filtered = allItems.filter(i => withinHours(i.pubDate, 3));

  const news = filtered.map(item => ({
    titulo:     item.title,
    resumo:     item.desc
                  ? item.desc.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 300)
                  : item.title,
    categoria:  detectCategory(item.title, item.link),
    link:       item.link,
    hora:       formatAge(item.pubDate),
    pubDate:    item.pubDate,
    portal:     portal.name,
    portalId:   portal.id,
    portalColor: portal.color,
  }));

  // Ordena mais recentes primeiro
  news.sort((a, b) => {
    const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return db - da;
  });

  console.log(`${portal.name}: ${news.length} notícias (de ${allItems.length} no feed)`);
  return news;
}

// ══════════════════════════════════════════════════════════════════════════════
//  AGRUPAMENTO SEMÂNTICO VIA CEREBRAS
// ══════════════════════════════════════════════════════════════════════════════
async function groupByTopicAI(allNews) {
  if (allNews.length === 0) return [];

  const lista = allNews
    .map((n, i) => `${i}: [${n.portalId.toUpperCase()}] ${n.titulo}`)
    .join("\n");

  const prompt = `Você é um editor de jornalismo. Liste de títulos de notícias brasileiras recentes de diferentes portais:

${lista}

Agrupe os índices que cobrem EXATAMENTE O MESMO FATO específico. Não agrupe por tema geral — só pelo mesmo acontecimento concreto (mesmo acidente, mesmo jogo, mesmo pronunciamento, mesma lei).

Responda SOMENTE com JSON puro — array de arrays de índices:
[[0,3],[1],[2,5,8],[4],...]

Cada índice aparece exatamente uma vez. Sem texto antes ou depois.`;

  try {
    const res = await axios.post(
      CHAT_API,
      { message: prompt, forceEngine: "cerebras" },
      { headers: { "Content-Type": "application/json" }, timeout: 25000 }
    );

    const raw    = res.data?.reply || "";
    const groups = (() => {
      // extractJsonArray inline
      let s = raw.trim().replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
      const st = s.indexOf("["), en = s.lastIndexOf("]");
      if (st === -1 || en === -1) return null;
      try { return JSON.parse(s.slice(st, en + 1)); } catch { return null; }
    })();

    if (!groups || !Array.isArray(groups)) throw new Error("JSON inválido");

    const used   = new Set();
    const result = [];

    for (const group of groups) {
      if (!Array.isArray(group)) continue;
      const valid = group.filter(i => Number.isInteger(i) && i >= 0 && i < allNews.length && !used.has(i));
      if (!valid.length) continue;
      valid.forEach(i => used.add(i));
      result.push({ id: `g${result.length}`, items: valid.map(i => allNews[i]), categoria: allNews[valid[0]].categoria });
    }

    // Itens que o modelo não colocou em nenhum grupo
    for (let i = 0; i < allNews.length; i++) {
      if (!used.has(i))
        result.push({ id: `g${result.length}`, items: [allNews[i]], categoria: allNews[i].categoria });
    }

    return result.sort((a, b) => b.items.length - a.items.length);

  } catch (e) {
    console.warn("groupByTopicAI falhou, usando fallback:", e.message);
    return groupFallback(allNews);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  FALLBACK: agrupamento por palavras-chave (sem IA)
// ══════════════════════════════════════════════════════════════════════════════
function groupFallback(allNews) {
  const stop = new Set([
    "de","do","da","dos","das","no","na","nos","nas","em","com","que","por",
    "para","os","as","um","uma","ao","à","é","e","o","a","se","já","após",
    "mais","sobre","pelo","pela","entre","isso","este","essa","seus","suas",
  ]);
  const used   = new Set();
  const result = [];

  for (let i = 0; i < allNews.length; i++) {
    if (used.has(i)) continue;
    const group = { id: `g${i}`, items: [allNews[i]], categoria: allNews[i].categoria };
    used.add(i);
    const wA = allNews[i].titulo.toLowerCase().split(/\W+/).filter(w => w.length > 4 && !stop.has(w));

    for (let j = i + 1; j < allNews.length; j++) {
      if (used.has(j) || allNews[j].portalId === allNews[i].portalId) continue;
      const wB = allNews[j].titulo.toLowerCase().split(/\W+/).filter(w => w.length > 4 && !stop.has(w));
      if (wA.filter(w => wB.includes(w)).length >= 3) {
        group.items.push(allNews[j]);
        used.add(j);
      }
    }
    result.push(group);
  }

  return result.sort((a, b) => b.items.length - a.items.length);
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
    // 1. Todos os portais em paralelo via RSS
    const results = await Promise.all(PORTALS.map(fetchPortalNews));
    const allNews = dedup(results.flat());

    console.log(`Total: ${allNews.length} notícias após dedup`);

    if (allNews.length === 0)
      return res.status(503).json({ error: "Feeds RSS indisponíveis no momento. Tente novamente." });

    // 2. Agrupamento semântico via Cerebras
    const groups = await groupByTopicAI(allNews);

    return res.status(200).json({
      groups,
      allNews,
      portals:   PORTALS,
      fetchedAt: new Date().toISOString(),
      total:     allNews.length,
    });

  } catch (err) {
    console.error("ERRO /api/news:", err?.message || err);
    return res.status(500).json({ error: "Erro interno." });
  }
}