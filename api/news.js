import axios from "axios";

const CHAT_API       = "https://mesinhasserver.vercel.app/api/chat";
const RSS2JSON       = "https://api.rss2json.com/v1/api.json?rss_url=";

// ── CHAVES DE API ─────────────────────────────────────────────────────────
const NEWSDATA_KEY   = "pub_dc5dd2fc94ea4dc4a547e222e2cacbc1";
const GNEWS_KEY      = "ff65eb43f96dbf733e3cd8c840142cb0";

// ── PORTAIS RSS ───────────────────────────────────────────────────────────
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
    id: "estadao", name: "Estadão", color: "#003399", proxy: true,
    feeds: [
      "https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/ultimas/?body=%7B%22layout%22%3A%22google-news%22%7D",
      "https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/politica/?body=%7B%22layout%22%3A%22google-news%22%7D",
      "https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/economia/?body=%7B%22layout%22%3A%22google-news%22%7D",
      "https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/esportes/?body=%7B%22layout%22%3A%22google-news%22%7D",
    ],
  },
  {
    id: "uol", name: "UOL", color: "#f08000", proxy: true,
    feeds: [
      "http://rss.home.uol.com.br/index.xml",
      "https://rss.uol.com.br/feed/noticias.xml",
    ],
  },
  {
    id: "olhardigital", name: "Olhar Digital", color: "#0091ea", proxy: true,
    feeds: ["https://olhardigital.com.br/feed/"],
  },
  {
    id: "tecmundo", name: "TecMundo", color: "#00c853", proxy: true,
    feeds: ["https://rss.tecmundo.com.br/feed"],
  },
];

// ── PARSE RSS XML ─────────────────────────────────────────────────────────
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

// ── FETCH RSS ────────────────────────────────────────────────────────────
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
    if (body.trim().startsWith("<!DOCTYPE") || body.trim().startsWith("<html")) return [];
    return parseRSS(body);
  } catch (e) {
    console.warn(`Direto falhou (${url}): ${e.message}`);
    return [];
  }
}

async function fetchViaProxy(url) {
  try {
    const proxyUrl = `${RSS2JSON}${encodeURIComponent(url)}&count=30`;
    const res = await axios.get(proxyUrl, { timeout: 15000 });
    const items = parseRss2Json(res.data);
    if (items.length > 0) return items;
    return fetchDirect(url);
  } catch (e) {
    return fetchDirect(url);
  }
}

async function fetchFeed(url, useProxy) {
  return useProxy ? fetchViaProxy(url) : fetchDirect(url);
}

// ── NEWSDATA.IO ───────────────────────────────────────────────────────────
async function fetchNewsData() {
  const queries = [
    { category: null },
    { category: "politics" },
    { category: "business" },
    { category: "world" },
    { category: "technology" },
    { category: "sports" },
  ];

  const results = [];

  await Promise.all(queries.map(async ({ category }) => {
    try {
      const params = new URLSearchParams({
        apikey:   NEWSDATA_KEY,
        country:  "br",
        language: "pt",
        ...(category && { category }),
      });
      const res = await axios.get(`https://newsdata.io/api/1/latest?${params}`, { timeout: 15000 });
      const articles = res.data?.results || [];

      for (const a of articles) {
        if (!a.title || !a.link) continue;
        const src = mapNewsDataSource(a.source_id || "", a.source_url || "");
        results.push({
          titulo:      a.title,
          resumo:      (a.description || a.content || a.title).replace(/<[^>]+>/g, "").trim().slice(0, 300),
          categoria:   mapNewsDataCategory(a.category?.[0] || ""),
          link:        a.link,
          hora:        formatAge(a.pubDate),
          pubDate:     a.pubDate,
          portal:      src.name,
          portalId:    src.id,
          portalColor: src.color,
        });
      }
      console.log(`NewsData [${category || "geral"}]: ${articles.length} artigos`);
    } catch (e) {
      console.warn(`NewsData falhou [${category || "geral"}]: ${e.message}`);
    }
  }));

  return results;
}

