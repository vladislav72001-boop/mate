/**
 * Generate HTML previews of all transactional emails into server/outbox/
 * Usage: node server/scripts/preview-emails.mjs
 */
import '../load-env.mjs';
import {
  assertMailAssets,
  sendWelcomeEmail,
  sendLoginEmail,
  sendPasswordChangedEmail,
  sendProfileUpdatedEmail,
  sendOrderCreatedEmail,
  sendOrderStatusEmail,
  sendOrderTrackingEmail,
} from '../mail.mjs';

process.env.MAIL_DISABLE = 'true';

const user = {
  id: 'preview-user',
  name: 'Vladislav Sherbakov',
  email: 'preview@matedelivery.com',
  phone: '+36 30 123 4567',
};

const order = {
  id: 'preview-order',
  orderNumber: 'MD-B2C-MRNA2TOE9D7921',
  customerEmail: user.email,
  amount: 24200,
  currency: 'HUF',
  status: 'pending_payment',
  npTtn: null,
  payload: {
    tariff: { fromCountry: 'HU', toCountry: 'DE' },
    receiver: { firstName: 'Vladislav', lastName: 'Sherbakov' },
  },
};

const missing = await assertMailAssets();
if (missing.length) {
  console.error('Missing assets:', missing);
  process.exit(1);
}

await sendWelcomeEmail(user);
await sendLoginEmail(user, { ip: '203.0.113.10' });
await sendPasswordChangedEmail(user);
await sendProfileUpdatedEmail(user);
await sendOrderCreatedEmail(order, {
  checkoutUrl: 'https://checkout.stripe.com/c/pay/preview',
});
await sendOrderStatusEmail({ ...order, status: 'paid' }, 'pending_payment');
await sendOrderStatusEmail({ ...order, status: 'submitted', npTtn: '20450123456789' }, 'paid');
await sendOrderTrackingEmail({
  ...order,
  status: 'submitted',
  npTtn: '20450123456789',
});

console.log('Preview emails written to server/outbox/');
