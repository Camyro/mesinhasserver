import axios from "axios";

const CHAT_API = "https://mesinhasserver.vercel.app/api/chat";

// ══════════════════════════════════════════════════════════════════════════════
//  PORTAIS — feeds verificados e ativos (atualizado 2026)
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
      "https://feeds.folha.uol.com.br/cotidiano/rss091.xml",
      "https://feeds.folha.uol.com.br/tec/rss091.xml",
    ],
  },
  {
    id:    "estadao",
    name:  "Estadão",
    color: "#003399",
    domain: "estadao.com.br",
    feeds: [
      // feeds arc/outboundfeeds mantidos (podem funcionar dependendo do servidor)
      "https://estadao.com.br/arc/outboundfeeds/rss/",
      "https://estadao.com.br/arc/outboundfeeds/rss/?hierarchy=politica",
      "https://estadao.com.br/arc/outboundfeeds/rss/?hierarchy=economia",
      "https://estadao.com.br/arc/outboundfeeds/rss/?hierarchy=esportes",
      "https://estadao.com.br/arc/outboundfeeds/rss/?hierarchy=internacional",
      // feeds alternativos no formato antigo (mais estáveis)
      "https://www.estadao.com.br/rss/ultimas.xml",
      "https://www.estadao.com.br/rss/economia.xml",
      "https://www.estadao.com.br/rss/esportes.xml",
    ],
  },
  {
    id:    "r7",
    name:  "R7",
    color: "#cc0000",
    domain: "r7.com",
    feeds: [
      "https://noticias.r7.com/feed.xml",
      "https://esportes.r7.com/feed.xml",
    ],
  },
  {
    id:    "jovempan",
    name:  "Jovem Pan",
    color: "#ff6600",
    domain: "jovempan.com.br",
    feeds: [
      "https://jovempan.com.br/feed",
      "https://jovempan.com.br/jpnews/feed",
    ],
  },
  {
    id:    "gazetadopovo",
    name:  "Gazeta do Povo",
    color: "#1a1a2e",
    domain: "gazetadopovo.com.br",
    feeds: [
      "https://www.gazetadopovo.com.br/feed/rss/ultimas-noticias.xml",
      "https://www.gazetadopovo.com.br/feed/rss/republica.xml",
      "https://www.gazetadopovo.com.br/feed/rss/economia.xml",
      "https://www.gazetadopovo.com.br/feed/rss/mundo.xml",
    ],
  },
  {
    id:    "tecmundo",
    name:  "TecMundo",
    color: "#00c853",
    domain: "tecmundo.com.br",
    feeds: [
      "https://rss.tecmundo.com.br/feed",
    ],
  },
  {
    id:    "olhardigital",
    name:  "Olhar Digital",
    color: "#0091ea",
    domain: "olhardigital.com.br",
    feeds: [
      "https://olhardigital.com.br/rss",
    ],
  },
  {
    id:    "correiobraziliense",
    name:  "Correio Braziliense",
    color: "#c62828",
    domain: "correiobraziliense.com.br",
    feeds: [
      "https://www.correiobraziliense.com.br/rss/feed.xml",
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
  if (/tecnolog|inteligencia artificial|startup|celular|iphone|android|internet|app|ia |openai|tecmundo|olhar digital/.test(t)) return "Tecnologia";
  if (/mundo|internacional|guerra|eua|trump|china|russia|europa|oriente|africa|argentina/.test(t))         return "Mundo";
  if (/entreteni|cinema|musica|serie|celebr|famoso|show|festival|arte|novela|bbb/.test(t))                 return "Entretenimento";
  if (/saude|medici|hospital|virus|vacina|cancer|doenca|covid/.test(t))                                    return "Saúde";
  if (/ciencia|pesquisa|descoberta|espaco|nasa|astronomia/.test(t))                                        return "Ciência";
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
//  AGRUPAMENTO SEMÂNTICO VIA IA (prompt mais rigoroso)
// ══════════════════════════════════════════════════════════════════════════════
async function groupByTopicAI(allNews) {
  if (allNews.length === 0) return [];

  const lista = allNews.map((n, i) => `${i}: [${n.portalId.toUpperCase()}] ${n.titulo}`).join("\n");

  const prompt = `Você é um editor-chefe de jornalismo. Sua tarefa é identificar quais notícias cobrem EXATAMENTE o mesmo fato específico.

REGRA FUNDAMENTAL: Só agrupe índices se as notícias tratarem do MESMO EVENTO CONCRETO E ESPECÍFICO. Exemplos:
- CORRETO agrupar: "Lula sanciona lei X" + "Presidente assina lei X" → mesmo ato
- ERRADO agrupar: "Crise no governo" + "Reforma ministerial" → eventos diferentes
- ERRADO agrupar por tema amplo: futebol, política, economia NÃO são grupos válidos
- ERRADO agrupar: "Bolsa cai 2%" + "Dólar sobe" → eventos distintos mesmo que relacionados

Lista de notícias:
${lista}

Responda SOMENTE com JSON puro — array de arrays de índices numéricos inteiros.
Cada índice deve aparecer exatamente uma vez.
Notícias sem par ficam em grupo sozinho: [N]
Formato obrigatório: [[0,3],[1],[2,5],[4],...]
Sem texto antes, sem texto depois, sem markdown.`;

  try {
    const res = await axios.post(
      CHAT_API,
      { message: prompt },
      { headers: { "Content-Type": "application/json" }, timeout: 30000 }
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
      // exige 3 palavras em comum E pelo menos 30% de overlap
      const common = wA.filter(w => wB.includes(w));
      const minLen = Math.min(wA.length, wB.length);
      if (common.length >= 3 && (common.length / minLen) >= 0.3) {
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