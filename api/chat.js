import axios from "axios";

export default async function handler(req, res) {
  try {
    // ✅ CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }

    if (req.method !== "POST") {
      return res.status(405).json({ reply: "Método não permitido" });
    }

    const { message } = req.body || {};

    if (!message) {
      return res.status(400).json({ reply: "Mensagem inválida" });
    }

    if (!process.env.HF_KEY) {
      return res.status(500).json({
        reply: "❌ API key não configurada"
      });
    }

    const response = await axios.post(
      "https://api-inference.huggingface.co/models/google/gemma-2b-it",
      { inputs: message },
      {
        headers: {
          Authorization: `Bearer ${process.env.HF_KEY}`
        },
        timeout: 10000
      }
    );

    let reply = "Erro.";

    if (Array.isArray(response.data)) {
      reply = response.data[0]?.generated_text || reply;
    }

    return res.status(200).json({ reply });

  } catch (err) {
    console.error("🔥 ERRO REAL:", err?.response?.data || err.message);

    return res.status(500).json({
      reply: "❌ Erro interno"
    });
  }
}