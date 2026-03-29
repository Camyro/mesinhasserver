import axios from "axios";
import admin from "firebase-admin";

// ─── Firebase Admin ────────────────────────────────────────────────────────────
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

// ══════════════════════════════════════════════════════════════════════════════
//  CATÁLOGO DE MODELOS
// ══════════════════════════════════════════════════════════════════════════════

// Cerebras — fonte: inference-docs.cerebras.ai/models/overview (março 2026)
const CEREBRAS_MODELS = {
  "llama3.1-8b":                    { label: "Llama 3.1 8B ⚡",             temp: 0.9 },
  "llama-3.3-70b":                  { label: "Llama 3.3 70B",               temp: 0.9 },
  "qwen-3-32b":                     { label: "Qwen 3 32B",                  temp: 0.9 },
  "qwen-3-235b-a22b-instruct-2507": { label: "Qwen 3 235B Instruct",        temp: 0.9 },
  "qwen-3-235b-a22b-thinking-2507": { label: "Qwen 3 235B Thinking 🧠",     temp: 0.9 },
  "gpt-oss-120b":                   { label: "GPT-OSS 120B 🧠",             temp: 0.9 },
  "zai-glm-4.6":                    { label: "ZAI GLM 4.6",                 temp: 0.9 },
  "zai-glm-4.7":                    { label: "ZAI GLM 4.7 ★",              temp: 0.9 },
};
const CEREBRAS_DEFAULT = "llama3.1-8b";
const CEREBRAS_URL     = "https://api.cerebras.ai/v1/chat/completions";
const CEREBRAS_KEY     = process.env.CEREBRAS_KEY;

// HuggingFace — fonte: huggingface.co/inference/models (março 2026)
// costPer1M = custo USD por 1 milhão de tokens (via provedor mais barato da HF)
const HF_MODELS = {
  "meta-llama/Llama-3.1-8B-Instruct":          { label: "Llama 3.1 8B",        costPer1M: 0.10,  temp: 1.2 },
  "meta-llama/Llama-3.3-70B-Instruct":         { label: "Llama 3.3 70B",       costPer1M: 0.59,  temp: 1.2 },
  "Qwen/Qwen3-8B":                             { label: "Qwen3 8B",            costPer1M: 0.10,  temp: 1.2 },
  "Qwen/Qwen2.5-72B-Instruct":                 { label: "Qwen2.5 72B",         costPer1M: 0.59,  temp: 1.2 },
  "mistralai/Mistral-7B-Instruct-v0.3":        { label: "Mistral 7B",          costPer1M: 0.10,  temp: 1.2 },
  "mistralai/Mixtral-8x7B-Instruct-v0.1":      { label: "Mixtral 8×7B",        costPer1M: 0.24,  temp: 1.2 },
  "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B":   { label: "DeepSeek R1 7B 🧠",   costPer1M: 0.18,  temp: 1.2 },
};
const HF_DEFAULT = "meta-llama/Llama-3.1-8B-Instruct";
const HF_URL     = "https://router.huggingface.co/v1/chat/completions";
const HF_KEY     = process.env.HF_KEY;

// Mistral — fonte: docs.mistral.ai/getting-started/changelog (março 2026)
const MISTRAL_MODELS = {
  "mistral-small-latest":    { label: "Mistral Small (latest)",         temp: 1.4 },
  "mistral-large-latest":    { label: "Mistral Large (latest)",         temp: 1.4 },
  "mistral-medium-latest":   { label: "Mistral Medium (latest)",        temp: 1.4 },
  "magistral-small-latest":  { label: "Magistral Small 🧠",             temp: 1.4 },
  "magistral-medium-latest": { label: "Magistral Medium 🧠",            temp: 1.4 },
  "codestral-latest":        { label: "Codestral (código)",             temp: 1.4 },
  "devstral-small-latest":   { label: "Devstral Small (agente código)", temp: 1.4 },
  "open-mistral-nemo":       { label: "Mistral NeMo (open)",            temp: 1.4 },
  "open-mixtral-8x22b":      { label: "Mixtral 8×22B (open)",           temp: 1.4 },
};
const MISTRAL_DEFAULT    = "mistral-small-latest";
const MISTRAL_URL        = "https://api.mistral.ai/v1/chat/completions";
const MISTRAL_AGENT_URL  = "https://api.mistral.ai/v1/agents/completions";
const MISTRAL_AGENT      = process.env.MISTRAL_AGENT_ID;
const MISTRAL_KEY        = process.env.MISTRAL_KEY;
const MISTRAL_WEB_LABEL  = "Mistral · web search";

