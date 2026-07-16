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
const MAX_AGE_MS = 1000 * 60 * 60 * 24; // 24 h

export function calcDraftKey(inModal: boolean) {
  return inModal ? 'mate-calc-draft-modal' : 'mate-calc-draft-hero';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isDeliveryMode(v: unknown): v is CalcDraftDeliveryMode {
  return v === 'home' || v === 'branch' || v === 'locker';
}

function parseDraft(raw: unknown): CalcDraft | null {
  if (!isRecord(raw) || raw.v !== DRAFT_VERSION) return null;
  if (typeof raw.savedAt !== 'number' || Date.now() - raw.savedAt > MAX_AGE_MS) return null;
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

export function loadCalcDraft(inModal: boolean): CalcDraft | null {
  try {
    const raw = sessionStorage.getItem(calcDraftKey(inModal));
    if (!raw) return null;
    return parseDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveCalcDraft(inModal: boolean, draft: Omit<CalcDraft, 'v' | 'savedAt'>) {
  try {
    const payload: CalcDraft = {
      v: DRAFT_VERSION,
      savedAt: Date.now(),
      ...draft,
    };
    sessionStorage.setItem(calcDraftKey(inModal), JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

export function clearCalcDraft(inModal: boolean) {
  try {
    sessionStorage.removeItem(calcDraftKey(inModal));
  } catch {
    /* ignore */
  }
}
