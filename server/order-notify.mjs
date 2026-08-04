import {
  sendOrderStatusEmail,
} from './mail.mjs';

/**
 * Order transactional mail policy:
 * - Do NOT email on create / unpaid / intermediate "paid".
 * - Send ONE actionable email when status becomes waiting_from_you
 *   (drop-off point or courier pickup instructions).
 * Auth emails (welcome / login) stay in auth routes — untouched.
 */
export async function notifyOrderCreated(_order) {
  // Intentionally no-op: no «заявка создана» / «ожидает оплаты» mail.
}

export async function notifyOrderUpdated(before, after) {
  const hasSender = Boolean(after?.customerEmail);
  const hasReceiver = Boolean(after?.payload?.receiver?.email);
  if (!hasSender && !hasReceiver) return;

  const statusChanged = before.status !== after.status;
  if (!statusChanged) return;

  // Only the post-payment “what to do next” letter.
  if (after.status === 'waiting_from_you') {
    await sendOrderStatusEmail(after, before.status);
  }
}
