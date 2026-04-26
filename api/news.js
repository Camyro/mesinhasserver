import axios from "axios";

const CHAT_API = "https://mesinhasserver.vercel.app/api/chat";

// ══════════════════════════════════════════════════════════════════════════════
//  PROXY RSS — rss2json.com (gratuito, sem auth, 10k req/dia).
//  Portais que bloqueiam requisições diretas de servidor usam esse proxy.
//  Se o proxy falhar, tenta direto como fallback.
// ══════════════════════════════════════════════════════════════════════════════
const RSS2JSON = "https://api.rss2json.com/v1/api.json?rss_url=";

// ══════════════════════════════════════════════════════════════════════════════
//  PORTAIS — feeds verificados (abril 2026)
//
//  proxy: false  → fetch direto (G1, Folha, R7, JP, Gazeta do Povo)
//  proxy: true   → via rss2json.com (Estadão, UOL, Olhar Digital, Correio, TecMundo)
//
//  Feeds confirmados como ativos via feeder.co e GitHub awesome-rss-feeds:
//   UOL     → http://rss.home.uol.com.br/index.xml (atualizado há 1h hoje)
//   OD      → https://olhardigital.com.br/feed/     (atualizado há 28min hoje)
//   Correio → https://www.correiobraziliense.com.br/feed (WordPress)
//   Estadão → URL real com ?body={"layout":"google-news"} (confirmado feeder.co)
//   TecMundo → https://rss.tecmundo.com.br/feed (pode estar instável)
// ══════════════════════════════════════════════════════════════════════════════

const PORTALS = [
  {
    id: "g1", name: "G1", color: "#e8001c", proxy: false,
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
    id: "folha", name: "Folha", color: "#0066cc", proxy: false,
    feeds: [
      "https://feeds.folha.uol.com.br/emcimadahora/rss091.xml",
      "https://feeds.folha.uol.com.br/poder/rss091.xml",
      "https://feeds.folha.uol.com.br/mercado/rss091.xml",
      "https://feeds.folha.uol.com.br/esporte/rss091.xml",
      "https://feeds.folha.uol.com.br/mundo/rss091.xml",
      "https://feeds.folha.uol.com.br/cotidiano/rss091.xml",
      "https://feeds.folha.uol.com.br/tec/rss091.xml",
    ],
  },
  {
    id: "r7", name: "R7", color: "#cc0000", proxy: false,
    feeds: [
      "https://noticias.r7.com/feed.xml",
    ],
  },
  {
    id: "jovempan", name: "Jovem Pan", color: "#ff6600", proxy: false,
    feeds: [
      "https://jovempan.com.br/feed",
      "https://jovempan.com.br/jpnews/feed",
    ],
  },
  {
    id: "gazetadopovo", name: "Gazeta do Povo", color: "#5577aa", proxy: false,
    feeds: [
      "https://www.gazetadopovo.com.br/feed/rss/ultimas-noticias.xml",
      "https://www.gazetadopovo.com.br/feed/rss/republica.xml",
      "https://www.gazetadopovo.com.br/feed/rss/economia.xml",
      "https://www.gazetadopovo.com.br/feed/rss/mundo.xml",
    ],
  },
  {
    // URL real descoberta via feeder.co — usa body JSON encoded
    id: "estadao", name: "Estadão", color: "#003399", proxy: true,
    feeds: [
      "https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/ultimas/?body=%7B%22layout%22%3A%22google-news%22%7D",
      "https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/politica/?body=%7B%22layout%22%3A%22google-news%22%7D",
      "https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/economia/?body=%7B%22layout%22%3A%22google-news%22%7D",
      "https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/esportes/?body=%7B%22layout%22%3A%22google-news%22%7D",
    ],
  },
  {
    // Confirmado ativo hoje via feeder.co
    id: "uol", name: "UOL", color: "#f08000", proxy: true,
    feeds: [
      "http://rss.home.uol.com.br/index.xml",
    ],
  },
  {
    // Confirmado ativo hoje via feeder.co (atualizado há 28min)
    id: "olhardigital", name: "Olhar Digital", color: "#0091ea", proxy: true,
    feeds: [
      "https://olhardigital.com.br/feed/",
    ],
  },
  {
    // WordPress /feed padrão, confirmado via feedspot
    id: "correiobraziliense", name: "Correio Braziliense", color: "#c62828", proxy: true,
    feeds: [
      "https://www.correiobraziliense.com.br/feed",
      "https://www.correiobraziliense.com.br/brasil/feed",
      "https://www.correiobraziliense.com.br/economia/feed",
    ],
  },
  {
    id: "tecmundo", name: "TecMundo", color: "#00c853", proxy: true,
    feeds: [
      "https://rss.tecmundo.com.br/feed",
    ],
  },
];