// ══════════════════════════════════════════════════════════════════════════════
//  LIMITES
// ══════════════════════════════════════════════════════════════════════════════
const LIM_IP_MIN          = 20;
const LIM_CB_TOKENS       = 800_000;
const LIM_HF_COST_USD     = 0.00008;   // $0.00008 = 0,008 centavos de real ≈ 0,8 centavos BRL
const LIM_MS_4H           = 30;
const WIN_1MIN            = 60_000;
const WIN_4H              = 4 * 3_600_000;
const WIN_30D             = 30 * 24 * 3_600_000;

// Temperaturas por engine/contexto
const TEMP = { cerebras: 0.9, huggingface: 1.2, mistral: 1.4, websearch: 1.1, detect: 0.0 };

// ══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════════════
function dayKey() {
  const d = new Date();
  return `d${String(d.getUTCDate()).padStart(2,"0")}${String(d.getUTCMonth()+1).padStart(2,"0")}${d.getUTCFullYear()}`;
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(m => m && typeof m.role === "string" && typeof m.content === "string")
    .map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 4000) }));
}

function resolveModel(catalog, requested, defaultId) {
  if (requested && catalog[requested]) return requested;
  return defaultId;
}

// ══════════════════════════════════════════════════════════════════════════════
//  RATE LIMIT — IP (1 min)
// ══════════════════════════════════════════════════════════════════════════════
async function checkIpLimit(ip) {
  const key  = "ip_" + ip.replace(/[^a-zA-Z0-9._:-]/g, "_").slice(0, 80);
  const ref  = db.collection("chat").doc(key);
  const snap = await ref.get();
  const now  = Date.now();
  if (!snap.exists || now - snap.data().lastReset > WIN_1MIN) {
    await ref.set({ count: 1, lastReset: now });
    return true;
  }
  if (snap.data().count >= LIM_IP_MIN) return false;
  await ref.update({ count: admin.firestore.FieldValue.increment(1) });
  return true;
}

// ══════════════════════════════════════════════════════════════════════════════
//  LIMITE CEREBRAS — tokens/dia
// ══════════════════════════════════════════════════════════════════════════════
async function checkCerebrasQuota() {
  const field = `cb_tokens_${dayKey()}`;
  const ref   = db.collection("chat").doc("limits");
  const snap  = await ref.get();
  const used  = snap.exists ? (snap.data()[field] || 0) : 0;
  if (used >= LIM_CB_TOKENS) return { ok: false, used };
  return { ok: true, used, field, ref };
}

async function incrementCerebrasTokens(field, ref, tokensUsed) {
  if (!field || !ref || !tokensUsed) return;
  await ref.set({ [field]: admin.firestore.FieldValue.increment(tokensUsed) }, { merge: true });
}

// ══════════════════════════════════════════════════════════════════════════════
//  LIMITE HUGGINGFACE — custo USD/30 dias
// ══════════════════════════════════════════════════════════════════════════════
async function checkHFQuota(modelId) {
  const ref   = db.collection("chat").doc("limits");
  const snap  = await ref.get();
  const now   = Date.now();
  const d     = snap.exists ? snap.data() : {};
  const winStart = d.hf_win_start || 0;
  const costUsd  = d.hf_cost_usd  || 0;
  if (now - winStart > WIN_30D) {
    await ref.set({ hf_win_start: now, hf_cost_usd: 0 }, { merge: true });
    return { ok: true, costUsd: 0, costPer1M: HF_MODELS[modelId]?.costPer1M ?? 0.10, ref };
  }
  if (costUsd >= LIM_HF_COST_USD) return { ok: false, costUsd };
  return { ok: true, costUsd, costPer1M: HF_MODELS[modelId]?.costPer1M ?? 0.10, ref };
}

async function incrementHFCost(ref, tokens, costPer1M) {
  if (!ref || !tokens) return;
  const added = (tokens / 1_000_000) * (costPer1M || 0.10);
  await ref.set({ hf_cost_usd: admin.firestore.FieldValue.increment(added) }, { merge: true });
}

