import axios from "axios";
import admin from "firebase-admin";

// 🔥 Firebase Admin
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

// ══════════════════════════════════════════════
//  MODELOS
// ══════════════════════════════════════════════
const CEREBRAS_URL   = "https://api.cerebras.ai/v1/chat/completions";
const CEREBRAS_MODEL = "llama3.1-8b";
const CEREBRAS_KEY   = process.env.CEREBRAS_KEY;

const HF_URL   = "https://router.huggingface.co/v1/chat/completions";
const HF_MODEL = "meta-llama/Llama-3.1-8B-Instruct:cerebras";
const HF_KEY   = process.env.HF_KEY;

const MISTRAL_URL   = "https://api.mistral.ai/v1/agents/completions";
const MISTRAL_AGENT = process.env.MISTRAL_AGENT_ID;
const MISTRAL_KEY   = process.env.MISTRAL_KEY;
const MISTRAL_LABEL = "Mistral · web search";

// ══════════════════════════════════════════════
//  LIMITES
// ══════════════════════════════════════════════
const LIM_IP_MIN = 20;
const LIM_CB_DIA = 800;
const LIM_HF_DIA = 200;
const LIM_MS_4H  = 30;
const WIN_1MIN   = 60_000;
const WIN_4H     = 4 * 3_600_000;

// ══════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════
function dayKey() {
  const d = new Date();
  return "d"
    + String(d.getUTCDate()).padStart(2, "0")
    + String(d.getUTCMonth() + 1).padStart(2, "0")
    + d.getUTCFullYear();
}

// ══════════════════════════════════════════════
//  RATE LIMIT POR IP (janela 1 min)
// ══════════════════════════════════════════════
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

// ══════════════════════════════════════════════
//  LIMITE DIÁRIO CEREBRAS
// ══════════════════════════════════════════════
async function checkCerebras() {
  const dk    = dayKey();
  const field = `cb_${dk}`;
  const ref   = db.collection("chat").doc("limits");
  const snap  = await ref.get();
  const used  = snap.exists ? (snap.data()[field] || 0) : 0;
  if (used >= LIM_CB_DIA) return { ok: false, used };
  await ref.set({ [field]: admin.firestore.FieldValue.increment(1) }, { merge: true });
  return { ok: true, used: used + 1 };
}

// ══════════════════════════════════════════════
//  LIMITE DIÁRIO HUGGINGFACE
// ══════════════════════════════════════════════
async function checkHF() {
  const dk    = dayKey();
  const field = `hf_${dk}`;
  const ref   = db.collection("chat").doc("limits");
  const snap  = await ref.get();
  const used  = snap.exists ? (snap.data()[field] || 0) : 0;
  if (used >= LIM_HF_DIA) return { ok: false, used };
  await ref.set({ [field]: admin.firestore.FieldValue.increment(1) }, { merge: true });
  return { ok: true, used: used + 1 };
}

// ══════════════════════════════════════════════
//  LIMITE MISTRAL 30 REQ / 4H
// ══════════════════════════════════════════════
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
  if (wCount >= LIM_MS_4H) {
    return { ok: false, used: wCount, resetIn: WIN_4H - (now - wStart) };
  }
  await ref.update({ ms_win_count: admin.firestore.FieldValue.increment(1) });
  return { ok: true, used: wCount + 1, resetIn: WIN_4H - (now - wStart) };
}

// ══════════════════════════════════════════════
//  DETECÇÃO AUTOMÁTICA: precisa de web search?
// ══════════════════════════════════════════════
async function detectWebSearch(message) {
  try {
    const res = await axios.post(
      CEREBRAS_URL,
      {
        model: CEREBRAS_MODEL,
        messages: [{
          role: "user",
          content:
            `Responda SOMENTE "sim" ou "não". ` +
            `A seguinte pergunta exige dados em tempo real, notícias recentes ou eventos após 2023? ` +
            `"${message}"`
        }],
        max_tokens: 5,
        temperature: 0
      },
      {
        headers: { Authorization: `Bearer ${CEREBRAS_KEY}`, "Content-Type": "application/json" },
        timeout: 8000
      }
    );
    return (res.data?.choices?.[0]?.message?.content || "").toLowerCase().includes("sim");
  } catch {
    return false;
  }
}

