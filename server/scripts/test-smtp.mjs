import '../load-env.mjs';
import nodemailer from 'nodemailer';

const to = process.argv[2];
if (!to) {
  console.error('Usage: node server/scripts/test-smtp.mjs <email>');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
  requireTLS: process.env.SMTP_SECURE !== 'true' && Number(process.env.SMTP_PORT || 587) === 587,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: { servername: process.env.SMTP_HOST, minVersion: 'TLSv1.2' },
});

await transporter.verify();
console.log(`[mail] SMTP OK (${process.env.SMTP_HOST})`);

const info = await transporter.sendMail({
  from: process.env.MAIL_FROM || process.env.SMTP_USER,
  to,
  subject: 'Тест MATE — проверка SMTP',
  html: `<div style="font-family:Arial,sans-serif">
    <h2>Тест почты MATE</h2>
    <p>Это тестовое письмо. Если вы его видите — уведомления с <strong>info@matedelivery.com</strong> работают.</p>
  </div>`,
});

console.log(`[mail] Sent to ${to}`);
console.log(`[mail] Message-ID: ${info.messageId}`);
