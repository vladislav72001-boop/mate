import type { TrackingEvent } from '../../api/client-types';

const EVENT_KEYS: Record<string, string> = {
  created: 'dash.trackCreated',
  cancelled: 'dash.trackCancelled',
  pickup: 'dash.trackPickup',
  transit: 'dash.trackTransit',
  delivery: 'dash.trackDelivery',
};

export function trackingEventLabel(
  ev: TrackingEvent,
  t: (key: string) => string,
) {
  if (ev.id === 'payment') {
    return ev.done ? t('dash.trackPaid') : t('dash.trackPaymentPending');
  }
  const key = EVENT_KEYS[ev.id];
  if (key) return t(key);
  return ev.title;
}
