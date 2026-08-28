import { mirrorAnalyticsToMeta } from './metaPixel';

const SESSION_KEY = 'mate_analytics_sid';

function randomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function getAnalyticsSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing && existing.length >= 8) return existing;
    const id = randomId();
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return randomId();
  }
}

type AnalyticsPayload = {
  event: 'calc_step' | 'calc_pay_click' | 'calc_checkout_ok' | 'page_view';
  step?: number;
  toCountry?: string;
  fromCity?: string;
  toCity?: string;
  sizeKey?: string;
  pickupMode?: string;
  deliveryMode?: string;
  locale?: string;
  page?: string;
  amount?: number;
  currency?: string;
};

/** Fire-and-forget analytics; never blocks UI. */
export function trackAnalytics(payload: AnalyticsPayload) {
  try {
    mirrorAnalyticsToMeta(payload.event, {
      toCountry: payload.toCountry,
      amount: payload.amount,
      currency: payload.currency,
    });
    const body = {
      sessionId: getAnalyticsSessionId(),
      ...payload,
    };
    void fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore
  }
}
