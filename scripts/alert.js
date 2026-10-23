// Mail d'alerte au propriétaire (EMAIL_USER), pas aux destinataires de la newsletter.
//   node scripts/alert.js "Sujet" "Texte"
const nodemailer = require('nodemailer');

async function alert(subject, text) {
  const { EMAIL_USER, EMAIL_PASSWORD } = process.env;
  if (!EMAIL_USER || !EMAIL_PASSWORD) { console.error('EMAIL_USER / EMAIL_PASSWORD manquants : alerte non envoyée'); return; }
  const t = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: EMAIL_USER, pass: EMAIL_PASSWORD } });
  await t.sendMail({ from: `Le Fauteuil Rouge <${EMAIL_USER}>`, to: EMAIL_USER, subject: `⚠️ Fauteuil Rouge : ${subject}`, text });
  console.log(`Alerte envoyée : ${subject}`);
}

module.exports = { alert };

if (require.main === module) alert(process.argv[2] || 'alerte', process.argv[3] || '').catch(e => { console.error(e); process.exit(1); });