function mapNewsDataSource(sourceId, sourceUrl) {
  const s = (sourceId + sourceUrl).toLowerCase();
  if (s.includes("g1") || s.includes("globo"))             return { id: "g1",           name: "G1",             color: "#e8001c" };
  if (s.includes("folha"))                                  return { id: "folha",         name: "Folha",          color: "#0066cc" };
  if (s.includes("estadao") || s.includes("estadão"))       return { id: "estadao",       name: "Estadão",        color: "#003399" };
  if (s.includes("jovempan") || s.includes("jpnews"))       return { id: "jovempan",      name: "Jovem Pan",      color: "#ff6600" };
  if (s.includes("gazetadopovo") || s.includes("gazeta"))   return { id: "gazetadopovo",  name: "Gazeta do Povo", color: "#5577aa" };
  if (s.includes("uol"))                                    return { id: "uol",           name: "UOL",            color: "#f08000" };
  if (s.includes("tecmundo"))                               return { id: "tecmundo",      name: "TecMundo",       color: "#00c853" };
  if (s.includes("olhardigital"))                           return { id: "olhardigital",  name: "Olhar Digital",  color: "#0091ea" };
  if (s.includes("veja"))                                   return { id: "veja",          name: "Veja",           color: "#cc0000" };
  if (s.includes("metropoles") || s.includes("metrópoles")) return { id: "metropoles",    name: "Metrópoles",     color: "#6600cc" };
  if (s.includes("cnn"))                                    return { id: "cnnbrasil",     name: "CNN Brasil",     color: "#cc0000" };
  if (s.includes("band"))                                   return { id: "band",          name: "Band",           color: "#ff0000" };
  if (s.includes("terra"))                                  return { id: "terra",         name: "Terra",          color: "#00aa44" };
  if (s.includes("r7"))                                     return { id: "r7",            name: "R7",             color: "#cc0000" };
  const label = sourceId.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()) || "Portal";
  return { id: sourceId || "outro", name: label, color: "#888888" };
}

function mapNewsDataCategory(cat) {
  const map = { politics: "Política", business: "Economia", world: "Mundo", technology: "Tecnologia", sports: "Esportes", health: "Saúde", science: "Ciência", entertainment: "Entretenimento", top: "Brasil" };
  return map[cat] || "Brasil";
}

// ── GNEWS ─────────────────────────────────────────────────────────────────
async function fetchGNews() {
  const topics = ["breaking-news", "world", "nation", "business", "technology", "sports", "science", "health", "entertainment"];
  const results = [];

  await Promise.all(topics.map(async (topic) => {
    try {
      const params = new URLSearchParams({ token: GNEWS_KEY, lang: "pt", country: "br", max: 10, topic });
      const res = await axios.get(`https://gnews.io/api/v4/top-headlines?${params}`, { timeout: 15000 });
      const articles = res.data?.articles || [];

      for (const a of articles) {
        if (!a.title || !a.url) continue;
        const src = mapGNewsSource(a.source?.name || "", a.url || "");
        results.push({
          titulo:      a.title,
          resumo:      (a.description || a.content || a.title).replace(/<[^>]+>/g, "").trim().slice(0, 300),
          categoria:   mapGNewsTopic(topic),
          link:        a.url,
          hora:        formatAge(a.publishedAt),
          pubDate:     a.publishedAt,
          portal:      src.name,
          portalId:    src.id,
          portalColor: src.color,
        });
      }
      console.log(`GNews [${topic}]: ${articles.length} artigos`);
    } catch (e) {
      console.warn(`GNews falhou [${topic}]: ${e.message}`);
    }
  }));

  return results;
}

