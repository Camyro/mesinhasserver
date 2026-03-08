const ANON_EJS_KEY      = 'fftaponrhcrWIn5Tv';
const ANON_EJS_SERVICE  = 'mesinhastools_autoemail';
const ANON_EJS_TEMPLATE = 'template_hnobsrz';
const FIREBASE_PROJECT  = 'c1studios-mesinhas';
const FIREBASE_API_KEY  = 'AIzaSyC6mBZ-h8g3wQxjLuLRLSEKFaUfuaftm8k';
const ANON_LIMIT        = 180;

function monthKey() {
  const d = new Date();
  return String(d.getMonth() + 1).padStart(2, '0') + d.getFullYear();
}

// Lê o body do request como texto e faz JSON.parse
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

async function getAnonCount() {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/email/anon_mes?key=${FIREBASE_API_KEY}`;
    const res  = await fetch(url);
    const data = await res.json();
    const mk   = monthKey();
    return parseInt(data?.fields?.[mk]?.integerValue || '0');
  } catch { return 0; }
}

async function incrementCounter(anonymous) {
  const mk   = monthKey();
  const docs = [
    { doc: anonymous ? 'anon_geral' : 'normal_geral', field: 'total' },
    { doc: anonymous ? 'anon_mes'   : 'normal_mes',   field: mk      },
  ];
  for (const { doc, field } of docs) {
    try {
      const base = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/email/${doc}?key=${FIREBASE_API_KEY}`;
      const read = await fetch(base);
      const json = await read.json();
      const current = parseInt(json?.fields?.[field]?.integerValue || '0');
      await fetch(`${base}&updateMask.fieldPaths=${field}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ fields: { [field]: { integerValue: String(current + 1) } } })
      });
    } catch { /* não bloqueia o envio */ }
  }
}

async function sendViaEmailJS({ publicKey, serviceId, templateId, toEmail, fromName, fromEmail, subject, message }) {
  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'origin': 'https://mesinhasserver.vercel.app' },
    body: JSON.stringify({
      service_id:  serviceId,
      template_id: templateId,
      user_id:     publicKey,
      template_params: { to_email: toEmail, from_name: fromName, from_email: fromEmail, subject, message }
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`EmailJS ${res.status}: ${text}`);
  }
}

async function sendViaFormspree({ fsId, toEmail, fromName, fromEmail, subject, message }) {
  const res = await fetch(`https://formspree.io/f/${fsId}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ email: fromEmail, name: fromName, _subject: subject, message, to_email: toEmail })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `Formspree ${res.status}`);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ success: false, error: 'Use POST.' });

  const body = await readBody(req);
  const { mode, to, subject, message, from_name, from_email, ejs_key, ejs_service, ejs_template, fs_id } = body;

  if (!mode)    return res.status(400).json({ success: false, error: 'mode é obrigatório' });
  if (!to)      return res.status(400).json({ success: false, error: 'to é obrigatório' });
  if (!subject) return res.status(400).json({ success: false, error: 'subject é obrigatório' });
  if (!message) return res.status(400).json({ success: false, error: 'message é obrigatório' });

  try {
    if (mode === 'anon') {
      const count = await getAnonCount();
      if (count >= ANON_LIMIT)
        return res.status(429).json({ success: false, error: `Limite de ${ANON_LIMIT} envios anônimos atingido` });
      await sendViaEmailJS({
        publicKey: ANON_EJS_KEY, serviceId: ANON_EJS_SERVICE, templateId: ANON_EJS_TEMPLATE,
        toEmail: to, fromName: 'Anônimo', fromEmail: 'nao-responder@anonmail.io', subject, message
      });
      await incrementCounter(true);
      return res.status(200).json({ success: true, mode: 'anon' });
    }

    if (mode === 'emailjs') {
      if (!ejs_key || !ejs_service || !ejs_template)
        return res.status(400).json({ success: false, error: 'ejs_key, ejs_service e ejs_template são obrigatórios' });
      await sendViaEmailJS({
        publicKey: ejs_key, serviceId: ejs_service, templateId: ejs_template,
        toEmail: to, fromName: from_name || 'Remetente', fromEmail: from_email || '', subject, message
      });
      await incrementCounter(false);
      return res.status(200).json({ success: true, mode: 'emailjs' });
    }

    if (mode === 'formspree') {
      if (!fs_id)
        return res.status(400).json({ success: false, error: 'fs_id é obrigatório' });
      await sendViaFormspree({
        fsId: fs_id, toEmail: to, fromName: from_name || 'Remetente',
        fromEmail: from_email || 'nao-responder@anonmail.io', subject, message
      });
      await incrementCounter(false);
      return res.status(200).json({ success: true, mode: 'formspree' });
    }

    return res.status(400).json({ success: false, error: `Mode inválido: "${mode}"` });

  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'Erro interno' });
  }
};