import { getStoredToken } from './auth';
import { getRuntimeLocale } from '../i18n/translate';
import type { AddressEntry, ShippingOrder } from './client-types';

export type { ShippingOrder, AddressEntry } from './client-types';

type ApiData<T> = { data: T };

function localeHeaders(): Record<string, string> {
  return { 'X-Mate-Locale': getRuntimeLocale() };
}

async function shippingRequest<T>(path: string, options: RequestInit = {}, timeoutMs = 30000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const token = getStoredToken();

  try {
    const res = await fetch(path, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...localeHeaders(),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({})) as {
      error?: string;
      errors?: string[];
      code?: string;
      paymentCaptured?: boolean;
      data?: unknown;
    };
    if (!res.ok) {
      const msg = data.errors?.length
        ? data.errors.join('\n')
        : (data.error || (res.status === 502 || res.status === 503
          ? 'errors.serverDownDev'
          : 'errors.serverTemp'));
      const err = new Error(msg) as Error & {
        code?: string;
        paymentCaptured?: boolean;
        data?: unknown;
        status?: number;
      };
      err.code = data.code;
      err.paymentCaptured = Boolean(data.paymentCaptured);
      err.data = data.data;
      err.status = res.status;
      throw err;
    }
    return data as T;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('errors.serverDownRetry');
    }
    if (err instanceof TypeError) {
      throw new Error('errors.serverDownDev');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export type PriceLogStep = {
  step: number;
  title: string;
  detail?: string;
  value: number;
};

export type PriceBreakdown = {
  cost?: number;
  mode?: string;
  dest?: string;
  weightKg?: number;
  weightKey?: string;
  markupPercent?: number;
  tierId?: string;
  tierLabel?: string;
  discountPercent?: number;
  welcomeDiscountPercent?: number | null;
  welcomeDiscountAmount?: number | null;
  beforeVat?: number;
  afterVat?: number;
  vatEnabled?: boolean;
  vatPercent?: number;
  roundingEnabled?: boolean;
  roundingStep?: number;
  total?: number;
  currency?: string;
  source?: string;
  log?: PriceLogStep[];
};

export type QuoteLocation =
  | {
      kind: 'division';
      countryCode: string;
      divisionId: number;
      /** Display-only fields for emails/UI — ignored by Nova Post quote/create */
      name?: string;
      address?: string;
      phone?: string;
      lat?: number;
      lng?: number;
    }
  | {
      kind: 'address';
      countryCode: string;
      addressParts: {
        city: string;
        street: string;
        postCode: string;
        building: string;
        region?: string;
        flat?: string;
      };
    };

export async function calculateFinal(payload: {
  fromCountry: string;
  toCountry: string;
  declaredValue?: number;
  deliveryMode?: 'home' | 'branch' | 'locker' | 'pudo' | 'address';
  pickupMode?: 'home' | 'branch' | 'locker' | 'pudo' | 'address';
  pickupLocation?: QuoteLocation;
  deliveryLocation?: QuoteLocation;
  payerType?: 'Sender' | 'Recipient';
  parcel: {
    boxSize: string;
    lengthCm: number;
    widthCm: number;
    heightCm: number;
    weightKg: number;
    declaredValue?: number;
  };
}) {
  const res = await shippingRequest<ApiData<{
    total: number;
    amount: number;
    currency: string;
    priceSource?: string;
    breakdown?: PriceBreakdown;
  }>>('/api/shipping/calculate-final', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, 120000);
  const data = res.data;
  return { ...data, total: data.amount ?? data.total };
}

export async function calculateBatch(payload: {
  fromCountry: string;
  toCountry: string;
  declaredValue?: number;
  deliveryMode?: 'home' | 'branch' | 'locker' | 'pudo' | 'address';
  pickupMode?: 'home' | 'branch' | 'locker' | 'pudo' | 'address';
  pickupLocation?: QuoteLocation;
  deliveryLocation?: QuoteLocation;
  payerType?: 'Sender' | 'Recipient';
  sizes: Array<{ boxSize: string; lengthCm: number; widthCm: number; heightCm: number; weightKg: number }>;
}) {
  const res = await shippingRequest<ApiData<{
    quotes: Record<string, {
      total: number;
      currency?: { code?: string } | string;
      priceSource?: string;
      breakdown?: PriceBreakdown;
    } | number>;
    currency?: { code?: string };
    priceSource?: string;
  }>>('/api/shipping/calculate-batch', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, 120000);
  return res.data;
}

export type QuoteSettings = {
  currency: string;
  vatEnabled: boolean;
  vatPercent: number;
  roundingEnabled: boolean;
  roundingStep: number;
  fxFromEur: Record<string, number>;
  fragileFeeEur: number;
  insurancePercent: number;
};

export async function fetchQuoteSettings() {
  const res = await shippingRequest<ApiData<QuoteSettings>>('/api/shipping/quote-settings', {}, 8000);
  return res.data;
}

/** Same rounding as server/pricing-config.mjs — always UP to step */
export function roundQuoteAmount(amount: number, settings: Pick<QuoteSettings, 'roundingEnabled' | 'roundingStep' | 'currency'>) {
  const n = Number(amount) || 0;
  if (!settings.roundingEnabled) {
    return settings.currency === 'HUF' ? Math.round(n) : Math.round(n * 100) / 100;
  }
  const step = Number(settings.roundingStep) || 10;
  if (!(step > 0)) return Math.ceil(n);
  const q = n / step;
  const units = Math.abs(q - Math.round(q)) < 1e-9 ? Math.round(q) : Math.ceil(q);
  return units * step;
}

export function applyQuoteVat(amount: number, settings: Pick<QuoteSettings, 'vatEnabled' | 'vatPercent'>) {
  const n = Number(amount) || 0;
  if (!settings.vatEnabled) return n;
  return n * (1 + (Number(settings.vatPercent) || 0) / 100);
}

export function eurToSettingsCurrency(amountEur: number, settings: Pick<QuoteSettings, 'currency' | 'fxFromEur'>) {
  const code = String(settings.currency || 'HUF').toUpperCase();
  if (!Number.isFinite(amountEur) || amountEur === 0) return 0;
  if (code === 'EUR') return amountEur;
  const rate = Number(settings.fxFromEur?.[code]);
  if (!rate) return 0;
  return amountEur * rate;
}

/** Extras aligned with server computeOrderExtras — insurance = % of delivery tariff. */
export function computeClientExtras(
  baseAmount: number,
  opts: { fragile?: boolean; insurance?: boolean },
  settings: QuoteSettings,
) {
  const base = Number(baseAmount) || 0;
  let fragileFee = 0;
  let insuranceFee = 0;
  if (opts.fragile) {
    const fee = eurToSettingsCurrency(settings.fragileFeeEur ?? 1.98, settings);
    fragileFee = roundQuoteAmount(applyQuoteVat(fee, settings), settings);
  }
  if (opts.insurance) {
    const pct = Number(settings.insurancePercent ?? 1) / 100;
    insuranceFee = roundQuoteAmount(base * pct, settings);
  }
  return {
    base,
    fragileFee,
    insuranceFee,
    insurancePercent: Number(settings.insurancePercent ?? 1),
    total: roundQuoteAmount(base + fragileFee + insuranceFee, settings),
  };
}

export async function checkout(payload: Record<string, unknown>) {
  const res = await shippingRequest<ApiData<{
    checkoutUrl?: string | null;
    mockPayment?: boolean;
    awaitingRecipientPayment?: boolean;
    recipientEmail?: string | null;
    publicToken: string;
    orderNumber: string;
    amount: number;
    currency: string;
  }>>('/api/shipping/checkout', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, 60000);
  return res.data;
}

export async function previewPromoCheckout(payload: Record<string, unknown>) {
  const res = await shippingRequest<ApiData<{
    total: number;
    currency: string;
    priceSource?: string;
    breakdown?: {
      welcomeDiscountPercent?: number | null;
      promoCode?: string | null;
      promoType?: string | null;
      promoValue?: number | null;
      promoDiscountAmount?: number | null;
      deliveryAmount?: number | null;
      fragileFee?: number;
      insuranceFee?: number;
      insurancePercent?: number;
      total?: number;
      [key: string]: unknown;
    } | null;
  }>>('/api/shipping/promo/preview', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, 30000);
  return res.data;
}

export async function confirmPayment(publicToken: string) {
  const res = await shippingRequest<ApiData<ShippingOrder>>(
    `/api/shipping/orders/${publicToken}/confirm-payment`,
    { method: 'POST' },
    90000,
  );
  return res.data;
}

export async function fetchOrderStatus(publicToken: string) {
  const res = await shippingRequest<ApiData<ShippingOrder>>(
    `/api/shipping/orders/status/${publicToken}`,
  );
  return res.data;
}

export async function fetchMyOrders() {
  const res = await shippingRequest<ApiData<ShippingOrder[]>>('/api/shipping/orders/me');
  return res.data;
}

export async function trackByTtn(ttn: string) {
  const res = await shippingRequest<ApiData<ShippingOrder>>(`/api/shipping/track/${encodeURIComponent(ttn)}`);
  return res.data;
}

export async function fetchAddresses() {
  const res = await shippingRequest<ApiData<AddressEntry[]>>('/api/client/addresses');
  return res.data;
}

export async function createAddress(payload: Omit<AddressEntry, 'id' | 'createdAt'>) {
  const res = await shippingRequest<ApiData<AddressEntry>>('/api/client/addresses', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function deleteAddress(id: string) {
  await shippingRequest(`/api/client/addresses/${id}`, { method: 'DELETE' });
}

export async function resumeCheckout(publicToken: string) {
  const res = await shippingRequest<ApiData<{
    checkoutUrl: string;
    publicToken: string;
    orderNumber: string;
    amount: number;
    currency: string;
  }>>(`/api/shipping/orders/${publicToken}/pay`, { method: 'POST' });
  return res.data;
}

export async function cancelOrder(publicToken: string) {
  const res = await shippingRequest<ApiData<ShippingOrder>>(
    `/api/shipping/orders/${publicToken}/cancel`,
    { method: 'POST' },
  );
  return res.data;
}

export function waybillPdfUrl(publicToken: string) {
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  return `${base}/api/shipping/orders/${encodeURIComponent(publicToken)}/waybill.pdf`;
}

export function openWaybillPdf(publicToken: string) {
  const url = waybillPdfUrl(publicToken);
  window.open(url, '_blank', 'noopener,noreferrer');
}

export async function fetchCoverage(params: {
  fromCountry: string;
  fromCity: string;
  toCountry: string;
  toCity: string;
}) {
  const qs = new URLSearchParams({
    fromCountry: params.fromCountry,
    fromCity: params.fromCity,
    toCountry: params.toCountry,
    toCity: params.toCity,
  });
  const res = await shippingRequest<ApiData<{
    pickup: CoverageSide;
    delivery: CoverageSide;
    route: { fromCountry: string; fromCity: string; toCountry: string; toCity: string };
  }>>(`/api/shipping/coverage?${qs}`, {}, 60000);
  return res.data;
}

export type CoverageModeInfo = {
  available: boolean;
  count: number | null;
};

export type CoverageSide = {
  home: CoverageModeInfo;
  locker: CoverageModeInfo;
  pudo: CoverageModeInfo;
  branch: CoverageModeInfo;
  counts: {
    postomat: number;
    pudo: number;
    postBranch: number;
    mateBranch: number;
  };
  source: string;
};

export type ShippingPoint = {
  id: string;
  provider: string;
  address: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  category?: string | null;
  source?: string | null;
};

export async function fetchShippingPoints(params: {
  country: string;
  city: string;
  kind: 'locker' | 'pudo' | 'branch';
  side?: 'pickup' | 'delivery';
}) {
  const qs = new URLSearchParams({
    country: params.country,
    city: params.city,
    kind: params.kind,
    side: params.side || 'delivery',
  });
  const res = await shippingRequest<ApiData<{
    points: ShippingPoint[];
    source: string;
    kind: string;
    side: string;
  }>>(`/api/shipping/points?${qs}`, {}, 60000);
  return res.data;
}

export type AddressSuggestion = {
  id: string;
  label: string;
  street: string;
  city: string;
  postal: string;
  country: string;
  lat: number;
  lng: number;
};

export async function fetchAddressSuggestions(params: {
  q: string;
  country?: string;
  city?: string;
  lang?: string;
}) {
  const qs = new URLSearchParams({ q: params.q.trim() });
  if (params.country) qs.set('country', params.country);
  if (params.city?.trim()) qs.set('city', params.city.trim());
  if (params.lang) qs.set('lang', params.lang);
  const res = await shippingRequest<ApiData<{ suggestions: AddressSuggestion[] }>>(
    `/api/shipping/geocode?${qs}`,
    {},
    15000,
  );
  return res.data.suggestions;
}

export async function updateProfile(payload: {
  name?: string;
  email?: string;
  phone?: string;
  password?: string;
  currentPassword?: string;
}) {
  const res = await shippingRequest<{ user: import('./auth').AuthUser }>('/api/client/profile', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return res.user;
}

export type ClientLoyalty = {
  monthlyShipments: number;
  tier: {
    id: string;
    label: string;
    minShipments: number;
    maxShipments: number | null;
    discountPercent: number | null;
  };
  nextTier: {
    id: string;
    label: string;
    minShipments: number;
    maxShipments: number | null;
    discountPercent: number | null;
  } | null;
  remainingToNext: number | null;
  progressPercent: number;
  period: {
    start: string;
    end: string;
    label: string;
    resetsAt: string;
  };
  tiers: Array<{
    id: string;
    label: string;
    minShipments: number;
    maxShipments: number | null;
    discountPercent: number | null;
  }>;
  welcomeDiscount?: {
    available: boolean;
    percent: number;
  };
};

export async function fetchLoyalty() {
  const res = await shippingRequest<ApiData<ClientLoyalty>>('/api/client/loyalty');
  return res.data;
}