// ══════════════════════════════════════════════════════════════════════════════
//  PARSE RSS XML nativo
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
//  PARSE resposta rss2json → formato comum
// ══════════════════════════════════════════════════════════════════════════════
function parseRss2Json(data) {
  if (!data || data.status !== "ok" || !Array.isArray(data.items)) return [];
  return data.items.map(item => ({
    title:   item.title || "",
    link:    item.link  || item.guid || "",
    pubDate: item.pubDate || "",
    desc:    item.description
               ? item.description.replace(/<[^>]+>/g, "").trim().slice(0, 300)
               : item.title || "",
  })).filter(i => i.title && i.link);
}

// ══════════════════════════════════════════════════════════════════════════════
//  FETCH DIRETO
// ══════════════════════════════════════════════════════════════════════════════
async function fetchDirect(url) {
  try {
    const res = await axios.get(url, {
      timeout: 12000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Accept":     "application/rss+xml, application/xml, text/xml, */*",
      },
    });
    const body = typeof res.data === "string" ? res.data : String(res.data);
    if (body.trim().startsWith("<!DOCTYPE") || body.trim().startsWith("<html")) {
      console.warn(`Feed retornou HTML (${url})`);
      return [];
    }
    return parseRSS(body);
  } catch (e) {
    console.warn(`Direto falhou (${url}): ${e.message}`);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  FETCH VIA PROXY rss2json (com fallback direto)
// ══════════════════════════════════════════════════════════════════════════════
async function fetchViaProxy(url) {
  try {
    const proxyUrl = `${RSS2JSON}${encodeURIComponent(url)}&count=30`;
    const res = await axios.get(proxyUrl, { timeout: 15000 });
    const items = parseRss2Json(res.data);
    if (items.length > 0) {
      console.log(`  proxy OK (${url}): ${items.length} itens`);
      return items;
    }
    console.log(`  proxy sem itens (${url}), tentando direto...`);
    return fetchDirect(url);
  } catch (e) {
    console.warn(`Proxy falhou (${url}): ${e.message}, tentando direto...`);
    return fetchDirect(url);
  }
}

async function fetchFeed(url, useProxy) {
  return useProxy ? fetchViaProxy(url) : fetchDirect(url);
}

// ══════════════════════════════════════════════════════════════════════════════
//  DETECTA CATEGORIA
// ══════════════════════════════════════════════════════════════════════════════
function detectCategory(title, link) {
  const t = (title + " " + link).toLowerCase();
  if (/politi|congresso|senado|câmara|ministro|governo|presidente|eleicao|partido|lula|bolsonaro/.test(t)) return "Política";
  if (/economi|mercado|bolsa|dolar|inflacao|pib|juros|banco|empresa|negocio|petrobras|receita/.test(t))    return "Economia";
  if (/futebol|esporte|campeonato|copa|olimpi|atleta|gol|nba|nfl|tênis|basquete|vôlei/.test(t))            return "Esportes";
  if (/tecnolog|inteligencia artificial|startup|celular|iphone|android|internet|app|\bia\b|openai/.test(t)) return "Tecnologia";
  if (/mundo|internacional|guerra|eua|trump|china|russia|europa|oriente|africa|argentina/.test(t))         return "Mundo";
  if (/entreteni|cinema|musica|serie|celebr|famoso|show|festival|arte|novela|bbb/.test(t))                 return "Entretenimento";
  if (/saude|medici|hospital|virus|vacina|cancer|doenca|covid/.test(t))                                    return "Saúde";
  if (/ciencia|pesquisa|descoberta|espaco|nasa|astronomia/.test(t))                                        return "Ciência";
  return "Brasil";
}

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

function dedup(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.titulo.toLowerCase().replace(/[^\wÀ-ú\s]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
//  BUSCA UM PORTAL
// ══════════════════════════════════════════════════════════════════════════════
async function fetchPortalNews(portal) {
  const feedResults = await Promise.all(
    portal.feeds.map(url => fetchFeed(url, portal.proxy ?? false))
  );
  const all = feedResults.flat();

  let filtered = all.filter(i => withinHours(i.pubDate, 1));
  if (filtered.length < 3) {
    filtered = all.filter(i => withinHours(i.pubDate, 3));
    if (filtered.length < 3) {
      filtered = all.filter(i => withinHours(i.pubDate, 12));
    }
  }

  const news = filtered.map(item => ({
    titulo:      item.title,
    resumo:      (item.desc || item.title).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 300),
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

  console.log(`${portal.name}: ${news.length} notícias (${all.length} brutas)`);
  return news;
}

// ══════════════════════════════════════════════════════════════════════════════
//  AGRUPAMENTO SEMÂNTICO VIA IA
// ══════════════════════════════════════════════════════════════════════════════
async function groupByTopicAI(allNews) {
  if (allNews.length === 0) return [];

  const lista = allNews.map((n, i) => `${i}: [${n.portalId.toUpperCase()}] ${n.titulo}`).join("\n");

  const prompt = `Você é um editor-chefe de jornalismo. Agrupe APENAS notícias que cobrem EXATAMENTE o mesmo fato específico.

CRITÉRIO: mesmo evento concreto + mesmo momento.
✓ AGRUPAR: "Lula sanciona MP X" + "Presidente assina MP X"
✗ NÃO AGRUPAR: temas amplos (futebol, política, economia)
✗ NÃO AGRUPAR: fatos distintos mesmo que relacionados

NOTÍCIAS:
${lista}

Responda SOMENTE JSON puro — array de arrays de índices inteiros.
Cada índice aparece exatamente uma vez. Sozinhos: [N]
Formato: [[0,3],[1],[2,5],[4],...]
Sem texto antes, depois, ou markdown.`;

  try {
    const res = await axios.post(
      CHAT_API,
      { message: prompt },
      { headers: { "Content-Type": "application/json" }, timeout: 30000 }
    );

    const raw = res.data?.reply || "";
    const s   = raw.trim().replace(/```[\w]*\s*/gi, "").replace(/```/g, "").trim();
    const st  = s.indexOf("["), en = s.lastIndexOf("]");
    if (st === -1 || en === -1) throw new Error("sem JSON");
    const groups = JSON.parse(s.slice(st, en + 1));

    const used = new Set(), result = [];
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
    console.warn("groupByTopicAI falhou, fallback:", e.message);
    return groupFallback(allNews);
  }
}

function groupFallback(allNews) {
  const stop = new Set(["de","do","da","dos","das","no","na","nos","nas","em","com","que","por","para","os","as","um","uma","ao","à","é","e","o","a","se","já","após","mais","sobre","pelo","pela","entre","isso","este","essa","seus","suas"]);
  const used = new Set(), result = [];
  for (let i = 0; i < allNews.length; i++) {
    if (used.has(i)) continue;
    const group = { id: `g${i}`, items: [allNews[i]], categoria: allNews[i].categoria };
    used.add(i);
    const wA = allNews[i].titulo.toLowerCase().split(/\W+/).filter(w => w.length > 4 && !stop.has(w));
    for (let j = i + 1; j < allNews.length; j++) {
      if (used.has(j) || allNews[j].portalId === allNews[i].portalId) continue;
      const wB = allNews[j].titulo.toLowerCase().split(/\W+/).filter(w => w.length > 4 && !stop.has(w));
      const common = wA.filter(w => wB.includes(w));
      const minLen = Math.min(wA.length, wB.length);
      if (common.length >= 3 && minLen > 0 && (common.length / minLen) >= 0.3) {
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
      return res.status(503).json({ error: "Feeds indisponíveis. Tente novamente." });

    const groups = await groupByTopicAI(allNews);

    return res.status(200).json({
      groups,
      allNews,
      portals:   PORTALS.map(p => ({ id: p.id, name: p.name, color: p.color })),
      fetchedAt: new Date().toISOString(),
      total:     allNews.length,
    });
  } catch (err) {
    console.error("ERRO /api/news:", err?.message || err);
    return res.status(500).json({ error: "Erro interno." });
  }
}