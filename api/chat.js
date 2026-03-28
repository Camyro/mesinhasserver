const axios = require("axios");

// ⚠️ handler correto (CommonJS)
module.exports = async (req, res) => {
  // ✅ CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // ✅ preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Método não permitido" });
  }

  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({
        reply: "Mensagem inválida"
      });
    }

    const response = await axios.post(
      "https://api-inference.huggingface.co/models/google/gemma-2b-it",
      { inputs: message },
      {
        headers: {
          Authorization: `Bearer ${process.env.HF_KEY}`
        }
      }
    );

    let reply = "Erro.";

    if (Array.isArray(response.data)) {
      reply = response.data[0]?.generated_text || reply;
    }

    return res.status(200).json({ reply });

  } catch (err) {
    console.error("ERRO:", err);

    return res.status(500).json({
      reply: "❌ Erro interno"
    });
  }
};