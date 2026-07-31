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
  }
  // Also send when TTN appears together with status→waiting_from_you (same update).
  // Previously `else if` skipped tracking, so the recipient only saw «Оплачено» without TTN.
  if (ttnChanged && after.status !== 'pending_payment') {
    await sendOrderTrackingEmail(after);
  }
}
