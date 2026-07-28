import {
  sendOrderCreatedEmail,
  sendOrderStatusEmail,
  sendOrderTrackingEmail,
} from './mail.mjs';

export async function notifyOrderCreated(order) {
  const hasSender = Boolean(order?.customerEmail);
  const hasReceiver = Boolean(order?.payload?.receiver?.email);
  if (!hasSender && !hasReceiver) return;
  await sendOrderCreatedEmail(order);
}

export async function notifyOrderUpdated(before, after) {
  const hasSender = Boolean(after?.customerEmail);
  const hasReceiver = Boolean(after?.payload?.receiver?.email);
  if (!hasSender && !hasReceiver) return;

  const statusChanged = before.status !== after.status;
  const ttnChanged = String(before.npTtn || '') !== String(after.npTtn || '') && Boolean(after.npTtn);

  if (statusChanged) {
    await sendOrderStatusEmail(after, before.status);
  } else if (ttnChanged && after.status !== 'pending_payment') {
    await sendOrderTrackingEmail(after);
  }
}
