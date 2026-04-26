import axios from "axios";

const CHAT_API = "https://mesinhasserver.vercel.app/api/chat";

// ══════════════════════════════════════════════════════════════════════════════
//  PORTAIS — feeds verificados e ativos
//  G1, Estadão, R7 e Folha têm RSS públicos e estáveis.
//  SBT antigo (sbt.com.br/jornalismo/rss) estava morto — trocado por R7.
//  Band bloqueava requests de servidor — trocado por Folha (emcimadahora).
// ══════════════════════════════════════════════════════════════════════════════
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
    id:    "estadao",
    name:  "Estadão",
    color: "#003399",
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
    id:    "r7",
    name:  "R7",
    color: "#cc0000",
    domain: "r7.com",
    feeds: [
      "https://noticias.r7.com/feed.xml",
    ],
  },
  {
    id:    "folha",
    name:  "Folha",
    color: "#0066cc",
    domain: "folha.uol.com.br",
    feeds: [
      "https://feeds.folha.uol.com.br/emcimadahora/rss091.xml",
      "https://feeds.folha.uol.com.br/poder/rss091.xml",
      "https://feeds.folha.uol.com.br/mercado/rss091.xml",
      "https://feeds.folha.uol.com.br/esporte/rss091.xml",
      "https://feeds.folha.uol.com.br/mundo/rss091.xml",
    ],
  },
];