function mapGNewsSource(sourceName, url) {
  const s = (sourceName + url).toLowerCase();
  if (s.includes("g1") || s.includes("globo"))              return { id: "g1",           name: "G1",             color: "#e8001c" };
  if (s.includes("folha"))                                   return { id: "folha",         name: "Folha",          color: "#0066cc" };
  if (s.includes("estadao") || s.includes("estadão"))        return { id: "estadao",       name: "Estadão",        color: "#003399" };
  if (s.includes("jovempan") || s.includes("jovem pan"))     return { id: "jovempan",      name: "Jovem Pan",      color: "#ff6600" };
  if (s.includes("gazeta do povo") || s.includes("gazetadopovo")) return { id: "gazetadopovo", name: "Gazeta do Povo", color: "#5577aa" };
  if (s.includes("uol"))                                     return { id: "uol",           name: "UOL",            color: "#f08000" };
  if (s.includes("tecmundo"))                                return { id: "tecmundo",      name: "TecMundo",       color: "#00c853" };
  if (s.includes("olhar digital"))                           return { id: "olhardigital",  name: "Olhar Digital",  color: "#0091ea" };
  if (s.includes("veja"))                                    return { id: "veja",          name: "Veja",           color: "#cc0000" };
  if (s.includes("metrópoles") || s.includes("metropoles"))  return { id: "metropoles",    name: "Metrópoles",     color: "#6600cc" };
  if (s.includes("cnn brasil") || s.includes("cnnbrasil"))   return { id: "cnnbrasil",     name: "CNN Brasil",     color: "#cc0000" };
  if (s.includes("band"))                                    return { id: "band",          name: "Band",           color: "#ff0000" };
  if (s.includes("terra"))                                   return { id: "terra",         name: "Terra",          color: "#00aa44" };
  if (s.includes("r7"))                                      return { id: "r7",            name: "R7",             color: "#cc0000" };
  const slug = sourceName.toLowerCase().replace(/\s+/g, "");
  return { id: slug || "outro", name: sourceName || "Portal", color: "#888888" };
}

function mapGNewsTopic(topic) {
  const map = { "breaking-news": "Brasil", "world": "Mundo", "nation": "Brasil", "business": "Economia", "technology": "Tecnologia", "sports": "Esportes", "science": "Ciência", "health": "Saúde", "entertainment": "Entretenimento" };
  return map[topic] || "Brasil";
}

// ── HELPERS ───────────────────────────────────────────────────────────────
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

// ── FETCH PORTAL RSS ──────────────────────────────────────────────────────
async function fetchPortalNews(portal) {
  const feedResults = await Promise.all(
    portal.feeds.map(url => fetchFeed(url, portal.proxy ?? false))
  );
  const all = feedResults.flat();

  let filtered = all.filter(i => withinHours(i.pubDate, 1));
  if (filtered.length < 3) filtered = all.filter(i => withinHours(i.pubDate, 3));
  if (filtered.length < 3) filtered = all.filter(i => withinHours(i.pubDate, 12));

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

  news.sort((a, b) => (new Date(b.pubDate).getTime() || 0) - (new Date(a.pubDate).getTime() || 0));
  console.log(`${portal.name}: ${news.length} notícias`);
  return news;
}

// ── AGRUPAMENTO FALLBACK LEXICAL ──────────────────────────────────────────
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
      if (common.length >= 4 && minLen > 0 && (common.length / minLen) >= 0.5) {
        group.items.push(allNews[j]);
        used.add(j);
      }
    }
    result.push(group);
  }
  return result.sort((a, b) => b.items.length - a.items.length);
}

// ── AGRUPAMENTO PRIMÁRIO IA ───────────────────────────────────────────────
async function groupByTopicAI(allNews) {
  if (allNews.length === 0) return [];

  const lista = allNews.map((n, i) => `${i}: [${n.portalId.toUpperCase()}] ${n.titulo}`).join("\n");

  const prompt = `Você é um editor-chefe de jornalismo extremamente criterioso. Agrupe notícias que cobrem LITERALMENTE O MESMO FATO ESPECÍFICO E ÚNICO.

CRITÉRIO: mesmo acontecimento, mesmo momento, mesmos protagonistas principais.
TESTE: "Um leitor que lesse A e depois B diria que são o MESMO fato?" — Na dúvida, NÃO AGRUPE.

✅ CORRETO: "Câmara aprova PL X" + "Deputados votam PL X" (mesmo ato)
❌ ERRADO: "Governo debate reforma" + "Mercado reage à reforma" (eventos distintos)
❌ ERRADO: "Trump anuncia tarifas" + "China ameaça retaliar" (causa ≠ reação)

REGRAS: Notícias do mesmo portal NUNCA no mesmo grupo. Na dúvida, NÃO agrupe.

NOTÍCIAS:
${lista}

JSON puro — array de arrays de índices. Formato: [[0,3],[1],[2,5],[4],...]
Sem texto, sem markdown.`;

  try {
    const res = await axios.post(CHAT_API, { message: prompt }, { headers: { "Content-Type": "application/json" }, timeout: 30000 });
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
      if (!used.has(i)) result.push({ id: `g${result.length}`, items: [allNews[i]], categoria: allNews[i].categoria });
    }
    return result.sort((a, b) => b.items.length - a.items.length);
  } catch (e) {
    console.warn("groupByTopicAI falhou, fallback:", e.message);
    return groupFallback(allNews);
  }
}

