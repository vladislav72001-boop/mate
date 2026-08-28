/** Meta (Facebook) Pixel — ID from marketing team. */
export const META_PIXEL_ID = '1059734696786111';

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    _fbq?: (...args: unknown[]) => void;
  }
}

function fbq(...args: unknown[]) {
  try {
    window.fbq?.(...args);
  } catch {
    // never block UI
  }
}

export function trackMetaPageView() {
  fbq('track', 'PageView');
}

export function trackMetaInitiateCheckout(params?: Record<string, unknown>) {
  fbq('track', 'InitiateCheckout', params);
}

export function trackMetaPurchase(params?: Record<string, unknown>) {
  fbq('track', 'Purchase', params);
}

export function trackMetaLead(params?: Record<string, unknown>) {
  fbq('track', 'Lead', params);
}

/** Map Mate analytics events → Meta Pixel standard events. */
export function mirrorAnalyticsToMeta(
  event: string,
  extra?: { toCountry?: string; amount?: number; currency?: string },
) {
  if (event === 'page_view') {
    trackMetaPageView();
    return;
  }
  if (event === 'calc_pay_click') {
    trackMetaInitiateCheckout({
      content_category: 'shipping',
      ...(extra?.toCountry ? { content_ids: [extra.toCountry] } : {}),
    });
    return;
  }
  if (event === 'calc_checkout_ok') {
    trackMetaPurchase({
      content_category: 'shipping',
      ...(extra?.toCountry ? { content_ids: [extra.toCountry] } : {}),
      ...(extra?.amount != null ? { value: extra.amount, currency: extra.currency || 'HUF' } : {}),
    });
  }
}
