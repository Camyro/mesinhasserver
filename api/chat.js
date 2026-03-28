const axios = require("axios");

module.exports = async (req, res) => {
  try {
    // ✅ CORS SEMPRE PRIMEIRO
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    // ✅ preflight
    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }

    // 🚫 método errado
    if (req.method !== "POST") {
      return res.status(405).json({
        reply: "Método não permitido"
      });
    }

    // ⚠️ body seguro (evita crash)
    const body = req.body || {};
    const message = body.message;

    if (!message) {
      return res.status(400).json({
        reply: "Mensagem inválida"
      });
    }

    // ⚠️ verifica API key
    if (!process.env.HF_KEY) {
      return res.status(500).json({
        reply: "❌ API key não configurada"
      });
    }

    // 🤖 chamada IA
    const response = await axios.post(
      "https://api-inference.huggingface.co/models/google/gemma-2b-it",
      { inputs: message },
      {
        headers: {
          Authorization: `Bearer ${process.env.HF_KEY}`
        },
        timeout: 10000 // evita travar
      }
    );

    let reply = "Erro ao gerar resposta.";

    if (Array.isArray(response.data)) {
      reply = response.data[0]?.generated_text || reply;
    }

    return res.status(200).json({ reply });

  } catch (err) {
    console.error("🔥 ERRO REAL:", err?.response?.data || err.message);

    return res.status(500).json({
      reply: "❌ Erro interno da API"
    });
  }
};