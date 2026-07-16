import {
  sendOrderCreatedEmail,
  sendOrderStatusEmail,
  sendOrderTrackingEmail,
} from './mail.mjs';

export async function notifyOrderCreated(order) {
  if (!order?.customerEmail) return;
  await sendOrderCreatedEmail(order);
}

export async function notifyOrderUpdated(before, after) {
  if (!after?.customerEmail) return;

  const statusChanged = before.status !== after.status;
  const ttnChanged = String(before.npTtn || '') !== String(after.npTtn || '') && Boolean(after.npTtn);

  if (statusChanged) {
    await sendOrderStatusEmail(after, before.status);
  } else if (ttnChanged && after.status !== 'pending_payment') {
    await sendOrderTrackingEmail(after);
  }
}
