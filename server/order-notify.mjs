import {
  sendOrderStatusEmail,
} from './mail.mjs';

/**
 * Order transactional mail policy:
 * - Do NOT email on create / unpaid / intermediate "paid".
 * - waiting_from_you → drop-off / courier instructions (sender).
 * - submitted → parcel accepted / in transit (after NP status sync).
 * - delivered → delivered to recipient.
 * Arrived-at-locker/PUDO mail is sent separately from shipping sync
 * (maybeNotifyArrivedAtPoint) and suppresses the generic "submitted" letter
 * when NP jumps straight to arrived-at-point.
 * Auth emails (welcome / login) stay in auth routes — untouched.
 */
const MAIL_ON_STATUS = new Set(['waiting_from_you', 'submitted', 'delivered']);

export async function notifyOrderCreated(_order) {
  // Intentionally no-op: no «заявка создана» / «ожидает оплаты» mail.
}

export async function notifyOrderUpdated(before, after) {
  const hasSender = Boolean(after?.customerEmail);
  const hasReceiver = Boolean(after?.payload?.receiver?.email);
  if (!hasSender && !hasReceiver) return;

  const statusChanged = before.status !== after.status;
  if (!statusChanged) return;

  if (MAIL_ON_STATUS.has(after.status)) {
    await sendOrderStatusEmail(after, before.status);
  }
}
