export type CalcDraftDeliveryMode = 'home' | 'branch' | 'locker';
export type CalcDraftContentKey = 'documents' | 'clothing' | 'shoes' | 'cosmetics' | 'electronics' | 'gift' | 'other';
export type CalcDraftValueKey = 'under100' | 'mid' | 'high' | 'over';
export type CalcDraftSizeKey = 'envelope' | 'S' | 'M' | 'L' | 'XL' | 'XXL' | 'custom';

export type CalcDraft = {
  v: 1;
  savedAt: number;
  step: number;
  toCountry: string;
  pickupType: CalcDraftDeliveryMode;
  deliveryType: CalcDraftDeliveryMode;
  sizeKey: CalcDraftSizeKey;
  customSize: { l: string; w: string; h: string; kg: string };
  contents: CalcDraftContentKey;
  contentsNote: string;
  contentValue: CalcDraftValueKey;
  payer: 'sender' | 'receiver';
  pickupStreet: string;
  pickupAddressQuery: string;
  pickupCity: string;
  pickupPostal: string;
  destStreet: string;
  destCity: string;
  destPostal: string;
  destAddressQuery: string;
  destAddressFocus: { lat: number; lng: number } | null;
  destAddressReady: boolean;
  pickupAddressFocus: { lat: number; lng: number } | null;
  pickupAddressReady: boolean;
  geoPickupCity: string;
  pickupCityFromGeo: boolean;
  pickupCityTouched: boolean;
  pickupDate: string;
  pickupTime: string;
  pickupLocker: string;
  pickupBranch: string;
  destLocker: string;
  destBranch: string;
  fragile: boolean;
  insurance: boolean;
  senderName: string;
  senderEmail: string;
  senderDial: string;
  senderPhone: string;
  receiverFirst: string;
  receiverLast: string;
  receiverDial: string;
  receiverPhone: string;
  termsAccepted: boolean;
};

const DRAFT_VERSION = 1 as const;
const MAX_AGE_MS = 1000 * 60 * 60 * 24; // 24 h — guest session
const MAX_CART_AGE_MS = 1000 * 60 * 60 * 24 * 14; // 14 d — logged-in cart

export const CALC_DRAFT_EVENT = 'mate-calc-draft-change';

export function notifyCalcDraftChange() {
  window.dispatchEvent(new CustomEvent(CALC_DRAFT_EVENT));
}

export function calcDraftKey(inModal: boolean) {
  return inModal ? 'mate-calc-draft-modal' : 'mate-calc-draft-hero';
}

