let client = null;

export function stripeEnabled() {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

export async function getStripe() {
  if (!stripeEnabled()) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  if (!client) {
    const Stripe = (await import('stripe')).default;
    client = new Stripe(process.env.STRIPE_SECRET_KEY.trim(), {
      apiVersion: '2025-02-24.acacia',
    });
  }
  return client;
}

export function buildStripeReturnUrls(publicToken) {
  const appUrl = process.env.APP_URL || 'http://localhost:5011';
  const successBase = process.env.STRIPE_B2C_SUCCESS_URL || process.env.STRIPE_SUCCESS_URL || `${appUrl}/?payment=success`;
  const cancelBase = process.env.STRIPE_B2C_CANCEL_URL || process.env.STRIPE_CANCEL_URL || `${appUrl}/?payment=cancel`;
  const successUrl = successBase.includes('token=')
    ? successBase
    : `${successBase}${successBase.includes('?') ? '&' : '?'}token=${publicToken}`;
  const cancelUrl = cancelBase.includes('token=')
    ? cancelBase
    : `${cancelBase}${cancelBase.includes('?') ? '&' : '?'}token=${publicToken}`;
  return { successUrl, cancelUrl };
}

export async function createB2CCheckoutSession({ order, amount, currency, customerEmail }) {
  const stripe = await getStripe();
  const { successUrl, cancelUrl } = buildStripeReturnUrls(order.publicToken);

  return stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: customerEmail,
    line_items: [{
      price_data: {
        currency: currency.toLowerCase(),
        product_data: { name: `MATE доставка ${order.orderNumber}` },
        unit_amount: Math.round(amount * 100),
      },
      quantity: 1,
    }],
    metadata: {
      flow: 'b2c_shipment',
      orderId: order.id,
      publicToken: order.publicToken,
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}

export async function assertStripeSessionPaid(sessionId) {
  const stripe = await getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== 'paid') {
    const err = new Error('Оплата не завершена');
    err.status = 402;
    throw err;
  }
  return session;
}

/** Last4 / brand from paid Checkout Session (best-effort). */
export async function getStripeCheckoutPaymentDetails(sessionId) {
  if (!sessionId || !stripeEnabled()) return null;
  try {
    const stripe = await getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent.payment_method'],
    });
    const pm = session.payment_intent?.payment_method
      || session.payment_method_types?.[0];
    const card = typeof pm === 'object' ? pm?.card : null;
    if (card?.last4) {
      return { last4: String(card.last4), brand: card.brand || null };
    }
    // Fallback: charge list
    const piId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;
    if (piId) {
      const pi = await stripe.paymentIntents.retrieve(piId, {
        expand: ['payment_method'],
      });
      const c = pi.payment_method?.card;
      if (c?.last4) return { last4: String(c.last4), brand: c.brand || null };
    }
  } catch (err) {
    console.warn('[stripe] payment details:', err?.message || err);
  }
  return null;
}