// ══════════════════════════════════════════════
//  CHAMADAS AOS MODELOS
// ══════════════════════════════════════════════
async function callCerebras(msgs) {
  const res = await axios.post(
    CEREBRAS_URL,
    { model: CEREBRAS_MODEL, messages: msgs, max_tokens: 1024 },
    {
      headers: { Authorization: `Bearer ${CEREBRAS_KEY}`, "Content-Type": "application/json" },
      timeout: 30000
    }
  );
  return {
    reply: res.data?.choices?.[0]?.message?.content || "Sem resposta.",
    model: res.data?.model || CEREBRAS_MODEL
  };
}

async function callHF(msgs) {
  const res = await axios.post(
    HF_URL,
    { model: HF_MODEL, messages: msgs, max_tokens: 512 },
    {
      headers: { Authorization: `Bearer ${HF_KEY}`, "Content-Type": "application/json" },
      timeout: 30000
    }
  );
  return {
    reply: res.data?.choices?.[0]?.message?.content || "Sem resposta.",
    model: res.data?.model || HF_MODEL
  };
}

async function callMistral(msgs) {
  const res = await axios.post(
    MISTRAL_URL,
    { agent_id: MISTRAL_AGENT, messages: msgs },
    {
      headers: { Authorization: `Bearer ${MISTRAL_KEY}`, "Content-Type": "application/json" },
      timeout: 40000
    }
  );
  return {
    reply: res.data?.choices?.[0]?.message?.content || "Sem resposta.",
    model: MISTRAL_LABEL
  };
}