export function calcCartKey(userId: string) {
  return `mate-calc-cart-${userId}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isDeliveryMode(v: unknown): v is CalcDraftDeliveryMode {
  return v === 'home' || v === 'branch' || v === 'locker';
}

function parseDraft(raw: unknown, maxAgeMs: number): CalcDraft | null {
  if (!isRecord(raw) || raw.v !== DRAFT_VERSION) return null;
  if (typeof raw.savedAt !== 'number' || Date.now() - raw.savedAt > maxAgeMs) return null;
  if (typeof raw.step !== 'number' || raw.step < 1 || raw.step > 9) return null;
  if (typeof raw.toCountry !== 'string') return null;
  if (!isDeliveryMode(raw.pickupType) || !isDeliveryMode(raw.deliveryType)) return null;
  if (typeof raw.sizeKey !== 'string') return null;
  if (!isRecord(raw.customSize)) return null;

  const focus = raw.destAddressFocus;
  let destAddressFocus: { lat: number; lng: number } | null = null;
  if (isRecord(focus) && typeof focus.lat === 'number' && typeof focus.lng === 'number') {
    destAddressFocus = { lat: focus.lat, lng: focus.lng };
  }

  const pickupFocus = raw.pickupAddressFocus;
  let pickupAddressFocus: { lat: number; lng: number } | null = null;
  if (isRecord(pickupFocus) && typeof pickupFocus.lat === 'number' && typeof pickupFocus.lng === 'number') {
    pickupAddressFocus = { lat: pickupFocus.lat, lng: pickupFocus.lng };
  }

  return {
    v: DRAFT_VERSION,
    savedAt: raw.savedAt,
    step: raw.step,
    toCountry: raw.toCountry,
    pickupType: raw.pickupType,
    deliveryType: raw.deliveryType,
    sizeKey: raw.sizeKey as CalcDraftSizeKey,
    customSize: {
      l: String(raw.customSize.l ?? ''),
      w: String(raw.customSize.w ?? ''),
      h: String(raw.customSize.h ?? ''),
      kg: String(raw.customSize.kg ?? ''),
    },
    contents: (raw.contents as CalcDraftContentKey) || 'gift',
    contentsNote: String(raw.contentsNote ?? ''),
    contentValue: (raw.contentValue as CalcDraftValueKey) || 'under100',
    payer: raw.payer === 'sender' ? 'sender' : 'receiver',
    pickupStreet: String(raw.pickupStreet ?? ''),
    pickupAddressQuery: String(raw.pickupAddressQuery ?? ''),
    pickupCity: String(raw.pickupCity ?? ''),
    pickupPostal: String(raw.pickupPostal ?? ''),
    destStreet: String(raw.destStreet ?? ''),
    destCity: String(raw.destCity ?? ''),
    destPostal: String(raw.destPostal ?? ''),
    destAddressQuery: String(raw.destAddressQuery ?? ''),
    destAddressFocus,
    destAddressReady: Boolean(raw.destAddressReady),
    pickupAddressFocus,
    pickupAddressReady: Boolean(raw.pickupAddressReady),
    geoPickupCity: String(raw.geoPickupCity ?? ''),
    pickupCityFromGeo: Boolean(raw.pickupCityFromGeo),
    pickupCityTouched: Boolean(raw.pickupCityTouched),
    pickupDate: String(raw.pickupDate ?? ''),
    pickupTime: String(raw.pickupTime ?? ''),
    pickupLocker: String(raw.pickupLocker ?? ''),
    pickupBranch: String(raw.pickupBranch ?? ''),
    destLocker: String(raw.destLocker ?? ''),
    destBranch: String(raw.destBranch ?? ''),
    fragile: Boolean(raw.fragile),
    insurance: Boolean(raw.insurance),
    senderName: String(raw.senderName ?? ''),
    senderEmail: String(raw.senderEmail ?? ''),
    senderDial: String(raw.senderDial ?? ''),
    senderPhone: String(raw.senderPhone ?? ''),
    receiverFirst: String(raw.receiverFirst ?? ''),
    receiverLast: String(raw.receiverLast ?? ''),
    receiverDial: String(raw.receiverDial ?? ''),
    receiverPhone: String(raw.receiverPhone ?? ''),
    termsAccepted: Boolean(raw.termsAccepted),
  };
}

function readFromStorage(storage: Storage, key: string, maxAgeMs: number): CalcDraft | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return parseDraft(JSON.parse(raw), maxAgeMs);
  } catch {
    return null;
  }
}

function writePayload(storage: Storage, key: string, draft: Omit<CalcDraft, 'v' | 'savedAt'>) {
  const payload: CalcDraft = {
    v: DRAFT_VERSION,
    savedAt: Date.now(),
    ...draft,
  };
  storage.setItem(key, JSON.stringify(payload));
}

function latestSessionDraft(preferredInModal: boolean): CalcDraft | null {
  const preferred = readFromStorage(sessionStorage, calcDraftKey(preferredInModal), MAX_AGE_MS);
  const fallback = readFromStorage(sessionStorage, calcDraftKey(!preferredInModal), MAX_AGE_MS);
  if (preferred && fallback) {
    return preferred.savedAt >= fallback.savedAt ? preferred : fallback;
  }
  return preferred ?? fallback;
}

export function loadCalcDraft(inModal: boolean, userId?: string | null): CalcDraft | null {
  if (userId) {
    const cart = readFromStorage(localStorage, calcCartKey(userId), MAX_CART_AGE_MS);
    if (cart) return cart;
  }
  return latestSessionDraft(inModal);
}

/** Best available draft for cart chip — prefers logged-in cart, then modal, then hero. */
export function loadActiveCalcDraft(userId?: string | null): CalcDraft | null {
  if (userId) {
    const cart = readFromStorage(localStorage, calcCartKey(userId), MAX_CART_AGE_MS);
    if (cart) return cart;
  }
  return latestSessionDraft(true);
}

function readExistingDraft(inModal: boolean, userId?: string | null): CalcDraft | null {
  if (userId) {
    return readFromStorage(localStorage, calcCartKey(userId), MAX_CART_AGE_MS);
  }
  return latestSessionDraft(inModal);
}

/** Avoid overwriting real progress when UI is reset to step 1 without user stepping back. */
function mergeDraftStep(
  incoming: Omit<CalcDraft, 'v' | 'savedAt'>,
  inModal: boolean,
  userId?: string | null,
): Omit<CalcDraft, 'v' | 'savedAt'> {
  const existing = readExistingDraft(inModal, userId);
  if (!existing) return incoming;
  if (incoming.step >= existing.step) return incoming;
  const stepDrop = existing.step - incoming.step;
  // Large jump back to step 1 with filled route data is usually a UI reset, not user Back.
  if (
    incoming.step <= 1
    && stepDrop > 1
    && (incoming.destCity.trim() || incoming.pickupCity.trim())
  ) {
    return { ...incoming, step: existing.step };
  }
  return incoming;
}

export function saveCalcDraft(
  inModal: boolean,
  draft: Omit<CalcDraft, 'v' | 'savedAt'>,
  userId?: string | null,
) {
  try {
    const payload = mergeDraftStep(draft, inModal, userId);
    if (userId) {
      writePayload(localStorage, calcCartKey(userId), payload);
      writePayload(sessionStorage, calcDraftKey(true), payload);
      writePayload(sessionStorage, calcDraftKey(false), payload);
    } else {
      writePayload(sessionStorage, calcDraftKey(inModal), payload);
    }
    notifyCalcDraftChange();
  } catch {
    /* quota / private mode */
  }
}

export function clearCalcDraft(inModal: boolean, userId?: string | null) {
  try {
    if (userId) {
      localStorage.removeItem(calcCartKey(userId));
    }
    sessionStorage.removeItem(calcDraftKey(true));
    sessionStorage.removeItem(calcDraftKey(false));
    notifyCalcDraftChange();
  } catch {
    /* ignore */
  }
}

/** Merge guest session draft into user cart after login (keeps newest). */
export function mergeGuestDraftIntoCart(userId: string) {
  const modal = readFromStorage(sessionStorage, calcDraftKey(true), MAX_AGE_MS);
  const hero = readFromStorage(sessionStorage, calcDraftKey(false), MAX_AGE_MS);
  const guest = [modal, hero].filter(Boolean).sort((a, b) => b!.savedAt - a!.savedAt)[0] ?? null;
  if (!guest) return;

  const existing = readFromStorage(localStorage, calcCartKey(userId), MAX_CART_AGE_MS);
  if (!existing || guest.savedAt > existing.savedAt) {
    const { v: _v, savedAt: _s, ...rest } = guest;
    saveCalcDraft(true, rest, userId);
  }
}
