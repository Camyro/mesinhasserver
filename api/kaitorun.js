import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

async function chamarAPI(prompt) {
    const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
    });
    return response.choices[0].message.content.trim();
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido. Use POST.' });
    }

    const { action, texto, assunto } = req.body;

    // ── CLASSIFICAR ASSUNTO ──────────────────────────────────────────────────
    if (action === 'classificar') {
        if (!texto) {
            return res.status(400).json({ error: 'Campo "texto" é obrigatório.' });
        }

        const prompt = `Você é um classificador de assuntos. Sua tarefa é analisar o texto fornecido e determinar se ele representa um assunto/tópico específico.

      REGRAS:
      1. Se o texto for um assunto/tópico, retorne APENAS o nome do assunto de forma concisa
      2. Se o texto NÃO for um assunto (por exemplo, uma frase completa, pergunta, comando), retorne: "NÃO É UM ASSUNTO"
      3. Não adicione explicações, pontuação extra ou formatação
      4. Normalize o assunto para uma forma clara e padronizada

      EXEMPLOS:
      Entrada: "Matemática"
      Saída: Matemática

      Entrada: "inteligência artificial"
      Saída: Inteligência Artificial

      Entrada: "história do brasil"
      Saída: História do Brasil

      Entrada: "Você pode me explicar sobre física quântica?"
      Saída: NÃO É UM ASSUNTO

      Entrada: "Estou estudando para a prova"
      Saída: NÃO É UM ASSUNTO

      Entrada: "química orgânica"
      Saída: Química Orgânica

      Entrada: "programação em python"
      Saída: Programação em Python

      Entrada: "Como funciona a fotossíntese?"
      Saída: NÃO É UM ASSUNTO

      TEXTO PARA ANALISAR:
      ${texto}`;

        try {
            const resultado = await chamarAPI(prompt);
            return res.status(200).json({ assunto: resultado });
        } catch (error) {
            console.error('Erro ao classificar:', error);
            return res.status(500).json({ error: 'Erro ao chamar a API OpenAI.' });
        }
    }

    // ── GERAR PERGUNTAS ──────────────────────────────────────────────────────
    if (action === 'gerar-perguntas') {
        if (!assunto) {
            return res.status(400).json({ error: 'Campo "assunto" é obrigatório.' });
        }

        const prompt = `
Crie exatamente 10 perguntas de múltipla escolha sobre o assunto: ${assunto}

FORMATO OBRIGATÓRIO (JSON):
Retorne APENAS um array JSON válido, sem texto adicional, seguindo exatamente este formato:

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
1. Gere exatamente 10 perguntas
2. Cada pergunta deve ter 4 opções de resposta
3. O campo "correct" indica o índice da resposta correta (0, 1, 2 ou 3)
4. O campo "timeLimit" deve ser definido por você baseado na complexidade da pergunta:
   - Perguntas fáceis/diretas: 8-10 segundos
   - Perguntas médias: 12-15 segundos
   - Perguntas difíceis/complexas: 18-20 segundos
5. Varie a dificuldade das perguntas (fácil, médio, difícil)
6. As perguntas devem ser claras e objetivas
7. Misture a posição da resposta correta (não coloque sempre na mesma posição)
8. Retorne SOMENTE o JSON, sem explicações ou texto adicional

ASSUNTO: ${assunto}`;

        try {
            const resultado = await chamarAPI(prompt);
            const json = resultado.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const perguntas = JSON.parse(json);
            return res.status(200).json({ perguntas });
        } catch (error) {
            console.error('Erro ao gerar perguntas:', error);
            return res.status(500).json({ error: 'Erro ao gerar perguntas.' });
        }
    }

    // ── ACTION INVÁLIDA ──────────────────────────────────────────────────────
    return res.status(400).json({ error: 'Action inválida. Use "classificar" ou "gerar-perguntas".' });
}