// ══════════════════════════════════════════════════════════════════════════════
//  PARSE RSS — sem dependência externa
// ══════════════════════════════════════════════════════════════════════════════
function parseRSS(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const b = m[1];
    const get = (tag) => {
      const cd = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`, "i").exec(b);
      if (cd) return cd[1].trim();
      const pl = new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, "i").exec(b);
      return pl ? pl[1].trim() : "";
    };
    const title   = get("title");
    const link    = get("link") || get("guid");
    const pubDate = get("pubDate") || get("dc:date") || get("pubdate");
    const desc    = get("description");
    if (title && link) items.push({ title, link, pubDate, desc });
  }
  return items;
}

// ══════════════════════════════════════════════════════════════════════════════
//  FETCH DE UM FEED
// ══════════════════════════════════════════════════════════════════════════════
async function fetchFeed(url) {
  try {
    const res = await axios.get(url, {
      timeout: 12000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Accept":     "application/rss+xml, application/xml, text/xml, */*",
      },
    });
    return parseRSS(typeof res.data === "string" ? res.data : String(res.data));
  } catch (e) {
    console.warn(`Feed falhou (${url}): ${e.message}`);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  CATEGORIA POR LINK / TÍTULO
// ══════════════════════════════════════════════════════════════════════════════
function detectCategory(title, link) {
  const t = (title + " " + link).toLowerCase();
  if (/politi|congresso|senado|câmara|ministro|governo|presidente|eleicao|partido|lula|bolsonaro/.test(t)) return "Política";
  if (/economi|mercado|bolsa|dolar|inflacao|pib|juros|banco|empresa|negocio|petrobras|receita/.test(t))    return "Economia";
  if (/futebol|esporte|campeonato|copa|olimpi|atleta|gol|nba|nfl|tênis|basquete|vôlei/.test(t))            return "Esportes";
  if (/tecnolog|inteligencia artificial|startup|celular|iphone|android|internet|app|ia |openai/.test(t))   return "Tecnologia";
  if (/mundo|internacional|guerra|eua|trump|china|russia|europa|oriente|africa|argentina/.test(t))         return "Mundo";
  if (/entreteni|cinema|musica|serie|celebr|famoso|show|festival|arte|novela|bbb/.test(t))                 return "Entretenimento";
  return "Brasil";
}

// ══════════════════════════════════════════════════════════════════════════════
//  FILTRO DE TEMPO
// ══════════════════════════════════════════════════════════════════════════════
function withinHours(pubDate, hours) {
  if (!pubDate) return true;
  try {
    const d = new Date(pubDate);
    return !isNaN(d) && (Date.now() - d.getTime()) <= hours * 3_600_000;
  } catch { return true; }
}

function formatAge(pubDate) {
  if (!pubDate) return "";
  try {
    const diff = Math.floor((Date.now() - new Date(pubDate).getTime()) / 60000);
    if (diff < 1)  return "agora mesmo";
    if (diff < 60) return `há ${diff} min`;
    const h = Math.floor(diff / 60);
    return h === 1 ? "há 1h" : `há ${h}h`;
  } catch { return ""; }
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
//  BUSCA UM PORTAL — todos os feeds em paralelo, filtra 1h (fallback 3h)
// ══════════════════════════════════════════════════════════════════════════════
async function fetchPortalNews(portal) {
  const feedResults = await Promise.all(portal.feeds.map(fetchFeed));
  const all = feedResults.flat();

  let filtered = all.filter(i => withinHours(i.pubDate, 1));
  if (filtered.length < 3) {
    filtered = all.filter(i => withinHours(i.pubDate, 3));
    console.log(`${portal.name}: poucos itens em 1h, expandindo para 3h`);
  }

  const news = filtered.map(item => ({
    titulo:      item.title,
    resumo:      item.desc
                   ? item.desc.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 300)
                   : item.title,
    categoria:   detectCategory(item.title, item.link),
    link:        item.link,
    hora:        formatAge(item.pubDate),
    pubDate:     item.pubDate,
    portal:      portal.name,
    portalId:    portal.id,
    portalColor: portal.color,
  }));

  news.sort((a, b) => {
    const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return db - da;
  });

  console.log(`${portal.name}: ${news.length} notícias (${all.length} brutas no feed)`);
  return news;
}

// ══════════════════════════════════════════════════════════════════════════════
//  AGRUPAMENTO SEMÂNTICO VIA CEREBRAS
// ══════════════════════════════════════════════════════════════════════════════
async function groupByTopicAI(allNews) {
  if (allNews.length === 0) return [];

  const lista = allNews.map((n, i) => `${i}: [${n.portalId.toUpperCase()}] ${n.titulo}`).join("\n");

  const prompt = `Você é um editor de jornalismo. Lista de notícias recentes de portais brasileiros:

${lista}

Agrupe APENAS os índices que cobrem exatamente o MESMO FATO específico (mesmo acidente, jogo, pronunciamento, lei). Não agrupe por tema amplo — "futebol" não é grupo, precisa ser o mesmo jogo.

Responda SOMENTE com JSON puro — array de arrays de índices:
[[0,3],[1],[2,5,8],[4],...]

Cada índice aparece exatamente uma vez. Sem texto antes ou depois.`;

  try {
    const res = await axios.post(
      CHAT_API,
      { message: prompt, forceEngine: "cerebras" },
      { headers: { "Content-Type": "application/json" }, timeout: 25000 }
    );

    const raw = res.data?.reply || "";
    let s = raw.trim().replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const st = s.indexOf("["), en = s.lastIndexOf("]");
    if (st === -1 || en === -1) throw new Error("sem JSON");
    const groups = JSON.parse(s.slice(st, en + 1));

    const used   = new Set();
    const result = [];

    for (const g of groups) {
      if (!Array.isArray(g)) continue;
      const valid = g.filter(i => Number.isInteger(i) && i >= 0 && i < allNews.length && !used.has(i));
      if (!valid.length) continue;
      valid.forEach(i => used.add(i));
      result.push({ id: `g${result.length}`, items: valid.map(i => allNews[i]), categoria: allNews[valid[0]].categoria });
    }

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
//  FALLBACK: agrupamento por palavras (sem IA)
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
    const results = await Promise.all(PORTALS.map(fetchPortalNews));
    const allNews = dedup(results.flat());

    console.log(`Total após dedup: ${allNews.length} notícias`);

    if (allNews.length === 0)
      return res.status(503).json({ error: "Feeds indisponíveis no momento. Tente novamente." });

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