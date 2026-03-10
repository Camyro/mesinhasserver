const ANON_EJS_KEY      = 'fftaponrhcrWIn5Tv';
const ANON_EJS_SERVICE  = 'mesinhastools_autoemail';
const ANON_EJS_TEMPLATE = 'template_hnobsrz';
const FIREBASE_PROJECT  = 'c1studios-mesinhas';
const FIREBASE_API_KEY  = 'AIzaSyC6mBZ-h8g3wQxjLuLRLSEKFaUfuaftm8k';
const ANON_LIMIT        = 180;

function monthKey() {
  const d = new Date();
  return String(d.getMonth() + 1).padStart(2, '0') + String(d.getFullYear());
}

function fsUrl(doc) {
  return `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/email/${doc}?key=${FIREBASE_API_KEY}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

async function getAnonCount() {
  try {
    const res  = await fetch(fsUrl('anon_mes'));
    const data = await res.json();
    const mk   = monthKey();
    return parseInt(data?.fields?.[mk]?.integerValue || '0');
  } catch { return 0; }
}

async function incrementCounter() {
  const mk = monthKey();
  const docs = [
    { doc: 'anon_geral', field: 'total' },
    { doc: 'anon_mes',   field: mk      },
  ];

  for (const { doc, field } of docs) {
    try {
      const commitUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:commit?key=${FIREBASE_API_KEY}`;
      const docPath   = `projects/${FIREBASE_PROJECT}/databases/(default)/documents/email/${doc}`;
      await fetch(commitUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          writes: [{
            transform: {
              document: docPath,
              fieldTransforms: [{
                fieldPath: '`' + field + '`',
                increment: { integerValue: '1' }
              }]
            }
          }]
        })
      });
    } catch { /* não bloqueia o envio */ }
  }
}

async function sendViaEmailJS({ toEmail, subject, message }) {
  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'origin': 'https://mesinhasserver.vercel.app' },
    body: JSON.stringify({
      service_id:  ANON_EJS_SERVICE,
      template_id: ANON_EJS_TEMPLATE,
      user_id:     ANON_EJS_KEY,
      template_params: {
        to_email:   toEmail,
        from_name:  'Anônimo',
        from_email: 'nao-responder@anonmail.io',
        subject,
        message
      }
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`EmailJS ${res.status}: ${text}`);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ success: false, error: 'Use POST.' });

  const body = await readBody(req);
  const { to, subject, message } = body;

  if (!to)      return res.status(400).json({ success: false, error: 'to é obrigatório' });
  if (!subject) return res.status(400).json({ success: false, error: 'subject é obrigatório' });
  if (!message) return res.status(400).json({ success: false, error: 'message é obrigatório' });

  try {
    const count = await getAnonCount();
    if (count >= ANON_LIMIT)
      return res.status(429).json({ success: false, error: `Limite de ${ANON_LIMIT} envios anônimos atingido` });

    await sendViaEmailJS({ toEmail: to, subject, message });
    await incrementCounter();
    return res.status(200).json({ success: true, mode: 'anon' });

  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'Erro interno' });
  }
}