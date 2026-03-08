/*
  ══════════════════════════════════════════════════════════════════
  MESINHAS — Email API
  Endpoint: https://mesinhasserver.vercel.app/api/email
  ══════════════════════════════════════════════════════════════════

  POST /api/email
  Content-Type: application/json

  Body:
  {
    "mode":         "anon" | "emailjs" | "formspree",   // obrigatório
    "to":           "dest@email.com",                    // obrigatório
    "subject":      "Assunto",                           // obrigatório
    "message":      "Corpo da mensagem",                 // obrigatório
    "from_name":    "Nome",                              // opcional
    "from_email":   "remetente@email.com",               // opcional

    // só para mode=emailjs:
    "ejs_key":      "SUA_PUBLIC_KEY",
    "ejs_service":  "service_xxxxxxx",
    "ejs_template": "template_xxxxxxx",

    // só para mode=formspree:
    "fs_id":        "abcdefgh"
  }

  Resposta de sucesso:
  { "success": true, "mode": "anon" }

  Resposta de erro:
  { "success": false, "error": "Motivo do erro" }

  CORS: aceita qualquer origem (*).
*/

const https = require('https');

// ── Credenciais hardcoded para mode=anon ──────────────────────────
const ANON_EJS_KEY      = 'fftaponrhcrWIn5Tv';
const ANON_EJS_SERVICE  = 'mesinhastools_autoemail';
const ANON_EJS_TEMPLATE = 'template_hnobsrz';

// ── Firebase config (para contagem anônima) ───────────────────────
const FIREBASE_PROJECT  = 'c1studios-mesinhas';
const FIREBASE_API_KEY  = 'AIzaSyC6mBZ-h8g3wQxjLuLRLSEKFaUfuaftm8k';
const ANON_LIMIT        = 180;

// ── Helpers ───────────────────────────────────────────────────────
function monthKey() {
  const d = new Date();
  return String(d.getMonth() + 1).padStart(2, '0') + d.getFullYear();
}

function firestoreUrl(doc) {
  return `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/email/${doc}?key=${FIREBASE_API_KEY}`;
}

function httpsRequest(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Firestore: ler contador anônimo do mês ────────────────────────
async function getAnonCount() {
  try {
    const res = await httpsRequest(firestoreUrl('anon_mes'), { method: 'GET' });
    const fields = res.body?.fields;
    const mk = monthKey();
    return fields?.[mk]?.integerValue ? parseInt(fields[mk].integerValue) : 0;
  } catch { return 0; }
}

// ── Firestore: incrementar contador ──────────────────────────────
async function incrementCounter(anonymous) {
  const mk = monthKey();
  const docsToUpdate = [
    { doc: anonymous ? 'anon_geral' : 'normal_geral', field: 'total' },
    { doc: anonymous ? 'anon_mes'   : 'normal_mes',   field: mk      },
  ];

  for (const { doc, field } of docsToUpdate) {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/email/${doc}?key=${FIREBASE_API_KEY}`;
    // Lê valor atual
    try {
      const read = await httpsRequest(url, { method: 'GET' });
      const current = parseInt(read.body?.fields?.[field]?.integerValue || '0');
      const patchUrl = url + `&updateMask.fieldPaths=${field}`;
      await httpsRequest(patchUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' }
      }, {
        fields: { [field]: { integerValue: String(current + 1) } }
      });
    } catch { /* não bloqueia o envio */ }
  }
}

// ── EmailJS via REST API ──────────────────────────────────────────
async function sendViaEmailJS({ publicKey, serviceId, templateId, toEmail, fromName, fromEmail, subject, message }) {
  const payload = {
    service_id:   serviceId,
    template_id:  templateId,
    user_id:      publicKey,
    template_params: {
      to_email:   toEmail,
      from_name:  fromName,
      from_email: fromEmail,
      subject,
      message
    }
  };

  const res = await httpsRequest(
    'https://api.emailjs.com/api/v1.0/email/send',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'origin': 'https://mesinhasserver.vercel.app' }
    },
    payload
  );

  if (res.status !== 200) {
    throw new Error(`EmailJS retornou ${res.status}: ${typeof res.body === 'string' ? res.body : JSON.stringify(res.body)}`);
  }
}

// ── Formspree ─────────────────────────────────────────────────────
async function sendViaFormspree({ fsId, toEmail, fromName, fromEmail, subject, message }) {
  const res = await httpsRequest(
    `https://formspree.io/f/${fsId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
    },
    { email: fromEmail, name: fromName, _subject: subject, message, to_email: toEmail }
  );

  if (res.status !== 200 && res.status !== 201) {
    throw new Error(res.body?.error || `Formspree retornou ${res.status}`);
  }
}

// ── Handler principal ─────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ success: false, error: 'Método não permitido. Use POST.' });

  const {
    mode, to, subject, message,
    from_name, from_email,
    ejs_key, ejs_service, ejs_template,
    fs_id
  } = req.body || {};

  // Validação básica
  if (!mode)    return res.status(400).json({ success: false, error: 'Parâmetro mode é obrigatório' });
  if (!to)      return res.status(400).json({ success: false, error: 'Parâmetro to é obrigatório' });
  if (!subject) return res.status(400).json({ success: false, error: 'Parâmetro subject é obrigatório' });
  if (!message) return res.status(400).json({ success: false, error: 'Parâmetro message é obrigatório' });

  try {
    if (mode === 'anon') {
      const count = await getAnonCount();
      if (count >= ANON_LIMIT) {
        return res.status(429).json({ success: false, error: `Limite mensal de ${ANON_LIMIT} e-mails anônimos atingido` });
      }
      await sendViaEmailJS({
        publicKey:  ANON_EJS_KEY,
        serviceId:  ANON_EJS_SERVICE,
        templateId: ANON_EJS_TEMPLATE,
        toEmail:    to,
        fromName:   'Anônimo',
        fromEmail:  'nao-responder@anonmail.io',
        subject,
        message
      });
      await incrementCounter(true);
      return res.status(200).json({ success: true, mode: 'anon' });
    }

    if (mode === 'emailjs') {
      if (!ejs_key || !ejs_service || !ejs_template) {
        return res.status(400).json({ success: false, error: 'Parâmetros ejs_key, ejs_service e ejs_template são obrigatórios para mode=emailjs' });
      }
      await sendViaEmailJS({
        publicKey:  ejs_key,
        serviceId:  ejs_service,
        templateId: ejs_template,
        toEmail:    to,
        fromName:   from_name  || 'Remetente',
        fromEmail:  from_email || '',
        subject,
        message
      });
      await incrementCounter(false);
      return res.status(200).json({ success: true, mode: 'emailjs' });
    }

    if (mode === 'formspree') {
      if (!fs_id) {
        return res.status(400).json({ success: false, error: 'Parâmetro fs_id é obrigatório para mode=formspree' });
      }
      await sendViaFormspree({
        fsId:      fs_id,
        toEmail:   to,
        fromName:  from_name  || 'Remetente',
        fromEmail: from_email || 'nao-responder@anonmail.io',
        subject,
        message
      });
      await incrementCounter(false);
      return res.status(200).json({ success: true, mode: 'formspree' });
    }

    return res.status(400).json({ success: false, error: `Mode inválido: "${mode}". Use anon, emailjs ou formspree` });

  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'Erro interno' });
  }
};