// ══════════════════════════════════════════════════════════════════════════════
//  LIMITE MISTRAL — 30 req / 4h
// ══════════════════════════════════════════════════════════════════════════════
async function checkMistral() {
  const ref  = db.collection("chat").doc("limits");
  const snap = await ref.get();
  const now  = Date.now();
  const d    = snap.exists ? snap.data() : {};
  const wStart = d.ms_win_start || 0;
  const wCount = d.ms_win_count || 0;
  if (now - wStart > WIN_4H) {
    await ref.set({ ms_win_start: now, ms_win_count: 1 }, { merge: true });
    return { ok: true, used: 1, resetIn: WIN_4H };
  }
  if (wCount >= LIM_MS_4H) return { ok: false, used: wCount, resetIn: WIN_4H - (now - wStart) };
  await ref.update({ ms_win_count: admin.firestore.FieldValue.increment(1) });
  return { ok: true, used: wCount + 1, resetIn: WIN_4H - (now - wStart) };
}

// ══════════════════════════════════════════════════════════════════════════════
//  DETECÇÃO WEB SEARCH MELHORADA
// ══════════════════════════════════════════════════════════════════════════════
const RE_STATIC = /^(o que [eé]|explica|como funciona|defin[ie]|diga[- ]me|me conta|quais s[aã]o|calcul|traduz|convert|histor|matem[aá]tic|equa[cç][aã]o|f[oó]rmula|c[oó]dig|progra|write a|create a|make a|help me)/i;

const RE_WEB = /\b(pesquisa|busca|search|googl|notícia|noticia|noticias|atualiza|recente|hoje|agora|últim|ultim|preço|cotação|resultado|placar|clima|tempo em|temperatura em|quem [eé] o atual|lançou|foi lançado|estreou|evento|ao vivo|live|breaking|news|2024|2025|2026)\b/i;

const RE_DYN = /\b(quem (é|são|foi|está)|qual é o (preço|valor|resultado|placar|dono|ceo|presidente|pm|governador)|quando (foi|é|será|acontece)|onde (está|fica|funciona)|quantos (anos|dias|meses) tem)\b/i;

