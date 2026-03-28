import axios from "axios";
import admin from "firebase-admin";

// 🔥 init firebase admin com credencial via env var (funciona na Vercel)
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

// 🤖 IA
const API_KEY = process.env.HF_KEY;
const API_URL = "https://router.huggingface.co/hf-inference/models/microsoft/Phi-3-mini-4k-instruct";

// ⚠️ limite
const LIMITE = 20;
const WINDOW_MS = 60000;

async function checkLimit(userId) {
  const ref = db.collection("limits").doc(userId);
  const snap = await ref.get();
  const now = Date.now();

  if (!snap.exists) {
    await ref.set({ count: 1, lastReset: now });
    return true;
  }

  const data = snap.data();

  if (now - data.lastReset > WINDOW_MS) {
    await ref.set({ count: 1, lastReset: now });
    return true;
  }

  if (data.count >= LIMITE) {
    return false;
  }

  await ref.update({ count: data.count + 1 });
  return true;
}

export default async function handler(req, res) {
  // ✅ Cabeçalhos CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // ✅ Responde o preflight (OPTIONS) imediatamente
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ reply: "Método não permitido" });
    }

    const ip =
      req.headers["x-forwarded-for"] ||
      req.socket?.remoteAddress ||
      "unknown";

    const allowed = await checkLimit(ip);
    if (!allowed) {
      return res.status(429).json({
        reply: "⚠️ Limite atingido. Aguarde 1 minuto."
      });
    }

    const { message } = req.body;
    if (!message) {
      return res.status(400).json({
        reply: "Mensagem inválida"
      });
    }

    const response = await axios.post(
      API_URL,
      {
        model: "meta-llama/Meta-Llama-3.1-8B-Instruct",
        messages: [{ role: "user", content: message }],
        max_tokens: 512
      },
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    let reply = "Erro.";
    const data = response.data;
    if (data?.choices?.[0]?.message?.content) {
      reply = data.choices[0].message.content;
    } else if (Array.isArray(data)) {
      reply = data[0]?.generated_text || reply;
    }

    return res.status(200).json({ reply });
  } catch (err) {
    console.error("ERRO REAL:", err);
    return res.status(500).json({
      reply: "❌ Erro interno da API"
    });
  }
}