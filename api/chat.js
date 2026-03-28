import axios from "axios";
import admin from "firebase-admin";

// 🔥 Firebase Admin
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}
const db = admin.firestore();

// 🤖 IA
const API_KEY = process.env.HF_KEY;
const API_URL = "https://router.huggingface.co/v1/chat/completions";
const MODEL   = "meta-llama/Llama-3.1-8B-Instruct:cerebras";

// ⚠️ Limites
const LIMITE_MIN   = 20;    // req/min por IP
const LIMITE_DIA   = 500;   // req/dia global (todos os usuários)
const WINDOW_MS    = 60000; // 1 minuto

// Chave do dia no formato DDMMYYYY
function dayKey() {
  const d = new Date();
  return String(d.getUTCDate()).padStart(2,"0")
       + String(d.getUTCMonth() + 1).padStart(2,"0")
       + d.getUTCFullYear();
}

// ── Limite por minuto (por IP) ──
async function checkIpLimit(ip) {
  const sanitized = ip.replace(/[^a-zA-Z0-9._:-]/g, "_").slice(0, 80);
  const ref  = db.collection("caos_limits").doc("ip_" + sanitized);
  const snap = await ref.get();
  const now  = Date.now();

  if (!snap.exists) {
    await ref.set({ count: 1, lastReset: now });
    return true;
  }

  const data = snap.data();
  if (now - data.lastReset > WINDOW_MS) {
    await ref.set({ count: 1, lastReset: now });
    return true;
  }
  if (data.count >= LIMITE_MIN) return false;
  await ref.update({ count: admin.firestore.FieldValue.increment(1) });
  return true;
}

// ── Limite diário global (compartilhado entre todos) ──
async function checkAndIncrementGlobal() {
  const dk  = dayKey();
  const ref = db.collection("caos_limits").doc("global_day");
  const snap = await ref.get();

  const current = snap.exists ? (snap.data()[dk] || 0) : 0;
  if (current >= LIMITE_DIA) return false;

  const inc = admin.firestore.FieldValue.increment(1);
  await ref.set({ [dk]: inc }, { merge: true });
  return true;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ reply: "Método não permitido", model: MODEL });
    }

    const { message, system } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "Mensagem inválida", model: MODEL });
    }

    // ── Atalho: info do modelo + contadores (não conta no limite) ──
    if (message === "__model_info__") {
      const dk   = dayKey();
      const snap = await db.collection("caos_limits").doc("global_day").get();
      const used = snap.exists ? (snap.data()[dk] || 0) : 0;
      return res.status(200).json({
        reply:     "",
        model:     MODEL,
        dailyUsed: used,
        dailyMax:  LIMITE_DIA
      });
    }

    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim()
             || req.socket?.remoteAddress
             || "unknown";

    // 1️⃣ Checa limite por minuto (por IP)
    const ipOk = await checkIpLimit(ip);
    if (!ipOk) {
      return res.status(429).json({
        reply: "⚠️ Você atingiu 20 requisições por minuto. Aguarde 1 minuto.",
        model: MODEL,
        limitType: "ip_minute"
      });
    }

    // 2️⃣ Checa + incrementa limite diário global
    const globalOk = await checkAndIncrementGlobal();
    if (!globalOk) {
      return res.status(429).json({
        reply: "⚠️ Limite diário global de 200 requisições atingido. Volta amanhã!",
        model: MODEL,
        limitType: "global_day"
      });
    }

    // ── Chama a IA ──
    const messages = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: message });

    const response = await axios.post(
      API_URL,
      { model: MODEL, messages, max_tokens: 512 },
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const returnedModel = response.data?.model || MODEL;
    const reply = response.data?.choices?.[0]?.message?.content || "Sem resposta.";

    return res.status(200).json({ reply, model: returnedModel });

  } catch (err) {
    console.error("ERRO REAL:", err?.response?.data || err.message || err);
    return res.status(500).json({ reply: "❌ Erro interno da API", model: MODEL });
  }
}