async function detectWebSearch(message) {
  if (message.length < 8) return false;
  if (RE_STATIC.test(message)) return false;
  if (RE_WEB.test(message) || RE_DYN.test(message)) return true;
  try {
    const res = await axios.post(
      CEREBRAS_URL,
      {
        model: CEREBRAS_DEFAULT,
        messages: [{
          role: "user",
          content: `Responda SOMENTE "sim" ou "não". A mensagem requer dados em tempo real, preços atuais, notícias recentes, resultados ou eventos futuros? "${message.slice(0, 280)}"`
        }],
        max_tokens: 3,
        temperature: TEMP.detect
      },
      { headers: { Authorization: `Bearer ${CEREBRAS_KEY}`, "Content-Type": "application/json" }, timeout: 6000 }
    );
    return (res.data?.choices?.[0]?.message?.content || "").toLowerCase().trim().startsWith("sim");
  } catch {
    return false;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  CHAMADAS AOS MODELOS
// ══════════════════════════════════════════════════════════════════════════════
async function callCerebras(msgs, modelId) {
  const model = resolveModel(CEREBRAS_MODELS, modelId, CEREBRAS_DEFAULT);
  const temp  = CEREBRAS_MODELS[model]?.temp ?? TEMP.cerebras;
  const res = await axios.post(
    CEREBRAS_URL,
    { model, messages: msgs, max_tokens: 1024, temperature: temp },
    { headers: { Authorization: `Bearer ${CEREBRAS_KEY}`, "Content-Type": "application/json" }, timeout: 30000 }
  );
  return {
    reply:      res.data?.choices?.[0]?.message?.content || "Sem resposta.",
    model:      res.data?.model || model,
    modelId:    model,
    tokensUsed: res.data?.usage?.total_tokens || 0
  };
}

async function callHF(msgs, modelId) {
  const model = resolveModel(HF_MODELS, modelId, HF_DEFAULT);
  const temp  = HF_MODELS[model]?.temp ?? TEMP.huggingface;
  const res = await axios.post(
    HF_URL,
    { model, messages: msgs, max_tokens: 768, temperature: temp },
    { headers: { Authorization: `Bearer ${HF_KEY}`, "Content-Type": "application/json" }, timeout: 40000 }
  );
  return {
    reply:      res.data?.choices?.[0]?.message?.content || "Sem resposta.",
    model:      res.data?.model || model,
    modelId:    model,
    tokensUsed: res.data?.usage?.total_tokens || 0,
    costPer1M:  HF_MODELS[model]?.costPer1M || 0.10
  };
}

async function callMistralDirect(msgs, modelId) {
  const model = resolveModel(MISTRAL_MODELS, modelId, MISTRAL_DEFAULT);
  const temp  = MISTRAL_MODELS[model]?.temp ?? TEMP.mistral;
  const res = await axios.post(
    MISTRAL_URL,
    { model, messages: msgs, max_tokens: 1024, temperature: temp },
    { headers: { Authorization: `Bearer ${MISTRAL_KEY}`, "Content-Type": "application/json" }, timeout: 40000 }
  );
  const content = res.data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Mistral retornou resposta vazia");
  return { reply: content, model: res.data?.model || model, modelId: model };
}

async function callMistralAgent(msgs) {
  const res = await axios.post(
    MISTRAL_AGENT_URL,
    { agent_id: MISTRAL_AGENT, messages: msgs },
    { headers: { Authorization: `Bearer ${MISTRAL_KEY}`, "Content-Type": "application/json" }, timeout: 45000 }
  );
  const content = res.data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Mistral Agent retornou resposta vazia");
  return { reply: content, model: MISTRAL_WEB_LABEL, modelId: MISTRAL_DEFAULT };
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
    return res.status(405).json({ reply: "Método não permitido", model: "-" });

  try {
    const { message, system, history, webSearch: clientWantsWeb, forceEngine, model: requestedModel } = req.body;

    if (!message) return res.status(400).json({ reply: "Mensagem inválida", model: "-" });

    // ── Status (gratuito) ─────────────────────────────────────────────────────
    if (message === "__model_info__") {
      const snap = await db.collection("chat").doc("limits").get();
      const d    = snap.exists ? snap.data() : {};
      return res.status(200).json({
        reply: "", model: CEREBRAS_DEFAULT, engine: "cerebras",
        cbTokensUsed: d[`cb_tokens_${dayKey()}`] || 0, cbTokensMax: LIM_CB_TOKENS,
        hfCostUsd: d.hf_cost_usd || 0, hfCostMax: LIM_HF_COST_USD, hfWinStart: d.hf_win_start || 0,
        msUsed: d.ms_win_count || 0, msMax: LIM_MS_4H, msWinStart: d.ms_win_start || 0,
        cerebrasModels: Object.entries(CEREBRAS_MODELS).map(([id, v]) => ({ id, label: v.label })),
        hfModels:       Object.entries(HF_MODELS).map(([id, v])       => ({ id, label: v.label, costPer1M: v.costPer1M })),
        mistralModels:  Object.entries(MISTRAL_MODELS).map(([id, v])  => ({ id, label: v.label })),
      });
    }

    // ── Rate limit IP ─────────────────────────────────────────────────────────
    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
    if (!(await checkIpLimit(ip)))
      return res.status(429).json({ reply: "⚠️ Você atingiu 20 requisições por minuto. Aguarde 1 minuto.", model: "-", limitType: "ip_minute" });

    // ── Monta mensagens ───────────────────────────────────────────────────────
    const msgs = [];
    if (system) msgs.push({ role: "system", content: system });
    const cleanHistory = sanitizeHistory(history);
    if (cleanHistory.length > 0) msgs.push(...cleanHistory);
    msgs.push({ role: "user", content: message });

    // ═════════════════════════════════════════════════════════════════════════
    //  ROTA FORÇADA
    // ═════════════════════════════════════════════════════════════════════════
    if (forceEngine === "cerebras") {
      const cl = await checkCerebrasQuota();
      if (!cl.ok)
        return res.status(429).json({ reply: `⚠️ Limite diário do Cerebras atingido (${LIM_CB_TOKENS.toLocaleString()} tokens). Tente outro modelo.`, model: "-", limitType: "daily_cerebras" });
      try {
        const r = await callCerebras(msgs, requestedModel);
        await incrementCerebrasTokens(cl.field, cl.ref, r.tokensUsed);
        return res.status(200).json({ reply: r.reply, model: r.model, modelId: r.modelId, engine: "cerebras", cbTokensUsed: cl.used + r.tokensUsed, cbTokensMax: LIM_CB_TOKENS });
      } catch (e) {
        console.error("Cerebras falhou:", e?.response?.data || e.message);
        return res.status(500).json({ reply: "❌ Cerebras indisponível no momento.", model: "-" });
      }
    }

    if (forceEngine === "huggingface") {
      const modelId = resolveModel(HF_MODELS, requestedModel, HF_DEFAULT);
      const hl      = await checkHFQuota(modelId);
      if (!hl.ok)
        return res.status(429).json({ reply: "⚠️ Limite mensal do HuggingFace atingido (0,8 centavos/mês). Tente outro modelo.", model: "-", limitType: "monthly_hf" });
      try {
        const r = await callHF(msgs, modelId);
        await incrementHFCost(hl.ref, r.tokensUsed, r.costPer1M);
        return res.status(200).json({ reply: r.reply, model: r.model, modelId: r.modelId, engine: "huggingface", hfCostUsd: hl.costUsd, hfCostMax: LIM_HF_COST_USD });
      } catch (e) {
        console.error("HuggingFace falhou:", e?.response?.data || e.message);
        return res.status(500).json({ reply: "❌ HuggingFace indisponível no momento.", model: "-" });
      }
    }

    if (forceEngine === "mistral") {
      const ml = await checkMistral();
      if (!ml.ok) {
        const mins = Math.ceil(ml.resetIn / 60000);
        return res.status(429).json({ reply: `⚠️ Limite do Mistral atingido. Libera em ~${mins} min.`, model: "-", limitType: "mistral_4h" });
      }
      try {
        const useAgent = clientWantsWeb && MISTRAL_AGENT;
        const r = useAgent ? await callMistralAgent(msgs) : await callMistralDirect(msgs, requestedModel);
        return res.status(200).json({ reply: r.reply, model: r.model, modelId: r.modelId, engine: "mistral", msUsed: ml.used, msMax: LIM_MS_4H });
      } catch (e) {
        console.error("Mistral falhou:", e?.response?.data || e.message);
        const errMsg = e?.response?.status === 401 ? "❌ Chave do Mistral inválida." :
                       e?.response?.status === 422 ? "❌ Mistral rejeitou a requisição." :
                       "❌ Mistral indisponível. Tente novamente.";
        return res.status(502).json({ reply: errMsg, model: "-", limitType: "mistral_error" });
      }
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  ROTA AUTOMÁTICA
    // ═════════════════════════════════════════════════════════════════════════
    let useWeb = clientWantsWeb === true || RE_WEB.test(message) || RE_DYN.test(message);
    if (!useWeb) useWeb = await detectWebSearch(message);

    if (useWeb) {
      const ml = await checkMistral();
      if (ml.ok) {
        try {
          const r = MISTRAL_AGENT ? await callMistralAgent(msgs) : await callMistralDirect(msgs, MISTRAL_DEFAULT);
          return res.status(200).json({ reply: r.reply, model: r.model, modelId: r.modelId, engine: "mistral", msUsed: ml.used, msMax: LIM_MS_4H });
        } catch (e) {
          console.error("Mistral falhou (auto-web):", e?.response?.data || e.message);
        }
      } else {
        const mins = Math.ceil(ml.resetIn / 60000);
        msgs[msgs.length - 1].content +=
          `\n\n[Sistema: pesquisa web indisponível — limite de ${LIM_MS_4H}/4h, libera em ~${mins} min. Responda com seu conhecimento e informe o usuário.]`;
      }
    }

    // Cerebras (principal)
    const cl = await checkCerebrasQuota();
    if (cl.ok) {
      try {
        const r = await callCerebras(msgs, CEREBRAS_DEFAULT);
        await incrementCerebrasTokens(cl.field, cl.ref, r.tokensUsed);
        return res.status(200).json({ reply: r.reply, model: r.model, modelId: r.modelId, engine: "cerebras", cbTokensUsed: cl.used + r.tokensUsed, cbTokensMax: LIM_CB_TOKENS });
      } catch (e) {
        console.error("Cerebras falhou (auto):", e?.response?.data || e.message);
      }
    }

    // HuggingFace (fallback)
    const hfModel = resolveModel(HF_MODELS, null, HF_DEFAULT);
    const hl      = await checkHFQuota(hfModel);
    if (!hl.ok)
      return res.status(429).json({ reply: "⚠️ Limite de todos os modelos atingido. Volte amanhã!", model: "-", limitType: "daily_all" });

    const r = await callHF(msgs, hfModel);
    await incrementHFCost(hl.ref, r.tokensUsed, r.costPer1M);
    return res.status(200).json({ reply: r.reply, model: r.model, modelId: r.modelId, engine: "huggingface", hfCostUsd: hl.costUsd, hfCostMax: LIM_HF_COST_USD });

  } catch (err) {
    console.error("ERRO GERAL:", err?.response?.data || err.message || err);
    return res.status(500).json({ reply: "❌ Erro interno da API", model: "-" });
  }
}