// ── VALIDAÇÃO IA DOS GRUPOS ───────────────────────────────────────────────
async function validateGroupsAI(groups) {
  const multiGroups = groups.filter(g => g.items.length > 1);
  if (multiGroups.length === 0) return groups;

  const validationList = multiGroups.map((g, gi) => {
    const titles = g.items.map(item => `  [${item.portalId.toUpperCase()}] ${item.titulo}`).join("\n");
    return `GRUPO ${gi}:\n${titles}`;
  }).join("\n\n");

  const prompt = `Editor-chefe exigente. Cada grupo abaixo é VÁLIDO ou INVÁLIDO.
VÁLIDO: TODAS cobrem LITERALMENTE O MESMO ACONTECIMENTO.
INVÁLIDO: temas relacionados mas fatos distintos, causa vs consequência, mesmo assunto mas eventos diferentes.
Na dúvida, invalide.

${validationList}

JSON puro: [{"grupo": 0, "valido": true}, {"grupo": 1, "valido": false}, ...]`;

  try {
    const res = await axios.post(CHAT_API, { message: prompt }, { headers: { "Content-Type": "application/json" }, timeout: 25000 });
    const raw = res.data?.reply || "";
    const s   = raw.trim().replace(/```[\w]*\s*/gi, "").replace(/```/g, "").trim();
    const st  = s.indexOf("["), en = s.lastIndexOf("]");
    if (st === -1 || en === -1) throw new Error("sem JSON");
    const validations = JSON.parse(s.slice(st, en + 1));

    const invalidSet = new Set(validations.filter(v => v.valido === false).map(v => Number(v.grupo)));
    console.log(`Validação: ${invalidSet.size}/${multiGroups.length} grupos invalidados.`);

    const singleGroups = groups.filter(g => g.items.length === 1);
    let idCounter = 0;
    const rebuiltMulti = [];

    multiGroups.forEach((g, gi) => {
      if (invalidSet.has(gi)) {
        g.items.forEach(item => rebuiltMulti.push({ id: `gv${idCounter++}`, items: [item], categoria: item.categoria }));
      } else {
        rebuiltMulti.push({ ...g, id: `gv${idCounter++}` });
      }
    });

    return [...rebuiltMulti, ...singleGroups.map(g => ({ ...g, id: `gv${idCounter++}` }))].sort((a, b) => b.items.length - a.items.length);
  } catch (e) {
    console.warn("validateGroupsAI falhou:", e.message);
    return groups;
  }
}

// ── HANDLER PRINCIPAL ─────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido" });

  try {
    // Busca tudo em paralelo: RSS + NewsData.io + GNews
    const [rssResults, newsDataResults, gnewsResults] = await Promise.all([
      Promise.all(PORTALS.map(fetchPortalNews)).then(r => r.flat()),
      fetchNewsData().catch(e => { console.warn("NewsData erro:", e.message); return []; }),
      fetchGNews().catch(e => { console.warn("GNews erro:", e.message); return []; }),
    ]);

    const combined = [...rssResults, ...newsDataResults, ...gnewsResults];
    const allNews  = dedup(combined);

    console.log(`RSS: ${rssResults.length} | NewsData: ${newsDataResults.length} | GNews: ${gnewsResults.length} | Total: ${allNews.length}`);

    if (allNews.length === 0)
      return res.status(503).json({ error: "Todas as fontes indisponíveis. Tente novamente." });

    let groups = await groupByTopicAI(allNews);
    groups = await validateGroupsAI(groups);

    return res.status(200).json({
      groups,
      allNews,
      portals:        PORTALS.map(p => ({ id: p.id, name: p.name, color: p.color })),
      fetchedAt:      new Date().toISOString(),
      total:          allNews.length,
      overallSummary: "",
      sources: { rss: rssResults.length, newsdata: newsDataResults.length, gnews: gnewsResults.length },
    });
  } catch (err) {
    console.error("ERRO /api/news:", err?.message || err);
    return res.status(500).json({ error: "Erro interno." });
  }
}