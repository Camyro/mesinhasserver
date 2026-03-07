async function chamarAPI(prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY_FOR_KAITO_RUN}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
        })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(JSON.stringify(data));
    }

    return data.candidates[0].content.parts[0].text.trim();
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });

    const { action, texto, assunto } = req.body;

    if (action === 'classificar') {
        if (!texto) return res.status(400).json({ error: 'Campo "texto" é obrigatório.' });

        const prompt = `Você é um classificador de assuntos. Sua tarefa é analisar o texto fornecido e determinar se ele representa um assunto/tópico específico.

REGRAS:
1. Se o texto for um assunto/tópico, retorne APENAS o nome do assunto de forma concisa
2. Se o texto NÃO for um assunto, retorne: "NÃO É UM ASSUNTO"
3. Não adicione explicações, pontuação extra ou formatação
4. Normalize o assunto para uma forma clara e padronizada

TEXTO PARA ANALISAR:
${texto}`;

        try {
            const resultado = await chamarAPI(prompt);
            return res.status(200).json({ assunto: resultado });
        } catch (error) {
            console.error('Erro ao classificar:', error);
            return res.status(500).json({ error: 'Erro ao chamar a API Gemini.', detalhe: error.message });
        }
    }

    if (action === 'gerar-perguntas') {
        if (!assunto) return res.status(400).json({ error: 'Campo "assunto" é obrigatório.' });

        const prompt = `Crie exatamente 10 perguntas de múltipla escolha sobre o assunto: ${assunto}

Retorne APENAS um array JSON válido, sem texto adicional:

[
  {
    "question": "Texto da pergunta aqui?",
    "options": ["Opção A", "Opção B", "Opção C", "Opção D"],
    "correct": 0,
    "timeLimit": 10,
    "amount": 1
  }
]

REGRAS:
1. Gere exatamente 10 perguntas com 4 opções cada
2. Varie a dificuldade e a posição da resposta correta
3. Retorne SOMENTE o JSON, sem explicações

ASSUNTO: ${assunto}`;

        try {
            const resultado = await chamarAPI(prompt);
            const json = resultado.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const perguntas = JSON.parse(json);
            return res.status(200).json({ perguntas });
        } catch (error) {
            console.error('Erro ao gerar perguntas:', error);
            return res.status(500).json({ error: 'Erro ao gerar perguntas.', detalhe: error.message });
        }
    }

    return res.status(400).json({ error: 'Action inválida. Use "classificar" ou "gerar-perguntas".' });
}