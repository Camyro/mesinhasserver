export default async function handler(req, res) {
    // 1️⃣ Adiciona cabeçalhos CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // 2️⃣ Responde requisições OPTIONS (pré-flight)
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // 3️⃣ Sua lógica normal
  res.status(200).json({ message: "API funcionando!" });

  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido" });
  }

  try {
    const { tipo, mensagem } = req.body;

    // 🔥 Exemplo: integração com OpenAI
    if (tipo === "chat") {

      const resposta = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "user", content: mensagem }
          ]
        })
      });

      const dados = await resposta.json();

      return res.status(200).json({
        sucesso: true,
        resposta: dados.choices?.[0]?.message?.content || "Sem resposta"
      });
    }

    // Você pode adicionar mais APIs aqui
    if (tipo === "echo") {
      return res.status(200).json({
        sucesso: true,
        resposta: "Echo: " + mensagem
      });
    }

    return res.status(400).json({ erro: "Tipo inválido" });

  } catch (erro) {
    return res.status(500).json({ erro: "Erro interno", detalhe: erro.message });
  }
}