// ══════════════════════════════════════════════
//  HANDLER PRINCIPAL
// ══════════════════════════════════════════════
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ reply: "Método não permitido", model: "-" });

  try {
    const { message, system, webSearch: clientWantsWeb, forceEngine } = req.body;

    if (!message)
      return res.status(400).json({ reply: "Mensagem inválida", model: "-" });

    // ── Info de status (não conta em nenhum limite) ──
    if (message === "__model_info__") {
      const dk   = dayKey();
      const snap = await db.collection("chat").doc("limits").get();
      const d    = snap.exists ? snap.data() : {};
      return res.status(200).json({
        reply:      "",
        model:      CEREBRAS_MODEL,
        engine:     "cerebras",
        cbUsed:     d[`cb_${dk}`]  || 0,
        cbMax:      LIM_CB_DIA,
        hfUsed:     d[`hf_${dk}`]  || 0,
        hfMax:      LIM_HF_DIA,
        msUsed:     d.ms_win_count  || 0,
        msMax:      LIM_MS_4H,
        msWinStart: d.ms_win_start  || 0
      });
    }

    // ── Rate limit por IP ──
    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim()
             || req.socket?.remoteAddress || "unknown";
    if (!(await checkIpLimit(ip)))
      return res.status(429).json({
        reply: "⚠️ Você atingiu 20 requisições por minuto. Aguarde 1 minuto.",
        model: "-", limitType: "ip_minute"
      });

    // ── Monta histórico ──
    const msgs = [];
    if (system) msgs.push({ role: "system", content: system });
    msgs.push({ role: "user", content: message });

    // ══════════════════════════════════════════
    //  ROTA FORÇADA — cliente escolheu um engine
    // ══════════════════════════════════════════
    if (forceEngine === "cerebras") {
      const cl = await checkCerebras();
      if (!cl.ok)
        return res.status(429).json({
          reply: "⚠️ Limite diário do Cerebras atingido. Tente outro modelo.",
          model: "-", limitType: "daily_cerebras"
        });
      try {
        const { reply, model } = await callCerebras(msgs);
        return res.status(200).json({ reply, model, engine: "cerebras", cbUsed: cl.used, cbMax: LIM_CB_DIA });
      } catch (e) {
        console.error("Cerebras falhou:", e?.response?.data || e.message);
        return res.status(500).json({ reply: "❌ Cerebras indisponível no momento.", model: "-" });
      }
    }

    if (forceEngine === "huggingface") {
      const hl = await checkHF();
      if (!hl.ok)
        return res.status(429).json({
          reply: "⚠️ Limite diário do HuggingFace atingido. Tente outro modelo.",
          model: "-", limitType: "daily_hf"
        });
      try {
        const { reply, model } = await callHF(msgs);
        return res.status(200).json({ reply, model, engine: "huggingface", hfUsed: hl.used, hfMax: LIM_HF_DIA });
      } catch (e) {
        console.error("HuggingFace falhou:", e?.response?.data || e.message);
        return res.status(500).json({ reply: "❌ HuggingFace indisponível no momento.", model: "-" });
      }
    }

    if (forceEngine === "mistral") {
      const ml = await checkMistral();
      if (!ml.ok) {
        const mins = Math.ceil(ml.resetIn / 60000);
        return res.status(429).json({
          reply: `⚠️ Limite do Mistral atingido. Libera em ~${mins} min.`,
          model: "-", limitType: "mistral_4h"
        });
      }
      try {
        const { reply, model } = await callMistral(msgs);
        return res.status(200).json({ reply, model, engine: "mistral", msUsed: ml.used, msMax: LIM_MS_4H });
      } catch (e) {
        console.error("Mistral falhou:", e?.response?.data || e.message);
        return res.status(500).json({ reply: "❌ Mistral indisponível no momento.", model: "-" });
      }
    }

    // ══════════════════════════════════════════
    //  ROTA AUTOMÁTICA — decide engine por si só
    // ══════════════════════════════════════════
    const keywordHit = /\b(pesquisa(?:r)?|busca(?:r)?|search|notícia|noticia|noticias?|atual(?:iza)?|recente|hoje|agora|últim|ultim|2024|2025|2026)\b/i
      .test(message);

    let useWeb = clientWantsWeb === true || keywordHit;
    if (!useWeb) useWeb = await detectWebSearch(message);

    if (useWeb) {
      const ml = await checkMistral();
      if (ml.ok) {
        try {
          const { reply, model } = await callMistral(msgs);
          return res.status(200).json({ reply, model, engine: "mistral", msUsed: ml.used, msMax: LIM_MS_4H });
        } catch (e) {
          console.error("Mistral falhou:", e?.response?.data || e.message);
          // Mistral falhou → cai no fluxo normal
        }
      } else {
        const mins = Math.ceil(ml.resetIn / 60000);
        msgs[msgs.length - 1].content +=
          `\n\n[Sistema: pesquisa web indisponível — limite de ${LIM_MS_4H} req/4h atingido, ` +
          `libera em ~${mins} min. Responda com seu conhecimento e informe ao usuário.]`;
      }
    }

    // Cerebras
    const cl = await checkCerebras();
    if (cl.ok) {
      try {
        const { reply, model } = await callCerebras(msgs);
        return res.status(200).json({ reply, model, engine: "cerebras", cbUsed: cl.used, cbMax: LIM_CB_DIA });
      } catch (e) {
        console.error("Cerebras falhou:", e?.response?.data || e.message);
      }
    }

    // HuggingFace fallback
    const hl = await checkHF();
    if (!hl.ok)
      return res.status(429).json({
        reply: "⚠️ Limite diário de todos os modelos atingido. Volta amanhã!",
        model: "-", limitType: "daily_all"
      });

    const { reply, model } = await callHF(msgs);
    return res.status(200).json({ reply, model, engine: "huggingface", hfUsed: hl.used, hfMax: LIM_HF_DIA });

  } catch (err) {
    console.error("ERRO GERAL:", err?.response?.data || err.message || err);
    return res.status(500).json({ reply: "❌ Erro interno da API", model: "-" });
  }
}