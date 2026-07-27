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

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const pickupDate = tomorrow.toISOString().slice(0, 10);

const basePayload = {
  sender: {
    name: 'Bohdan Rushchak',
    phone: '+36 20 445 2212',
    country: 'HU',
    line: 'Budapest, Váci út 50, 1134',
  },
  receiver: {
    firstName: 'Bohdan',
    lastName: 'Pashchak',
    country: 'SK',
    destinationLine: 'Bratislava, Farského 12',
    phone: '+421 905 111 222',
  },
  parcel: {
    boxSize: 'S',
    weightKg: 5,
    declaredValue: 100,
    description: 'Одежда',
  },
  cardLast4: '2729',
};

const order = {
  id: 'preview-order',
  orderNumber: 'MD-B2C-MRNA2TOE9D7921',
  customerEmail: user.email,
  amount: 4040,
  currency: 'HUF',
  status: 'pending_payment',
  npTtn: null,
  payload: {
    ...basePayload,
    tariff: { fromCountry: 'HU', toCountry: 'SK' },
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
await sendOrderStatusEmail({ ...order, status: 'submitted', npTtn: 'SHHU0465193482' }, 'paid');
await sendOrderTrackingEmail({
  ...order,
  status: 'submitted',
  npTtn: 'SHHU0465193482',
});

// Mockup-faithful waiting_from_you emails (courier / branch / locker)
const waitingBase = {
  ...order,
  id: 'preview-waiting',
  status: 'waiting_from_you',
  npTtn: 'SHHU0465193482',
  amount: 4040,
  currency: 'HUF',
};

await sendOrderStatusEmail({
  ...waitingBase,
  id: 'preview-courier',
  payload: {
    ...basePayload,
    tariff: {
      fromCountry: 'HU',
      toCountry: 'SK',
      pickupType: 'home',
      pickupMode: 'address',
      deliveryType: 'locker',
      pickupDate,
      pickupTime: '10:00-11:30',
      pickupLocation: {
        kind: 'address',
        countryCode: 'HU',
        addressParts: {
          city: 'Budapest',
          street: 'Váci út',
          building: '50',
          postCode: '1134',
        },
      },
    },
  },
}, 'paid');

await sendOrderStatusEmail({
  ...waitingBase,
  id: 'preview-branch',
  payload: {
    ...basePayload,
    tariff: {
      fromCountry: 'HU',
      toCountry: 'SK',
      pickupType: 'branch',
      pickupMode: 'branch',
      deliveryType: 'locker',
      pickupDate,
      pickupTime: '10:00-11:30',
      pickupLocation: {
        kind: 'division',
        countryCode: 'HU',
        divisionId: 12,
        provider: 'Отделение MATE №12 · Petržalka',
        address: 'Bratislava, Farského 85108',
        phone: '+421 2 445 15 12',
        name: 'Отделение MATE №12',
      },
    },
  },
}, 'paid');

await sendOrderStatusEmail({
  ...waitingBase,
  id: 'preview-locker',
  payload: {
    ...basePayload,
    lockerCode: '418273',
    tariff: {
      fromCountry: 'HU',
      toCountry: 'SK',
      pickupType: 'locker',
      pickupMode: 'locker',
      deliveryType: 'locker',
      pickupDate,
      pickupTime: '10:00-11:30',
      pickupLocation: {
        kind: 'division',
        countryCode: 'SK',
        divisionId: 357025,
        provider: 'Постамат SPS №357025',
        address: 'Bratislava-Petržalka, Panónska 35/12a',
        name: 'Постамат SPS №357025',
      },
    },
  },
}, 'paid');

console.log('Preview emails written to server/outbox/');
