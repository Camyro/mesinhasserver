// scripts/fetchNews.js — roda via GitHub Actions, sem IA
// Faz upload do resultado em data/news.json no próprio repo

import axios from "axios";

const GH_TOKEN  = process.env.GH_TOKEN;
const GH_OWNER  = "Camyro";
const GH_REPO   = "mesinhasserver";
const GH_PATH   = "data/news.json";
const GH_BRANCH = "main";

const NEWSDATA_KEY = process.env.NEWSDATA_KEY || "pub_766ed08a39894093a443ec08f47b20a0";
const GNEWS_KEY    = process.env.GNEWS_KEY    || "17716602b28ef11dce0f221f2ccd25da";
const RSS2JSON     = "https://api.rss2json.com/v1/api.json?rss_url=";

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
    // UOL: removido feed de entretenimento, só notícias
    id: "uol", name: "UOL", color: "#f08000", proxy: true,
    feeds: [
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

// ── FILTRO DE LIXO (antes de qualquer agrupamento) ────────────────────────
// Palavras que indicam conteúdo de entretenimento / fofoca / clickbait
const JUNK_TITLE_RE = /\b(famoso|celebrid|novela|bbb|big brother|paredão|eliminado|famosa|fofoca|affair|affair|musa|gata|gato|affair|participante|reality|líder da semana|vetado|anjo|prova do|tá rolando|saiu do|entrou no|perdeu no|venceu o bbb|formou o paredão|irmão do|filho de|namorad[ao] de|separou de|traiu|chifr|affair|casal|casou|divorci|arrumou|ficou com|foi visto com|estava com|pegou|saiu com|ficou|trocou|assumiu relacionamento|maquiagem|look|estilo|roupa|moda|desfile|beleza|dieta|emagrec|corpo|silicone|plástica|cirurgia estética|procedimento|harmoniz|antes e depois|transformação|revelou segredo|confessou|se arrependeu|chorou|desabafou|se emocionou|passou vergonha|humilhado|cancelado|polêmica nas redes|viralizou|trend|meme|curtiu|comentou|rebateu|respondeu hater|indireta|deu indireta)\b/i;

// Categorias de entretenimento que vêm de APIs externas — filtramos se o portal for UOL
const UOL_BLOCK_CATEGORIES = new Set(["entertainment", "Entretenimento"]);

function isJunk(title, categoria, portalId) {
  if (JUNK_TITLE_RE.test(title)) return true;
  if (portalId === "uol" && UOL_BLOCK_CATEGORIES.has(categoria)) return true;
  return false;
}

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

// ── FETCH RSS ─────────────────────────────────────────────────────────────
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
    // SEM "entertainment" — removido intencionalmente
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
        const categoria = mapNewsDataCategory(a.category?.[0] || "");
        if (isJunk(a.title, categoria, src.id)) continue;
        results.push({
          titulo:      a.title,
          resumo:      (a.description || a.content || a.title).replace(/<[^>]+>/g, "").trim().slice(0, 300),
          categoria,
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
  const map = {
    politics: "Política", business: "Economia", world: "Mundo",
    technology: "Tecnologia", sports: "Esportes", health: "Saúde",
    science: "Ciência", entertainment: "Entretenimento", top: "Brasil"
  };
  return map[cat] || "Brasil";
}

// ── GNEWS ─────────────────────────────────────────────────────────────────
async function fetchGNews() {
  // SEM "entertainment" — removido intencionalmente
  const topics = ["breaking-news", "world", "nation", "business", "technology", "sports", "science", "health"];
  const results = [];

  await Promise.all(topics.map(async (topic) => {
    try {
      const params = new URLSearchParams({ token: GNEWS_KEY, lang: "pt", country: "br", max: 10, topic });
      const res = await axios.get(`https://gnews.io/api/v4/top-headlines?${params}`, { timeout: 15000 });
      const articles = res.data?.articles || [];

      for (const a of articles) {
        if (!a.title || !a.url) continue;
        const src = mapGNewsSource(a.source?.name || "", a.url || "");
        const categoria = mapGNewsTopic(topic);
        if (isJunk(a.title, categoria, src.id)) continue;
        results.push({
          titulo:      a.title,
          resumo:      (a.description || a.content || a.title).replace(/<[^>]+>/g, "").trim().slice(0, 300),
          categoria,
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
  const map = {
    "breaking-news": "Brasil", "world": "Mundo", "nation": "Brasil",
    "business": "Economia", "technology": "Tecnologia", "sports": "Esportes",
    "science": "Ciência", "health": "Saúde", "entertainment": "Entretenimento"
  };
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

// Dedup por título normalizado
function dedup(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.titulo
      .toLowerCase()
      .replace(/[^\wÀ-ú\s]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
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

  const news = filtered
    .map(item => {
      const categoria = detectCategory(item.title, item.link);
      // Filtra lixo antes de adicionar
      if (isJunk(item.title, categoria, portal.id)) return null;
      return {
        titulo:      item.title,
        resumo:      (item.desc || item.title).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 300),
        categoria,
        link:        item.link,
        hora:        formatAge(item.pubDate),
        pubDate:     item.pubDate,
        portal:      portal.name,
        portalId:    portal.id,
        portalColor: portal.color,
      };
    })
    .filter(Boolean);

  news.sort((a, b) => (new Date(b.pubDate).getTime() || 0) - (new Date(a.pubDate).getTime() || 0));
  console.log(`${portal.name}: ${news.length} notícias (após filtro)`);
  return news;
}

// ── UPLOAD GITHUB ─────────────────────────────────────────────────────────
async function uploadToGitHub(payload) {
  if (!GH_TOKEN) {
    console.warn("GH_TOKEN não definido — pulando upload.");
    console.log("Payload gerado:", JSON.stringify(payload).slice(0, 200), "...");
    return;
  }

  const url     = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_PATH}`;
  const headers = {
    Authorization: `token ${GH_TOKEN}`,
    Accept:        "application/vnd.github.v3+json",
    "User-Agent":  "fetchNews-script",
  };

  // Obtém SHA do arquivo atual (necessário para update)
  let sha;
  try {
    const current = await axios.get(url, { headers, timeout: 10000 });
    sha = current.data.sha;
  } catch (e) {
    if (e.response?.status !== 404) throw e;
    console.log("Arquivo ainda não existe — será criado.");
  }

  const body = {
    message: `chore: atualiza news.json ${new Date().toISOString()}`,
    content:  Buffer.from(JSON.stringify(payload, null, 2)).toString("base64"),
    branch:   GH_BRANCH,
  };
  if (sha) body.sha = sha;

  await axios.put(url, body, { headers, timeout: 20000 });
  console.log(`✅ data/${GH_PATH} atualizado no GitHub`);
}

// ── MAIN ──────────────────────────────────────────────────────────────────
async function main() {
  console.log("🔄 Iniciando fetch de notícias...");

  const [rssResults, newsDataResults, gnewsResults] = await Promise.all([
    Promise.all(PORTALS.map(fetchPortalNews)).then(r => r.flat()),
    fetchNewsData().catch(e => { console.warn("NewsData erro:", e.message); return []; }),
    fetchGNews().catch(e => { console.warn("GNews erro:", e.message); return []; }),
  ]);

  const combined = [...rssResults, ...newsDataResults, ...gnewsResults];
  const allNews  = dedup(combined);

  // Ordena por data decrescente para o frontend exibir as mais recentes primeiro
  allNews.sort((a, b) => {
    const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return db - da;
  });

  console.log(`RSS: ${rssResults.length} | NewsData: ${newsDataResults.length} | GNews: ${gnewsResults.length} | Total dedup: ${allNews.length}`);

  if (allNews.length === 0) {
    console.error("❌ Nenhuma notícia obtida. Abortando upload.");
    process.exit(1);
  }

  const payload = {
    allNews,
    fetchedAt: new Date().toISOString(),
    total:     allNews.length,
    sources: {
      rss:      rssResults.length,
      newsdata: newsDataResults.length,
      gnews:    gnewsResults.length,
    },
    portals: PORTALS.map(p => ({ id: p.id, name: p.name, color: p.color })),
  };

  await uploadToGitHub(payload);
  console.log("✅ Concluído.");
}

main().catch(err => {
  console.error("ERRO fatal:", err?.message || err);
  process.exit(1);
});