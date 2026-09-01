import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AuthUser } from '../api/auth';
import {
  calculateBatch,
  checkout,
  confirmPayment,
  computeClientExtras,
  previewPromoCheckout,
  fetchAddresses,
  fetchCoverage,
  fetchOrderStatus,
  fetchQuoteSettings,
  fetchShippingPoints,
  trackByTtn,
  type AddressEntry,
  type AddressSuggestion,
  type CoverageSide,
  type QuoteSettings,
  type QuoteLocation,
  type ShippingOrder,
  type ShippingPoint,
} from '../api/shipping';
import {
  DIAL_BY_CC,
  DEFAULT_QUOTE_CURRENCY,
  NONSTANDARD_LIMITS,
  PARCEL_PRESETS,
  PICKUP_COUNTRY,
  PICKUP_WITHIN_DAY,
  SIZE_ALLOWED_MODES,
  coerceCourierPickupDate,
  isCourierPickupWeekend,
  nextCourierPickupDateIso,
  formatQuoteMoney,
  composePhone,
  validateEmail,
  validatePersonName,
  validatePhone,
  estimateParcelPrice,
  type ParcelKey,
  countryLabel,
  countryCodeFromDial,
} from '../constants/shipping';
import { deliveryEtaForCountry } from '../constants/deliveryEta';
import { formatScheduledDelivery } from './calc/orderSuccessHelpers';
import { TrackingMap } from './client-dash/TrackingMap';
import {
  LockerPicker,
  detectCityByGeolocation,
} from './calc/LockerPicker';
import {
  citiesForCountry,
  canonicalCityValue,
  cityLabelForValue,
  defaultCityValueForCountry,
} from '../constants/cities';
import { CountryFlag } from './calc/CountryFlag';
import { CountrySelect } from './calc/CountrySelect';
import { CitySelect } from './calc/CitySelect';
import { PhoneDialField } from './calc/PhoneDialField';
import { AddressSuggest } from './calc/AddressSuggest';
import {
  OrderSummary,
  formatRoute,
  type SummaryRow,
} from './calc/OrderSummary';
import {
  loadCalcDraft,
  clearAllCalcDrafts,
  suppressCalcDraftWrites,
  splitPersonName,
} from './calc/calcDraft';
import { useCalcDraftPersistence } from './calc/useCalcDraft';
import { trackAnalytics } from '../utils/analytics';
import { useI18n } from '../i18n/context';
import { localizeApiError } from '../i18n/localizeApiError';
import { localeToIntl } from '../i18n/config';
import { trackingEventLabel } from './client-dash/trackingLabels';

type FormProps = {
  user?: AuthUser | null;
  initialTo?: string;
  onSuccess?: (order: ShippingOrder) => void;
  onAwaitingRecipientPayment?: (info: {
    orderNumber: string;
    publicToken: string;
    recipientEmail: string;
    amount: number;
    currency: string;
  }) => void;
  onDone?: () => void;
  inModal?: boolean;
  onStepChange?: (step: number) => void;
  /** Increment to force calculator back to step 1 (e.g. backdrop dismiss). */
  resetToStep1Signal?: number;
  /** Start from step 1 but still load saved field values for hints. */
  startFromStep1?: boolean;
};

type DeliveryMode = 'home' | 'branch' | 'locker' | 'pudo';
type ContentKey = 'documents' | 'clothing' | 'shoes' | 'cosmetics' | 'electronics' | 'gift' | 'other';
type ValueKey = 'under100' | 'mid' | 'high' | 'over';
type SizeKey = 'envelope' | ParcelKey | 'XXL' | 'custom';

function isPointPickupMode(mode: DeliveryMode): mode is 'locker' | 'pudo' | 'branch' {
  return mode === 'locker' || mode === 'pudo' || mode === 'branch';
}

function isLockerLikeMode(mode: DeliveryMode): mode is 'locker' | 'pudo' {
  return mode === 'locker' || mode === 'pudo';
}

function pointsKindForMode(mode: 'locker' | 'pudo' | 'branch'): 'locker' | 'pudo' | 'branch' {
  return mode;
}

const PARCEL_KEYS: ParcelKey[] = ['XS', 'S', 'M', 'L'];
/** Live quotes for all selectable parcel sizes. */
const STEP3_QUOTE_KEYS: ParcelKey[] = ['XS', 'S', 'M', 'L'];
const STEP_SUMMARY_KEYS: Record<number, string[]> = {
  1: ['from'],
  2: ['from', 'cities'],
  3: ['from', 'cities', 'size'],
  4: ['from', 'cities', 'size', 'type'],
  5: ['from', 'cities', 'size', 'type', 'sender', 'when'],
  6: ['from', 'cities', 'size', 'type', 'sender', 'recipient', 'when'],
  7: ['from', 'cities', 'size', 'type', 'sender', 'recipient', 'when', 'contents'],
  8: ['from', 'cities', 'size', 'type', 'sender', 'recipient', 'when', 'contents', 'value', 'pays'],
  9: ['from', 'cities', 'type', 'size', 'contents', 'value', 'pays', 'sender', 'recipient', 'when'],
};

const TOTAL_STEPS = 9;

function isEnvelopeSize(sizeKey: SizeKey) {
  return sizeKey === 'XS' || sizeKey === 'envelope';
}

/** Envelope = documents: skip contents (7); keep value/payer (8) so who-pays is always choosable. */
function nextCalcStep(step: number, sizeKey: SizeKey) {
  let n = step + 1;
  if (isEnvelopeSize(sizeKey) && n === 7) n = 8;
  return Math.min(n, TOTAL_STEPS);
}

function prevCalcStep(step: number, sizeKey: SizeKey) {
  let n = step - 1;
  if (isEnvelopeSize(sizeKey) && n === 7) n = 6;
  return Math.max(n, 1);
}

const ENVELOPE_PRESET = { lengthCm: 35, widthCm: 25, heightCm: 2, weightKg: 0.2 };

/** Preset sizes + non-standard (weight slider → tariff). */
const SIZE_OPTION_KEYS: Array<ParcelKey | 'custom'> = ['XS', 'S', 'M', 'L', 'custom'];
const MAX_CUSTOM_WEIGHT_KG = NONSTANDARD_LIMITS.maxWeightKg;
const CUSTOM_WEIGHT_MIN_KG = 0.1;

const CUSTOM_WEIGHT_TIERS = [
  {
    key: 'XS',
    maxKg: 2,
    // Courier-only small parcel — not document/envelope dims (those underprice ≤2 kg customs).
    dims: { lengthCm: 5, widthCm: 35, heightCm: 50, weightKg: 2 },
    title: { ru: 'XS · до 2 кг', en: 'XS · up to 2 kg', hu: 'XS · 2 kg-ig', uk: 'XS · до 2 кг' },
    dimsLabel: {
      ru: 'до 5 × 35 × 50 см · только курьер',
      en: 'up to 5 × 35 × 50 cm · courier only',
      hu: 'max. 5 × 35 × 50 cm · csak futár',
      uk: 'до 5 × 35 × 50 см · тільки курʼєр',
    },
  },
  {
    key: 'S',
    maxKg: 5,
    dims: { ...PARCEL_PRESETS.S },
    title: { ru: 'S · до 5 кг', en: 'S · up to 5 kg', hu: 'S · 5 kg-ig', uk: 'S · до 5 кг' },
  },
  {
    key: 'M',
    maxKg: 10,
    dims: { ...PARCEL_PRESETS.M },
    title: { ru: 'M · до 10 кг', en: 'M · up to 10 kg', hu: 'M · 10 kg-ig', uk: 'M · до 10 кг' },
  },
  {
    key: 'L',
    maxKg: 20,
    dims: { ...PARCEL_PRESETS.L },
    title: { ru: 'L · до 20 кг', en: 'L · up to 20 kg', hu: 'L · 20 kg-ig', uk: 'L · до 20 кг' },
  },
  {
    key: 'XL',
    maxKg: 30,
    dims: { ...PARCEL_PRESETS.XL },
    title: { ru: 'XL · до 30 кг', en: 'XL · up to 30 kg', hu: 'XL · 30 kg-ig', uk: 'XL · до 30 кг' },
  },
] as const;

/** Slider scale labels (kg), aligned with CUSTOM_WEIGHT_TIERS. */
const CUSTOM_WEIGHT_SCALE = [
  { w: 0.1, labelKey: 'xs' as const },
  { w: 2, labelKey: '2' as const },
  { w: 5, labelKey: 's5' as const },
  { w: 10, labelKey: 'm10' as const },
  { w: 20, labelKey: 'l20' as const },
  { w: 30, labelKey: 'max' as const },
] as const;

const SIZE_ICONS: Record<ParcelKey, string> = {
  XS: '✉️',
  S: '📦',
  M: '📦',
  L: '🗃',
  XL: '📥',
};

const MODE_CHIP_ORDER: DeliveryMode[] = ['locker', 'branch', 'home'];

const CONTENT_KEYS: ContentKey[] = ['documents', 'clothing', 'shoes', 'cosmetics', 'electronics', 'gift', 'other'];

function parseStreetAndBuilding(
  raw: string,
  extras: { city?: string; postCode?: string } = {},
): { street: string; building: string } {
  const value = String(raw || '').trim();
  if (!value) return { street: '', building: '' };

  const postalDigits = String(extras.postCode || '').replace(/\D/g, '');
  const cityName = String(extras.city || '').trim();
  const first = value.split(',')[0]?.trim() || value;
  let streetLine = first;
  if (cityName && streetLine.toLowerCase() === cityName.toLowerCase()) {
    streetLine = value;
  }

  const houseMatch = streetLine.match(/^(.*?)[\s,]+(\d+[a-zA-Z]?(?:[/-]\d*[a-zA-Z]?)?)$/u);
  if (houseMatch?.[1] && houseMatch[2]) {
    const street = houseMatch[1].trim();
    const building = houseMatch[2].trim();
    const buildingDigits = building.replace(/\D/g, '');
    const looksLikePostal = /^\d{4,6}$/.test(building)
      && (!postalDigits || buildingDigits === postalDigits);
    if (street && !looksLikePostal) return { street, building };
  }

  return { street: streetLine, building: '1' };
}

function withHouseFromQuery(street: string, typedQuery: string, extras: { city?: string; postCode?: string }) {
  const fromStreet = parseStreetAndBuilding(street, extras);
  const fromTyped = parseStreetAndBuilding(typedQuery, extras);
  const building = fromStreet.building !== '1'
    ? fromStreet.building
    : (fromTyped.building !== '1' ? fromTyped.building : '');
  const base = fromStreet.street || fromTyped.street || street.trim();
  return building ? `${base} ${building}`.trim() : base;
}

function addressQuoteLocation(
  countryCode: string,
  city: string,
  streetWithBuilding: string,
  postCode: string,
): QuoteLocation | undefined {
  const { street, building } = parseStreetAndBuilding(streetWithBuilding, { city, postCode });
  if (!city.trim() || !street || !building || !postCode.trim()) return undefined;
  return {
    kind: 'address',
    countryCode,
    addressParts: {
      city: city.trim(),
      region: city.trim(),
      street,
      building,
      postCode: postCode.trim(),
    },
  };
}

function divisionQuoteLocation(
  countryCode: string,
  id: string,
  meta?: {
    name?: string;
    address?: string;
    phone?: string;
    lat?: number;
    lng?: number;
  },
): QuoteLocation | undefined {
  const divisionId = Number(id);
  if (!Number.isInteger(divisionId) || divisionId <= 0) return undefined;
  const loc: QuoteLocation = { kind: 'division', countryCode, divisionId };
  if (meta?.name) loc.name = meta.name;
  if (meta?.address) loc.address = meta.address;
  if (meta?.phone) loc.phone = meta.phone;
  if (Number.isFinite(meta?.lat) && meta!.lat !== 0) loc.lat = meta!.lat;
  if (Number.isFinite(meta?.lng) && meta!.lng !== 0) loc.lng = meta!.lng;
  return loc;
}

function pointMeta(point: ShippingPoint | null | undefined) {
  if (!point) return undefined;
  return {
    name: point.provider || undefined,
    address: point.address || undefined,
    lat: point.lat || undefined,
    lng: point.lng || undefined,
  };
}

function isNpDivisionId(id: string | number | null | undefined): boolean {
  return /^\d+$/.test(String(id || '')) && Number(id) > 0;
}

/** Keep only Nova Post numeric division IDs — catalog placeholders cannot be quoted. */
function preferQuoteablePoints<T extends { id: string }>(points: T[]): T[] {
  return points.filter((p) => isNpDivisionId(p.id));
}

function firstNpDivisionId(points: Array<{ id: string }>): string {
  const hit = points.find((p) => isNpDivisionId(p.id));
  return hit ? String(hit.id) : '';
}

function sanitizeDivisionId(id: string | null | undefined): string {
  return isNpDivisionId(id) ? String(id) : '';
}

async function fetchFirstDivisionLocation(
  country: string,
  city: string,
  kind: 'locker' | 'pudo' | 'branch',
  side: 'pickup' | 'delivery',
): Promise<QuoteLocation | undefined> {
  if (!city.trim()) return undefined;
  const res = await fetchShippingPoints({ country, city: city.trim(), kind, side });
  const id = firstNpDivisionId(res.points || []);
  return id ? divisionQuoteLocation(country, id) : undefined;
}

function placeholderAddressQuoteLocation(countryCode: string, city: string): QuoteLocation | undefined {
  if (!city.trim()) return undefined;
  return {
    kind: 'address',
    countryCode,
    addressParts: {
      city: city.trim(),
      street: 'Main',
      building: '1',
      postCode: '00000',
    },
  };
}

async function resolvePreliminaryQuoteLocations(
  pickupType: DeliveryMode,
  deliveryType: DeliveryMode,
  pickupCity: string,
  destCity: string,
  toCountry: string,
): Promise<{ pickup?: QuoteLocation; delivery?: QuoteLocation }> {
  const firstInCity = async (
    country: string,
    city: string,
    kind: 'locker' | 'pudo' | 'branch',
    side: 'pickup' | 'delivery',
  ) => fetchFirstDivisionLocation(country, city, kind, side);

  const resolveSide = async (
    mode: DeliveryMode,
    country: string,
    city: string,
    side: 'pickup' | 'delivery',
  ) => {
    if (mode === 'home') {
      return placeholderAddressQuoteLocation(country, city);
    }
    const preferredKind = pointsKindForMode(mode);
    const primary = await firstInCity(country, city, preferredKind, side);
    if (primary) return primary;
    // Soft fallback only for preliminary catalog quotes when the preferred
    // point type is missing in a city (exact selected points never use this path).
    const fallbackKinds: Array<'locker' | 'pudo' | 'branch'> = preferredKind === 'branch'
      ? ['locker', 'pudo']
      : preferredKind === 'locker'
        ? ['pudo', 'branch']
        : ['locker', 'branch'];
    for (const kind of fallbackKinds) {
      const hit = await firstInCity(country, city, kind, side);
      if (hit) return hit;
    }
    return undefined;
  };

  const [pickup, delivery] = await Promise.all([
    resolveSide(pickupType, PICKUP_COUNTRY, pickupCity, 'pickup'),
    resolveSide(deliveryType, toCountry, destCity, 'delivery'),
  ]);
  return { pickup, delivery };
}
const VALUE_KEYS: ValueKey[] = ['under100', 'mid', 'high', 'over'];
const DELIVERY_MODE_KEYS: DeliveryMode[] = ['locker', 'pudo', 'branch', 'home'];

const DELIVERY_MODE_ICONS: Record<DeliveryMode, string> = {
  home: '🏠',
  branch: '🏢',
  locker: '📦',
  pudo: '🏪',
};

const MODE_ORDER: DeliveryMode[] = ['locker', 'pudo', 'branch', 'home'];
/** Prefer branch/home for pickup while locker drop-off is coming soon. */
const PICKUP_MODE_ORDER: DeliveryMode[] = ['branch', 'home', 'pudo', 'locker'];

/** Pickup from locker is not live yet — show the option disabled with "Soon". */
const PICKUP_FROM_LOCKER_COMING_SOON = true;

const CONTENT_ICONS: Record<ContentKey, string> = {
  documents: '📄',
  clothing: '👕',
  shoes: '👟',
  cosmetics: '💄',
  electronics: '📱',
  gift: '🎁',
  other: '📦',
};

function firstAvailableMode(
  side: CoverageSide | null | undefined,
  preferred?: DeliveryMode,
  order: DeliveryMode[] = MODE_ORDER,
  excluded: ReadonlyArray<DeliveryMode> = [],
): DeliveryMode {
  if (preferred && !excluded.includes(preferred) && side?.[preferred]?.available) {
    return preferred;
  }
  for (const key of order) {
    if (excluded.includes(key)) continue;
    if (side?.[key]?.available) return key;
  }
  return order.find((k) => !excluded.includes(k)) ?? 'home';
}

function pickupExcludedModes(): DeliveryMode[] {
  return PICKUP_FROM_LOCKER_COMING_SOON ? ['locker'] : [];
}

function normalizePickupMode(mode: DeliveryMode | undefined | null): DeliveryMode {
  if (!mode || (PICKUP_FROM_LOCKER_COMING_SOON && mode === 'locker')) return 'branch';
  return mode;
}

const VALUE_TO_EUR: Record<ValueKey, number> = {
  under100: 80,
  mid: 300,
  high: 750,
  over: 1500,
};

function tomorrowIso() {
  return nextCourierPickupDateIso();
}

/** Tier limits — keep in sync with server/novapost/parcel.mjs */
const PARCEL_LIMITS: Record<ParcelKey, { maxLongestCm: number; maxGirthCm: number; maxWeightKg: number }> = {
  XS: { maxLongestCm: 50, maxGirthCm: 180, maxWeightKg: 1 },
  S: { maxLongestCm: 60, maxGirthCm: 200, maxWeightKg: 5 },
  M: { maxLongestCm: 60, maxGirthCm: 220, maxWeightKg: 10 },
  L: { maxLongestCm: 60, maxGirthCm: 240, maxWeightKg: 20 },
  XL: { maxLongestCm: 120, maxGirthCm: 300, maxWeightKg: 30 },
};

function sortedSidesCm(l: number, w: number, h: number) {
  return [l, w, h].map((cm) => Math.max(0.1, cm)).sort((a, b) => b - a);
}

function fitsParcelTier(lengthCm: number, widthCm: number, heightCm: number, weightKg: number, tier: ParcelKey) {
  const limits = PARCEL_LIMITS[tier];
  const [longest, middle, shortest] = sortedSidesCm(lengthCm, widthCm, heightCm);
  const girth = longest + 2 * (middle + shortest);
  return weightKg <= limits.maxWeightKg
    && longest <= limits.maxLongestCm
    && girth <= limits.maxGirthCm;
}

/** Official Nova Post parcel envelope — branch/courier, not locker-sized tiers. */
function fitsNpCustomParcelRules(lengthCm: number, widthCm: number, heightCm: number, weightKg: number) {
  const [longest, middle, shortest] = sortedSidesCm(lengthCm, widthCm, heightCm);
  const sumSides = longest + middle + shortest;
  return weightKg <= NONSTANDARD_LIMITS.maxWeightKg
    && longest <= NONSTANDARD_LIMITS.maxLengthCm
    && sumSides <= NONSTANDARD_LIMITS.maxSumSidesCm;
}

function modesForSize(
  sizeKey: SizeKey,
  custom?: { l: string; w: string; h: string; kg: string },
): ReadonlyArray<DeliveryMode> {
  if (sizeKey === 'envelope') return SIZE_ALLOWED_MODES.S;
  if (sizeKey === 'XXL') return SIZE_ALLOWED_MODES.XL;
  if (sizeKey === 'custom') {
    const lengthCm = Math.max(1, Number(custom?.l) || 0);
    const widthCm = Math.max(1, Number(custom?.w) || 0);
    const heightCm = Math.max(1, Number(custom?.h) || 0);
    const weightKg = Math.max(0.1, Number(custom?.kg) || 0);
    if (lengthCm && widthCm && heightCm && weightKg) {
      // Locker/branch tiers — stop at L; XL home-only applies to weight band, not loose NP dims.
      for (const tier of (['XS', 'S', 'M', 'L'] as ParcelKey[])) {
        if (fitsParcelTier(lengthCm, widthCm, heightCm, weightKg, tier)) {
          return SIZE_ALLOWED_MODES[tier];
        }
      }
      if (fitsNpCustomParcelRules(lengthCm, widthCm, heightCm, weightKg)) {
        if (weightKg > PARCEL_LIMITS.L.maxWeightKg) {
          return SIZE_ALLOWED_MODES.XL;
        }
        return SIZE_ALLOWED_MODES.custom;
      }
    }
    // Beyond NP limits — courier only.
    return ['home'];
  }
  return SIZE_ALLOWED_MODES[sizeKey] ?? SIZE_ALLOWED_MODES.M;
}

function clampModeToSize(
  mode: DeliveryMode,
  sizeKey: SizeKey,
  side?: CoverageSide | null,
  excluded: ReadonlyArray<DeliveryMode> = [],
  custom?: { l: string; w: string; h: string; kg: string },
): DeliveryMode {
  const allowed = modesForSize(sizeKey, custom);
  const isOk = (key: DeliveryMode) => (
    !excluded.includes(key)
    && allowed.includes(key)
    && (!side || side[key]?.available !== false)
  );
  if (isOk(mode)) return mode;
  for (const key of MODE_ORDER) {
    if (isOk(key)) return key;
  }
  const fallback = allowed.find((k) => !excluded.includes(k));
  return fallback ?? (allowed.includes('home') ? 'home' : (allowed[0] ?? 'home'));
}

/** Map UI size to API boxSize. Custom uses dims+weight — never default to S when custom is missing. */
function sizeToApiKey(
  sizeKey: SizeKey,
  custom?: { l: string; w: string; h: string; kg: string },
): ParcelKey {
  if (sizeKey === 'envelope') return 'XS';
  if (sizeKey === 'XXL') return 'XL';
  if (sizeKey === 'custom') {
    const lengthCm = Math.max(1, Number(custom?.l) || 30);
    const widthCm = Math.max(1, Number(custom?.w) || 20);
    const heightCm = Math.max(1, Number(custom?.h) || 15);
    const weightKg = Math.max(0.1, Number(custom?.kg) || 2);
    for (const tier of PARCEL_KEYS) {
      if (fitsParcelTier(lengthCm, widthCm, heightCm, weightKg, tier)) return tier;
    }
    return 'XL';
  }
  return sizeKey;
}

function normalizeSizeKey(sizeKey: SizeKey): SizeKey {
  if (sizeKey === 'envelope') return 'XS';
  // XL is not a size tile (custom slider covers 30 kg) — restore as custom, not M.
  if (sizeKey === 'XXL' || sizeKey === 'XL') return 'custom';
  if (SIZE_OPTION_KEYS.includes(sizeKey as ParcelKey | 'custom')) return sizeKey;
  return 'M';
}

function customTierByWeight(weightKg: number) {
  return CUSTOM_WEIGHT_TIERS.find((tier) => weightKg <= tier.maxKg) ?? CUSTOM_WEIGHT_TIERS[CUSTOM_WEIGHT_TIERS.length - 1];
}

function buildCustomSizeFromWeight(weightKg: number) {
  const safeWeight = Math.min(MAX_CUSTOM_WEIGHT_KG, Math.max(CUSTOM_WEIGHT_MIN_KG, weightKg || CUSTOM_WEIGHT_MIN_KG));
  const tier = customTierByWeight(safeWeight);
  return {
    l: String(tier.dims.lengthCm),
    w: String(tier.dims.widthCm),
    h: String(tier.dims.heightCm),
    kg: String(Math.round(safeWeight * 10) / 10),
  };
}

function presetToEditableSize(preset: { lengthCm: number; widthCm: number; heightCm: number; weightKg: number }) {
  return {
    l: String(preset.lengthCm),
    w: String(preset.widthCm),
    h: String(preset.heightCm),
    kg: String(preset.weightKg),
  };
}

function deliveryModeToApi(mode: DeliveryMode): 'locker' | 'branch' | 'address' {
  if (mode === 'home') return 'address';
  if (mode === 'pudo') return 'locker';
  return mode;
}

function sideModeAvailable(
  side: CoverageSide | null | undefined,
  mode: DeliveryMode,
): boolean {
  if (!side) return true;
  return side[mode]?.available !== false;
}

/**
 * Size-tile / preliminary quotes must match modes the route can actually use.
 * Paris (and similar cities) often have no NP branch/locker for delivery — quoting
 * branch↔branch there underprices the only available option (courier / home).
 */
function resolveCatalogQuoteModes(
  coverage: { pickup: CoverageSide; delivery: CoverageSide } | null,
): { pickup: DeliveryMode; delivery: DeliveryMode } {
  const pickupBranchOk = sideModeAvailable(coverage?.pickup, 'branch')
    && !pickupExcludedModes().includes('branch');
  const deliveryBranchOk = sideModeAvailable(coverage?.delivery, 'branch');
  if (pickupBranchOk && deliveryBranchOk) {
    return { pickup: 'branch', delivery: 'branch' };
  }
  return { pickup: 'home', delivery: 'home' };
}

function sizeToPreset(sizeKey: SizeKey, custom: { l: string; w: string; h: string; kg: string }) {
  if (sizeKey === 'envelope') return ENVELOPE_PRESET;
  if (sizeKey === 'XXL') return PARCEL_PRESETS.XL;
  if (sizeKey === 'custom') {
    return {
      lengthCm: Math.max(1, Number(custom.l) || 30),
      widthCm: Math.max(1, Number(custom.w) || 20),
      heightCm: Math.max(1, Number(custom.h) || 15),
      weightKg: Math.max(0.1, Number(custom.kg) || 2),
    };
  }
  return PARCEL_PRESETS[sizeKey];
}

function StepHeader({ step, title, subtitle }: { step: number; title: string; subtitle?: string }) {
  const { t } = useI18n();
  return (
    <>
      <div className="calc-form__progress-head">
        <span className="calc-form__step-badge">{t('calc.stepOf', { current: step, total: TOTAL_STEPS })}</span>
        <div className="calc-form__dots" aria-hidden>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <span key={i} className={i + 1 <= step ? 'active' : ''} />
          ))}
        </div>
      </div>
      <h2 className="calc-form__title">{title}</h2>
      {subtitle && <p className="calc-form__subtitle">{subtitle}</p>}
    </>
  );
}

function OptionGrid<T extends string>({
  options,
  value,
  onChange,
  columns = 3,
  disabledKeys,
  comingSoonKeys,
  hints,
}: {
  options: Array<{ key: T; label: string; icon?: string }>;
  value: T;
  onChange: (v: T) => void;
  columns?: 2 | 3 | 4;
  disabledKeys?: Partial<Record<T, boolean>>;
  comingSoonKeys?: Partial<Record<T, boolean>>;
  hints?: Partial<Record<T, string | undefined>>;
}) {
  const { t } = useI18n();
  return (
    <div className={`calc-form__options calc-form__options--${columns}`}>
      {options.map((opt) => {
        const comingSoon = Boolean(comingSoonKeys?.[opt.key]);
        const disabled = Boolean(disabledKeys?.[opt.key]) || comingSoon;
        const hint = hints?.[opt.key];
        return (
          <button
            key={opt.key}
            type="button"
            className={`calc-form__option${value === opt.key ? ' active' : ''}${disabled ? ' is-disabled' : ''}${comingSoon ? ' is-soon' : ''}`}
            onClick={() => { if (!disabled) onChange(opt.key); }}
            disabled={disabled}
            title={disabled ? (hint || (comingSoon ? t('calc.comingSoon') : t('calc.unavailableInCity'))) : undefined}
            aria-disabled={disabled}
          >
            {opt.icon && <span className="calc-form__option-icon">{opt.icon}</span>}
            <span>{opt.label}</span>
            {comingSoon ? (
              <small className="calc-form__option-note calc-form__option-note--soon">{t('calc.comingSoon')}</small>
            ) : disabled ? (
              <small className="calc-form__option-note">{t('calc.unavailable')}</small>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function CalcForm({
  user,
  initialTo = 'DE',
  inModal = false,
  onSuccess: _onSuccess,
  onAwaitingRecipientPayment,
  onDone: _onDone,
  onStepChange,
  resetToStep1Signal,
  startFromStep1,
}: FormProps) {
  const { t, locale } = useI18n();
  const initialRef = useRef<{ restored: boolean; draft: ReturnType<typeof loadCalcDraft> } | null>(null);
  if (initialRef.current === null) {
    initialRef.current = { restored: false, draft: loadCalcDraft(inModal, user?.id) };
    initialRef.current.restored = Boolean(initialRef.current.draft);
  }
  const saved = initialRef.current.draft;

  const [step, setStep] = useState(startFromStep1 ? 1 : (saved?.step ?? 1));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quoteWarning, setQuoteWarning] = useState<string | null>(null);

  const [toCountry, setToCountry] = useState(saved?.toCountry ?? initialTo);
  const [pickupType, setPickupType] = useState<DeliveryMode>(
    normalizePickupMode(saved?.pickupType ?? 'branch'),
  );
  const [deliveryType, setDeliveryType] = useState<DeliveryMode>(saved?.deliveryType ?? 'locker');
  const [coverage, setCoverage] = useState<{ pickup: CoverageSide; delivery: CoverageSide } | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [livePickupLockers, setLivePickupLockers] = useState<ShippingPoint[] | null>(null);
  const [liveDestLockers, setLiveDestLockers] = useState<ShippingPoint[] | null>(null);
  const [livePickupBranches, setLivePickupBranches] = useState<ShippingPoint[] | null>(null);
  const [liveDestBranches, setLiveDestBranches] = useState<ShippingPoint[] | null>(null);
  const [pointsLoading, setPointsLoading] = useState(false);

  const [sizeKey, setSizeKey] = useState<SizeKey>(() => (
    normalizeSizeKey((saved?.sizeKey as SizeKey) ?? 'M')
  ));
  const [customSize, setCustomSize] = useState(() => {
    if (saved?.customSize) return saved.customSize;
    const raw = (saved?.sizeKey as SizeKey) ?? 'M';
    if (raw === 'XL' || raw === 'XXL') return presetToEditableSize(PARCEL_PRESETS.XL);
    return presetToEditableSize(sizeToPreset(normalizeSizeKey(raw), buildCustomSizeFromWeight(2)));
  });
  const [contents, setContents] = useState<ContentKey>(saved?.contents ?? 'gift');
  const [contentsNote, setContentsNote] = useState(saved?.contentsNote ?? '');
  const [contentValue, setContentValue] = useState<ValueKey>(saved?.contentValue ?? 'under100');
  const [payer, setPayer] = useState<'sender' | 'receiver'>(saved?.payer ?? 'receiver');
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const [pickupStreet, setPickupStreet] = useState(saved?.pickupStreet ?? '');
  const [pickupAddressQuery, setPickupAddressQuery] = useState(saved?.pickupAddressQuery ?? '');
  const [pickupCity, setPickupCity] = useState(saved?.pickupCity ?? 'Budapest');
  const [pickupPostal, setPickupPostal] = useState(saved?.pickupPostal ?? '');
  const [destStreet, setDestStreet] = useState(saved?.destStreet ?? '');
  const [destCity, setDestCity] = useState(saved?.destCity ?? '');
  const [destPostal, setDestPostal] = useState(saved?.destPostal ?? '');
  const [destAddressQuery, setDestAddressQuery] = useState(saved?.destAddressQuery ?? '');
  const [destAddressFocus, setDestAddressFocus] = useState<{ lat: number; lng: number } | null>(saved?.destAddressFocus ?? null);
  const [destAddressReady, setDestAddressReady] = useState(saved?.destAddressReady ?? false);
  const [pickupAddressFocus, setPickupAddressFocus] = useState<{ lat: number; lng: number } | null>(saved?.pickupAddressFocus ?? null);
  const [pickupAddressReady, setPickupAddressReady] = useState(saved?.pickupAddressReady ?? false);
  const [geoPickupCity, setGeoPickupCity] = useState(saved?.geoPickupCity ?? '');
  const [pickupCityFromGeo, setPickupCityFromGeo] = useState(saved?.pickupCityFromGeo ?? false);
  const [pickupCityTouched, setPickupCityTouched] = useState(saved?.pickupCityTouched ?? false);
  const [pickupDate, setPickupDate] = useState(
    coerceCourierPickupDate(saved?.pickupDate || nextCourierPickupDateIso()),
  );
  const [pickupTime] = useState(saved?.pickupTime ?? PICKUP_WITHIN_DAY);
  const [pickupLocker, setPickupLocker] = useState(sanitizeDivisionId(saved?.pickupLocker));
  const [pickupBranch, setPickupBranch] = useState(sanitizeDivisionId(saved?.pickupBranch));
  const [destLocker, setDestLocker] = useState(sanitizeDivisionId(saved?.destLocker));
  const [destBranch, setDestBranch] = useState(sanitizeDivisionId(saved?.destBranch));

  const [fragile, setFragile] = useState(saved?.fragile ?? false);
  const [insurance, setInsurance] = useState(saved?.insurance ?? false);
  const [quoteSettings, setQuoteSettings] = useState<QuoteSettings | null>(null);

  const savedSenderParts = splitPersonName(saved?.senderFirst
    ? `${saved.senderFirst} ${saved.senderLast || ''}`.trim()
    : (saved as { senderName?: string } | null)?.senderName || user?.name || '');
  const [senderFirst, setSenderFirst] = useState(saved?.senderFirst || savedSenderParts.first);
  const [senderLast, setSenderLast] = useState(saved?.senderLast || savedSenderParts.last);
  const [senderEmail, setSenderEmail] = useState(saved?.senderEmail || user?.email || '');
  const [senderDial, setSenderDial] = useState(saved?.senderDial ?? (DIAL_BY_CC[PICKUP_COUNTRY] || '+36'));
  const [senderPhone, setSenderPhone] = useState(saved?.senderPhone || user?.phone?.replace(/^\+\d+\s*/, '') || '');
  const [receiverFirst, setReceiverFirst] = useState(saved?.receiverFirst ?? '');
  const [receiverLast, setReceiverLast] = useState(saved?.receiverLast ?? '');
  const [receiverEmail, setReceiverEmail] = useState(saved?.receiverEmail ?? '');
  const [receiverDial, setReceiverDial] = useState(saved?.receiverDial ?? (DIAL_BY_CC[saved?.toCountry ?? initialTo] || '+49'));
  const [receiverPhone, setReceiverPhone] = useState(saved?.receiverPhone ?? '');

  const [termsAccepted, setTermsAccepted] = useState(saved?.termsAccepted ?? false);
  const [parcelQuotes, setParcelQuotes] = useState<Partial<Record<ParcelKey, number>>>({});
  const [customQuote, setCustomQuote] = useState<number | null>(null);
  const [quoteRefreshing, setQuoteRefreshing] = useState(false);
  const [npScheduledDeliveryDate, setNpScheduledDeliveryDate] = useState<string | null>(null);
  const [welcomeDiscountPercent, setWelcomeDiscountPercent] = useState<number | null>(null);
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoInput, setPromoInput] = useState('');
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [promoHint, setPromoHint] = useState<string | null>(null);
  const [promoTotal, setPromoTotal] = useState<number | null>(null);
  const [promoApplying, setPromoApplying] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [showQuoteWait, setShowQuoteWait] = useState(false);
  const [quotesFromNp, setQuotesFromNp] = useState(false);
  const [currency, setCurrency] = useState(DEFAULT_QUOTE_CURRENCY);
  const [bookAddresses, setBookAddresses] = useState<AddressEntry[]>([]);

  const quoteDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customQuoteDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customQuoteRequestId = useRef(0);
  const quoteWaitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quoteRequestId = useRef(0);

  useEffect(() => {
    if (!user) {
      setBookAddresses([]);
      return;
    }
    let cancelled = false;
    fetchAddresses()
      .then((list) => {
        if (!cancelled) setBookAddresses(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setBookAddresses([]);
      });
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (quoteWaitTimer.current) {
      clearTimeout(quoteWaitTimer.current);
      quoteWaitTimer.current = null;
    }
    if (!quoteRefreshing) {
      setShowQuoteWait(false);
      return;
    }
    // Не мигать надписью при быстрых ответах API
    quoteWaitTimer.current = setTimeout(() => setShowQuoteWait(true), 400);
    return () => {
      if (quoteWaitTimer.current) clearTimeout(quoteWaitTimer.current);
    };
  }, [quoteRefreshing]);

  useEffect(() => {
    let cancelled = false;
    fetchQuoteSettings()
      .then((s) => {
        if (!cancelled) setQuoteSettings(s);
      })
      .catch(() => {
        if (!cancelled) {
          setQuoteSettings({
            currency: DEFAULT_QUOTE_CURRENCY,
            vatEnabled: true,
            vatPercent: 27,
            roundingEnabled: true,
            roundingStep: 10,
            fxFromEur: { EUR: 1, HUF: 400, PLN: 4.3, CZK: 25, RON: 5 },
            fragileFeeEur: 1.98,
            insurancePercent: 1,
          });
        }
      });
    return () => { cancelled = true; };
  }, []);

  const quoteInFlight = useRef(false);
  const payInFlight = useRef(false);
  const routeQuoteCache = useRef(new Map<string, { quotes: Partial<Record<ParcelKey, number>>; currency: string }>());
  const prevRouteKey = useRef('');
  const skipDraftFlushRef = useRef(false);

  const goTo = (n: number) => {
    setStep(n);
    onStepChange?.(n);
    if (n < TOTAL_STEPS) setError(null);
  };

  // Envelope = documents with low declared value; skip contents step only.
  useEffect(() => {
    if (!isEnvelopeSize(sizeKey)) return;
    setContents('documents');
    setContentsNote('');
    setContentValue('under100');
    if (step === 7) goTo(8);
  }, [sizeKey, step]);

  useEffect(() => {
    onStepChange?.(step);
  }, []);

  useEffect(() => {
    trackAnalytics({
      event: 'calc_step',
      step,
      toCountry,
      fromCity: pickupCity,
      toCity: destCity,
      sizeKey: String(sizeKey),
      pickupMode: pickupType,
      deliveryMode: deliveryType,
      locale,
    });
  }, [step]);

  const prevResetSignal = useRef(resetToStep1Signal);
  useEffect(() => {
    if (resetToStep1Signal == null) return;
    if (prevResetSignal.current === resetToStep1Signal) return;
    prevResetSignal.current = resetToStep1Signal;
    // Skip one flush cycle so reset/dismiss does not re-save the old high-step draft.
    // Must clear afterwards — sticky true killed draft saves for the rest of the session.
    skipDraftFlushRef.current = true;
    setStep(1);
    onStepChange?.(1);
    setError(null);
    const t = window.setTimeout(() => {
      skipDraftFlushRef.current = false;
    }, 450);
    return () => window.clearTimeout(t);
  }, [resetToStep1Signal, onStepChange]);

  useEffect(() => {
    if (initialRef.current?.restored) return;
    setToCountry(initialTo);
    setReceiverDial(DIAL_BY_CC[initialTo] || '+49');
  }, [initialTo]);

  const skipInitialDestCitySync = useRef(Boolean(saved?.destCity?.trim()));

  // Only when destination country changes — never fight free-text typing in the city field.
  // Previously deps included destCity, so every partial keystroke (Ber… / Берл…) reset back
  // to the default city and looked like a constant page refresh on mobile.
  useEffect(() => {
    const cities = citiesForCountry(toCountry);
    if (!cities.length) return;

    if (skipInitialDestCitySync.current) {
      skipInitialDestCitySync.current = false;
      return;
    }

    setDestCity((prev) => {
      const ok = Boolean(
        prev.trim()
        && cities.some((c) => c.toLowerCase() === prev.trim().toLowerCase()),
      );
      return ok ? prev : defaultCityValueForCountry(toCountry);
    });
  }, [toCountry]);

  useEffect(() => {
    if (!user) return;
    if (initialRef.current?.restored && saved?.senderEmail) return;
    const parts = splitPersonName(user.name || '');
    setSenderFirst(parts.first);
    setSenderLast(parts.last);
    setSenderEmail(user.email);
    if (user.phone) setSenderPhone(user.phone.replace(/^\+\d+\s*/, ''));
  }, [user]);

  const pickupNeedsAddressRefinement = useMemo(() => {
    if (pickupType !== 'locker' && pickupType !== 'branch') return false;
    if (
      pickupCityFromGeo
      && geoPickupCity
      && pickupCity.trim().toLowerCase() === geoPickupCity.trim().toLowerCase()
    ) {
      return false;
    }
    if (!geoPickupCity && !pickupCityTouched) return false;
    return true;
  }, [pickupType, pickupCityFromGeo, geoPickupCity, pickupCity, pickupCityTouched]);

  useCalcDraftPersistence(inModal, () => ({
    step,
    toCountry,
    pickupType,
    deliveryType,
    sizeKey,
    customSize,
    contents,
    contentsNote,
    contentValue,
    payer,
    pickupStreet,
    pickupAddressQuery,
    pickupCity,
    pickupPostal,
    destStreet,
    destCity,
    destPostal,
    destAddressQuery,
    destAddressFocus,
    destAddressReady,
    pickupAddressFocus,
    pickupAddressReady,
    geoPickupCity,
    pickupCityFromGeo,
    pickupCityTouched,
    pickupDate,
    pickupTime,
    pickupLocker,
    pickupBranch,
    destLocker,
    destBranch,
    fragile,
    insurance,
    senderFirst,
    senderLast,
    senderEmail,
    senderDial,
    senderPhone,
    receiverFirst,
    receiverLast,
    receiverEmail,
    receiverDial,
    receiverPhone,
    termsAccepted,
  }), [
    step,
    toCountry,
    pickupType,
    deliveryType,
    sizeKey,
    customSize,
    contents,
    contentsNote,
    contentValue,
    payer,
    pickupStreet,
    pickupAddressQuery,
    pickupCity,
    pickupPostal,
    destStreet,
    destCity,
    destPostal,
    destAddressQuery,
    destAddressFocus,
    destAddressReady,
    pickupAddressFocus,
    pickupAddressReady,
    geoPickupCity,
    pickupCityFromGeo,
    pickupCityTouched,
    pickupDate,
    pickupTime,
    pickupLocker,
    pickupBranch,
    destLocker,
    destBranch,
    fragile,
    insurance,
    senderFirst,
    senderLast,
    senderEmail,
    senderDial,
    senderPhone,
    receiverFirst,
    receiverLast,
    receiverEmail,
    receiverDial,
    receiverPhone,
    termsAccepted,
  ], true, user?.id, skipDraftFlushRef);

  const resetPickupAddressRefinement = useCallback(() => {
    setPickupAddressReady(false);
    setPickupAddressFocus(null);
    setPickupAddressQuery('');
    setPickupStreet('');
    setPickupLocker('');
    setPickupBranch('');
  }, []);

  const locatePickupCity = async () => {
    setGeoLoading(true);
    setGeoError(null);
    try {
      const { city } = await detectCityByGeolocation(PICKUP_COUNTRY);
      setPickupCity(city);
      setGeoPickupCity(city);
      setPickupCityFromGeo(true);
      setPickupCityTouched(true);
      resetPickupAddressRefinement();
    } catch (err) {
      setGeoError(localizeApiError(
        err instanceof Error ? err.message : undefined,
        t,
        'calc.geoFail',
      ));
    } finally {
      setGeoLoading(false);
    }
  };

  const changePickupCity = useCallback((city: string) => {
    setPickupCity(city);
    setPickupCityTouched(true);
    setPickupCityFromGeo(false);
    resetPickupAddressRefinement();
    setLivePickupLockers(null);
    setLivePickupBranches(null);
  }, [resetPickupAddressRefinement]);

  const apiParcelKey = sizeToApiKey(sizeKey, customSize);
  const declaredValue = VALUE_TO_EUR[contentValue];
  // Must match checkout parcel.declaredValue so NP tariff doesn't jump at pay.
  const npDeclaredValue = Math.max(insurance ? declaredValue : 100, 50);
  const quotePickupMode = deliveryModeToApi(pickupType);
  const quoteDeliveryMode = deliveryModeToApi(deliveryType);
  const pickupQuoteLocation = useMemo(() => (
    pickupType === 'home'
      ? addressQuoteLocation(PICKUP_COUNTRY, pickupCity, pickupStreet, pickupPostal)
      : divisionQuoteLocation(
        PICKUP_COUNTRY,
        isLockerLikeMode(pickupType) ? pickupLocker : pickupBranch,
      )
  ), [pickupType, pickupCity, pickupStreet, pickupPostal, pickupLocker, pickupBranch]);
  const deliveryQuoteLocation = useMemo(() => (
    deliveryType === 'home'
      ? addressQuoteLocation(toCountry, destCity, destStreet, destPostal)
      : divisionQuoteLocation(
        toCountry,
        isLockerLikeMode(deliveryType) ? destLocker : destBranch,
      )
  ), [deliveryType, toCountry, destCity, destStreet, destPostal, destLocker, destBranch]);
  const quoteLocationsReady = Boolean(pickupQuoteLocation && deliveryQuoteLocation);
  // MATE's Nova Post contract is the carrier payer; the UI payer choice is
  // handled between customer and recipient and must not change NP contract billing.
  const quotePayerType = 'Sender' as const;

  const routeCacheKey = [
    PICKUP_COUNTRY,
    toCountry,
    npDeclaredValue,
    apiParcelKey,
    pickupType,
    deliveryType,
    quotePayerType,
    JSON.stringify(pickupQuoteLocation || null),
    JSON.stringify(deliveryQuoteLocation || null),
  ].join(':');

  // Catalog tile prices follow route coverage (branch when both sides allow it,
  // otherwise home/address — e.g. Paris delivery has no NP branch/locker).
  const catalogQuoteModes = useMemo(
    () => resolveCatalogQuoteModes(coverage),
    [coverage],
  );
  const preliminaryRouteKey = [
    PICKUP_COUNTRY,
    toCountry,
    pickupCity.trim().toLowerCase(),
    destCity.trim().toLowerCase(),
    npDeclaredValue,
    catalogQuoteModes.pickup,
    catalogQuoteModes.delivery,
  ].join(':');

  const applyCachedRouteQuotes = useCallback(() => {
    const cached = routeQuoteCache.current.get(routeCacheKey);
    if (!cached) return false;
    setParcelQuotes((prev) => ({ ...prev, ...cached.quotes }));
    setCurrency(cached.currency);
    setQuotesFromNp(true);
    return true;
  }, [routeCacheKey]);

  const applyCachedPreliminaryQuotes = useCallback(() => {
    const cached = routeQuoteCache.current.get(`catalog:${preliminaryRouteKey}`);
    if (!cached) return false;
    setParcelQuotes((prev) => ({ ...prev, ...cached.quotes }));
    setCurrency(cached.currency);
    setQuotesFromNp(true);
    return true;
  }, [preliminaryRouteKey]);

  const applyEstimateFallback = useCallback((keys: ParcelKey[] = STEP3_QUOTE_KEYS) => {
    setNpScheduledDeliveryDate(null);
    setParcelQuotes((prev) => {
      const next = { ...prev };
      for (const key of keys) {
        if (next[key] == null) {
          next[key] = estimateParcelPrice(PARCEL_PRESETS[key], DEFAULT_QUOTE_CURRENCY, key);
        }
      }
      return next;
    });
  }, []);

  const fetchQuoteKeys = useCallback(async (
    keys: ParcelKey[],
    sizeOverrides?: Array<{ boxSize: string; lengthCm: number; widthCm: number; heightCm: number; weightKg: number }>,
    options?: {
      deliveryMode?: 'locker' | 'branch' | 'address';
      pickupMode?: 'locker' | 'branch' | 'address';
      pickupLocation?: QuoteLocation;
      deliveryLocation?: QuoteLocation;
      cacheKey?: string;
      allowWithoutLocations?: boolean;
    },
  ): Promise<boolean> => {
    if (!keys.length) return false;
    const usePickup = options?.pickupLocation ?? pickupQuoteLocation;
    const useDelivery = options?.deliveryLocation ?? deliveryQuoteLocation;
    const useMode = options?.deliveryMode ?? quoteDeliveryMode;
    const usePickupMode = options?.pickupMode ?? quotePickupMode;
    if (!options?.allowWithoutLocations && !(usePickup && useDelivery)) return false;

    quoteInFlight.current = true;
    const reqId = ++quoteRequestId.current;
    setQuoteRefreshing(true);
    try {
      const sizes = sizeOverrides ?? keys.map((key) => ({ boxSize: key, ...PARCEL_PRESETS[key] }));
      const data = await calculateBatch({
        fromCountry: PICKUP_COUNTRY,
        toCountry,
        declaredValue: npDeclaredValue,
        deliveryMode: useMode,
        pickupMode: usePickupMode,
        pickupLocation: usePickup,
        deliveryLocation: useDelivery,
        payerType: quotePayerType,
        sizes,
      });
      if (reqId !== quoteRequestId.current) return false;

      const code = (data.currency?.code || DEFAULT_QUOTE_CURRENCY).toUpperCase();
      setCurrency(code);

      const updates: Partial<Record<ParcelKey, number>> = {};
      let welcomePct: number | null = null;
      let etaIso: string | null = null;
      for (const key of keys) {
        const q = data.quotes[key];
        const base = typeof q === 'number' ? q : (q?.total ?? null);
        if (base != null) updates[key] = base;
        if (typeof q === 'object' && q?.breakdown?.welcomeDiscountPercent) {
          welcomePct = q.breakdown.welcomeDiscountPercent;
        }
        if (typeof q === 'object' && q?.scheduledDeliveryDate) {
          etaIso = q.scheduledDeliveryDate;
        }
      }
      // Prefer ETA for the size currently selected when available.
      const preferred = data.quotes[apiParcelKey as string] ?? data.quotes[String(sizeKey)];
      if (typeof preferred === 'object' && preferred?.scheduledDeliveryDate) {
        etaIso = preferred.scheduledDeliveryDate;
      }
      setWelcomeDiscountPercent(welcomePct);
      setNpScheduledDeliveryDate(etaIso);

      if (Object.keys(updates).length) {
        setParcelQuotes((prev) => {
          const merged = { ...prev, ...updates };
          const cacheKey = options?.cacheKey
            || (keys.every((k) => STEP3_QUOTE_KEYS.includes(k)) ? routeCacheKey : null);
          if (cacheKey) {
            routeQuoteCache.current.set(cacheKey, { quotes: merged, currency: code });
          }
          return merged;
        });
        setQuotesFromNp(data.priceSource === 'novapost' || data.priceSource === 'mate');
      }

      if (data.priceSource === 'estimate' || data.priceSource === 'mock') {
        setQuoteWarning(t('calc.quoteEst'));
      } else {
        setQuoteWarning(null);
      }
      return Object.keys(updates).length > 0;
    } catch {
      if (reqId !== quoteRequestId.current) return false;
      if (usePickup && useDelivery) {
        setQuoteWarning(t('calc.quoteNpFail'));
      } else {
        applyEstimateFallback(keys);
        setQuoteWarning(t('calc.quoteEst'));
      }
      return false;
    } finally {
      quoteInFlight.current = false;
      if (reqId === quoteRequestId.current) setQuoteRefreshing(false);
    }
  }, [
    toCountry, npDeclaredValue, routeCacheKey, quoteDeliveryMode, quotePickupMode,
    pickupQuoteLocation, deliveryQuoteLocation, quotePayerType,
    apiParcelKey, sizeKey, applyEstimateFallback, t,
  ]);

  const fetchCustomQuote = useCallback(async (
    preset: { lengthCm: number; widthCm: number; heightCm: number; weightKg: number },
    options?: {
      pickupLocation?: QuoteLocation;
      deliveryLocation?: QuoteLocation;
      deliveryMode?: 'locker' | 'branch' | 'address';
      pickupMode?: 'locker' | 'branch' | 'address';
      allowWithoutLocations?: boolean;
    },
  ): Promise<boolean> => {
    // Dedicated response key so custom quotes never collide with preset S/M/L/XL cache.
    const quoteKey = `CUSTOM:${preset.weightKg}:${preset.lengthCm}x${preset.widthCm}x${preset.heightCm}`;
    const usePickup = options?.pickupLocation ?? pickupQuoteLocation;
    const useDelivery = options?.deliveryLocation ?? deliveryQuoteLocation;
    const useMode = options?.deliveryMode ?? quoteDeliveryMode;
    const usePickupMode = options?.pickupMode ?? quotePickupMode;
    if (!options?.allowWithoutLocations && !(usePickup && useDelivery)) return false;

    const reqId = ++customQuoteRequestId.current;
    setQuoteRefreshing(true);
    try {
      const data = await calculateBatch({
        fromCountry: PICKUP_COUNTRY,
        toCountry,
        declaredValue: npDeclaredValue,
        deliveryMode: useMode,
        pickupMode: usePickupMode,
        pickupLocation: usePickup,
        deliveryLocation: useDelivery,
        payerType: quotePayerType,
        sizes: [{ boxSize: quoteKey, lengthCm: preset.lengthCm, widthCm: preset.widthCm, heightCm: preset.heightCm, weightKg: preset.weightKg }],
      });
      if (reqId !== customQuoteRequestId.current) return false;

      const code = (data.currency?.code || DEFAULT_QUOTE_CURRENCY).toUpperCase();
      setCurrency(code);

      const q = data.quotes[quoteKey]
        ?? (Object.entries(data.quotes || {}).find(([k]) => k.startsWith('CUSTOM:'))?.[1])
        ?? null;
      const total = typeof q === 'number' ? q : (q?.total ?? null);
      const hasLiveLikePrice = total != null
        && data.priceSource !== 'estimate'
        && data.priceSource !== 'mock';
      setCustomQuote(hasLiveLikePrice ? total : null);

      if (typeof q === 'object' && q?.breakdown?.welcomeDiscountPercent) {
        setWelcomeDiscountPercent(q.breakdown.welcomeDiscountPercent);
      }
      setNpScheduledDeliveryDate(
        typeof q === 'object' && q?.scheduledDeliveryDate ? q.scheduledDeliveryDate : null,
      );

      setQuotesFromNp(data.priceSource === 'novapost' || data.priceSource === 'mate');
      if (!hasLiveLikePrice) {
        setQuoteWarning(t('calc.quoteNpFail'));
        return false;
      }
      setQuoteWarning(null);
      return true;
    } catch {
      if (reqId !== customQuoteRequestId.current) return false;
      setCustomQuote(null);
      setNpScheduledDeliveryDate(null);
      setQuotesFromNp(false);
      setQuoteWarning(t('calc.quoteNpFail'));
      return false;
    } finally {
      if (reqId === customQuoteRequestId.current) setQuoteRefreshing(false);
    }
  }, [
    toCountry, npDeclaredValue, quoteDeliveryMode, quotePickupMode,
    pickupQuoteLocation, deliveryQuoteLocation, quotePayerType, t,
  ]);

  // Steps 2–3: ask Nova Post for size-tile prices as soon as cities (+ coverage) are known.
  useEffect(() => {
    if (step < 2 || step > 3) return;
    if (!pickupCity.trim() || !destCity.trim() || !toCountry) return;
    // Prefer waiting for coverage so Paris-like routes don't flash underpriced branch tiles.
    // If coverage failed, still quote (branch sample) — step 4 re-prices the chosen mode.
    if (coverageLoading) return;
    if (applyCachedPreliminaryQuotes()) return;

    const pickupMode = catalogQuoteModes.pickup;
    const deliveryMode = catalogQuoteModes.delivery;
    const apiPickup = deliveryModeToApi(pickupMode);
    const apiDelivery = deliveryModeToApi(deliveryMode);

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { pickup: pickupLoc, delivery: deliveryLoc } = await resolvePreliminaryQuoteLocations(
          pickupMode,
          deliveryMode,
          pickupCity,
          destCity,
          toCountry,
        );
        if (cancelled) return;
        await fetchQuoteKeys(STEP3_QUOTE_KEYS, undefined, {
          deliveryMode: apiDelivery,
          pickupMode: apiPickup,
          pickupLocation: pickupLoc,
          deliveryLocation: deliveryLoc,
          cacheKey: `catalog:${preliminaryRouteKey}`,
          allowWithoutLocations: true,
        });
      } catch {
        if (cancelled) return;
        await fetchQuoteKeys(STEP3_QUOTE_KEYS, undefined, {
          deliveryMode: apiDelivery,
          pickupMode: apiPickup,
          cacheKey: `catalog:${preliminaryRouteKey}`,
          allowWithoutLocations: true,
        });
      }
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    step, pickupCity, destCity, toCountry, npDeclaredValue, preliminaryRouteKey,
    coverage, coverageLoading, catalogQuoteModes, applyCachedPreliminaryQuotes,
    fetchQuoteKeys,
  ]);

  // Steps 4–5: re-price selected size for the chosen pickup/delivery modes.
  useEffect(() => {
    if (step < 4 || step > 5) return;
    if (!pickupCity.trim() || !destCity.trim() || !toCountry) return;
    if (quoteLocationsReady) return;

    const modeCacheKey = [
      'mode',
      preliminaryRouteKey,
      pickupType,
      deliveryType,
      sizeKey === 'custom'
        ? `CUSTOM:${Number(customSize.kg) || 0}:${customSize.l}x${customSize.w}x${customSize.h}`
        : sizeKey,
    ].join(':');

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { pickup: pickupLoc, delivery: deliveryLoc } = await resolvePreliminaryQuoteLocations(
          pickupType,
          deliveryType,
          pickupCity,
          destCity,
          toCountry,
        );
        if (cancelled) return;

        if (sizeKey === 'custom') {
          const weightKg = Number(customSize.kg);
          if (!Number.isFinite(weightKg) || weightKg < 0.1) return;
          if (weightKg > MAX_CUSTOM_WEIGHT_KG) return;
          await fetchCustomQuote(sizeToPreset('custom', customSize), {
            deliveryMode: quoteDeliveryMode,
            pickupMode: quotePickupMode,
            pickupLocation: pickupLoc,
            deliveryLocation: deliveryLoc,
            allowWithoutLocations: true,
          });
        } else {
          await fetchQuoteKeys([apiParcelKey], undefined, {
            deliveryMode: quoteDeliveryMode,
            pickupMode: quotePickupMode,
            pickupLocation: pickupLoc,
            deliveryLocation: deliveryLoc,
            cacheKey: modeCacheKey,
            allowWithoutLocations: true,
          });
        }
      } catch {
        if (cancelled) return;
        setQuoteRefreshing(false);
        setQuoteWarning(t('calc.quoteNpFail'));
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    step, pickupCity, destCity, toCountry, pickupType, deliveryType, sizeKey,
    apiParcelKey, customSize.l, customSize.w, customSize.h, customSize.kg,
    quoteDeliveryMode, quotePickupMode, quoteLocationsReady, preliminaryRouteKey,
    fetchQuoteKeys, fetchCustomQuote, t,
  ]);

  const modesBeforeCustomRef = useRef<{ pickup: DeliveryMode; delivery: DeliveryMode } | null>(null);

  // Keep pickup/delivery modes within what the selected size physically allows.
  useEffect(() => {
    setPickupType((prev) => clampModeToSize(prev, sizeKey, coverage?.pickup, pickupExcludedModes(), customSize));
    setDeliveryType((prev) => clampModeToSize(prev, sizeKey, coverage?.delivery, [], customSize));
  }, [sizeKey, coverage, customSize.l, customSize.w, customSize.h, customSize.kg]);

  // Step 3 custom dims: live Nova Post quote while the user adjusts weight/size.
  useEffect(() => {
    if (sizeKey !== 'custom') {
      setCustomQuote(null);
      return;
    }
    if (step !== 3) return;
    if (!pickupCity.trim() || !destCity.trim() || !toCountry) return;
    if (coverageLoading) return;
    if (!customSize.kg) {
      setCustomQuote(null);
      return;
    }
    if (Number(customSize.kg) > MAX_CUSTOM_WEIGHT_KG) {
      setCustomQuote(null);
      return;
    }

    let cancelled = false;
    if (customQuoteDebounce.current) clearTimeout(customQuoteDebounce.current);
    customQuoteDebounce.current = setTimeout(async () => {
      const weightKg = Number(customSize.kg);
      if (!Number.isFinite(weightKg) || weightKg < 0.1) return;
      const preset = sizeToPreset('custom', customSize);
      // Match size-tile modes for this route (home when branch delivery unavailable).
      const pickupMode = catalogQuoteModes.pickup;
      const deliveryMode = catalogQuoteModes.delivery;
      const apiPickup = deliveryModeToApi(pickupMode);
      const apiDelivery = deliveryModeToApi(deliveryMode);
      try {
        const { pickup: pickupLoc, delivery: deliveryLoc } = await resolvePreliminaryQuoteLocations(
          pickupMode,
          deliveryMode,
          pickupCity,
          destCity,
          toCountry,
        );
        if (cancelled) return;
        await fetchCustomQuote(preset, {
          deliveryMode: apiDelivery,
          pickupMode: apiPickup,
          pickupLocation: pickupLoc,
          deliveryLocation: deliveryLoc,
          allowWithoutLocations: true,
        });
      } catch {
        if (cancelled) return;
        await fetchCustomQuote(preset, {
          deliveryMode: apiDelivery,
          pickupMode: apiPickup,
          allowWithoutLocations: true,
        });
      }
    }, 280);

    return () => {
      cancelled = true;
      if (customQuoteDebounce.current) clearTimeout(customQuoteDebounce.current);
    };
  }, [
    sizeKey, step, customSize.l, customSize.w, customSize.h, customSize.kg,
    pickupCity, destCity, toCountry, coverage, coverageLoading, catalogQuoteModes, fetchCustomQuote,
  ]);

  const lastExactQuoteKey = useRef<string | null>(null);

  // Stable key for the priced route+parcel. Must match for presets and custom so
  // step changes (6→7→8→9) never re-quote with a different endpoint.
  const exactQuoteKey = sizeKey === 'custom'
    ? `${routeCacheKey}:CUSTOM:${Number(customSize.kg) || 0}:${customSize.l}x${customSize.w}x${customSize.h}`
    : routeCacheKey;

  useEffect(() => {
    if (!quoteLocationsReady || step < 6 || step > 9) return;
    // Same inputs already priced — ignore step-only changes (contents → value → pay).
    if (lastExactQuoteKey.current === exactQuoteKey) return;

    if (quoteDebounce.current) clearTimeout(quoteDebounce.current);

    if (sizeKey === 'custom') {
      setCustomQuote(null);
      setQuoteRefreshing(true);
      const preset = sizeToPreset(sizeKey, customSize);
      quoteDebounce.current = setTimeout(() => {
        void fetchCustomQuote(preset).then((ok) => {
          if (ok) lastExactQuoteKey.current = exactQuoteKey;
        });
      }, 120);
    } else if (applyCachedRouteQuotes()) {
      lastExactQuoteKey.current = exactQuoteKey;
    } else {
      setQuoteRefreshing(true);
      quoteDebounce.current = setTimeout(() => {
        void fetchQuoteKeys([apiParcelKey]).then((ok) => {
          if (ok) lastExactQuoteKey.current = exactQuoteKey;
        });
      }, 80);
    }

    return () => {
      if (quoteDebounce.current) clearTimeout(quoteDebounce.current);
    };
  }, [
    step, exactQuoteKey, sizeKey, quoteLocationsReady, apiParcelKey,
    customSize.l, customSize.w, customSize.h, customSize.kg,
    applyCachedRouteQuotes, fetchQuoteKeys, fetchCustomQuote,
  ]);

  // If exact quote failed once (network / NP), retry while user is on steps 6–9.
  // Never treat a preliminary/catalog number as an exact-route success.
  useEffect(() => {
    if (!quoteLocationsReady || step < 6 || step > 9) return;
    if (lastExactQuoteKey.current === exactQuoteKey) return;
    if (quoteRefreshing || quoteInFlight.current) return;
    if (sizeKey === 'custom') return;
    if (routeQuoteCache.current.has(routeCacheKey)) {
      if (applyCachedRouteQuotes()) {
        lastExactQuoteKey.current = exactQuoteKey;
      }
      return;
    }
    const timer = window.setTimeout(() => {
      if (lastExactQuoteKey.current === exactQuoteKey || quoteInFlight.current) return;
      void fetchQuoteKeys([apiParcelKey]).then((ok) => {
        if (ok) lastExactQuoteKey.current = exactQuoteKey;
      });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [
    step, exactQuoteKey, quoteLocationsReady, quoteRefreshing, sizeKey,
    apiParcelKey, routeCacheKey, applyCachedRouteQuotes, fetchQuoteKeys,
  ]);

  useEffect(() => {
    if (prevRouteKey.current && prevRouteKey.current !== preliminaryRouteKey) {
      routeQuoteCache.current.delete(`catalog:${prevRouteKey.current}`);
      routeQuoteCache.current.delete(`prelim:${prevRouteKey.current}`);
      setQuotesFromNp(false);
      setNpScheduledDeliveryDate(null);
      // Keep last quotes on screen while the next batch loads — clearing here
      // caused «Оплатить 0 HUF» / «Считаем…» if the user moved fast through steps 4→9.
      lastExactQuoteKey.current = null;
    }
    prevRouteKey.current = preliminaryRouteKey;
  }, [preliminaryRouteKey]);

  const minQuote = useMemo(() => {
    const values = STEP3_QUOTE_KEYS
      .map((key) => parcelQuotes[key])
      .filter((v): v is number => v != null);
    return values.length ? Math.min(...values) : null;
  }, [parcelQuotes]);
  // Before size is chosen, summary shows the cheapest size ("от …").
  const priceIsMinimum = step < 3;
  const basePrice = priceIsMinimum
    ? minQuote
    : (sizeKey === 'custom'
      ? customQuote
      : (parcelQuotes[apiParcelKey] ?? null));

  const extras = useMemo(() => {
    if (basePrice == null || !quoteSettings) {
      return { base: basePrice ?? 0, fragileFee: 0, insuranceFee: 0, insurancePercent: 1, total: basePrice };
    }
    return computeClientExtras(basePrice, { fragile, insurance }, quoteSettings);
  }, [basePrice, fragile, insurance, quoteSettings]);

  const totalPrice = promoTotal ?? extras.total;
  const formatMoney = (n: number) => formatQuoteMoney(n, currency);

  const clearPromo = useCallback(() => {
    setPromoCode(null);
    setPromoHint(null);
    setPromoTotal(null);
    setPromoError(null);
  }, []);

  // Quotes/options changed — drop applied promo so amount stays consistent.
  useEffect(() => {
    clearPromo();
  }, [
    clearPromo,
    basePrice,
    fragile,
    insurance,
    sizeKey,
    toCountry,
    pickupType,
    deliveryType,
    pickupCity,
    destCity,
  ]);

  const buildPromoPreviewBody = useCallback(() => {
    const preset = sizeToPreset(sizeKey, customSize);
    const boxSize = sizeToApiKey(sizeKey, customSize);
    const declaredForNp = Math.max(insurance ? declaredValue : 100, 50);
    return {
      promoCode: promoInput.trim(),
      parcel: {
        boxSize: sizeKey === 'custom' ? 'custom' : boxSize,
        ...preset,
        declaredValue: declaredForNp,
        fragile,
        insurance,
      },
      tariff: {
        fromCountry: PICKUP_COUNTRY,
        toCountry,
        pickupMode: pickupType,
        deliveryMode: deliveryType,
        pickupType,
        deliveryType,
        pickupLocation: pickupQuoteLocation,
        deliveryLocation: deliveryQuoteLocation,
        payerType: quotePayerType,
      },
      receiver: { country: toCountry },
      sender: { country: PICKUP_COUNTRY },
    };
  }, [
    promoInput, sizeKey, customSize, insurance, declaredValue, fragile,
    toCountry, pickupType, deliveryType, pickupQuoteLocation, deliveryQuoteLocation, quotePayerType,
  ]);

  const applyPromo = async () => {
    if (!promoInput.trim() || promoApplying) return;
    setPromoApplying(true);
    setPromoError(null);
    try {
      const data = await previewPromoCheckout(buildPromoPreviewBody());
      const code = String(data.breakdown?.promoCode || promoInput.trim()).toUpperCase();
      const amount = data.breakdown?.promoDiscountAmount;
      const type = data.breakdown?.promoType;
      const value = data.breakdown?.promoValue;
      let hint = t('calc.promoApplied');
      if (type === 'percent' && value != null) {
        hint = t('calc.promoAppliedPercent', { percent: value });
      } else if (type === 'fixed' && amount != null) {
        hint = t('calc.promoAppliedFixed', { amount: formatMoney(amount) });
      } else if (amount != null) {
        hint = t('calc.promoAppliedFixed', { amount: formatMoney(amount) });
      }
      setPromoCode(code);
      setPromoHint(hint);
      setPromoTotal(data.total);
      setCurrency((data.currency || currency).toUpperCase());
      if (data.breakdown?.welcomeDiscountPercent) {
        setWelcomeDiscountPercent(data.breakdown.welcomeDiscountPercent);
      }
    } catch (e) {
      clearPromo();
      setPromoError(e instanceof Error ? e.message : t('calc.promoInvalid'));
    } finally {
      setPromoApplying(false);
    }
  };
  const fragileFeeLabel = formatMoney(extras.fragileFee || (
    quoteSettings
      ? computeClientExtras(0, { fragile: true }, quoteSettings).fragileFee
      : 0
  ));
  const insuranceFeeLabel = formatMoney(
    basePrice != null && quoteSettings
      ? computeClientExtras(basePrice, { insurance: true }, quoteSettings).insuranceFee
      : 0,
  );
  const insurancePercentLabel = quoteSettings?.insurancePercent ?? 1;

  const pickupLockersForCity = useMemo(() => {
    // Only live NP points are quoteable; never fall back to catalog placeholders.
    if (livePickupLockers == null) return [];
    return preferQuoteablePoints(livePickupLockers);
  }, [livePickupLockers]);
  const pickupBranchesForCity = useMemo(() => {
    if (livePickupBranches == null) return [];
    return preferQuoteablePoints(livePickupBranches);
  }, [livePickupBranches]);
  const destLockersForCity = useMemo(() => {
    if (liveDestLockers == null) return [];
    return preferQuoteablePoints(liveDestLockers);
  }, [liveDestLockers]);
  const destBranchesForCity = useMemo(() => {
    if (liveDestBranches == null) return [];
    return preferQuoteablePoints(liveDestBranches);
  }, [liveDestBranches]);

  const loadCoverage = useCallback(async () => {
    if (!pickupCity.trim() || !destCity.trim() || !toCountry) return null;
    setCoverageLoading(true);
    setCoverageError(null);
    try {
      const data = await fetchCoverage({
        fromCountry: PICKUP_COUNTRY,
        fromCity: pickupCity.trim(),
        toCountry,
        toCity: destCity.trim(),
      });
      setCoverage({ pickup: data.pickup, delivery: data.delivery });
      setPickupType((prev) => clampModeToSize(
        firstAvailableMode(data.pickup, prev, PICKUP_MODE_ORDER, pickupExcludedModes()),
        sizeKey,
        data.pickup,
        pickupExcludedModes(),
        customSize,
      ));
      setDeliveryType((prev) => clampModeToSize(
        firstAvailableMode(data.delivery, prev),
        sizeKey,
        data.delivery,
        [],
        customSize,
      ));
      return data;
    } catch (e) {
      setCoverageError(e instanceof Error ? e.message : t('calc.coverageCheckFail'));
      setCoverage(null);
      return null;
    } finally {
      setCoverageLoading(false);
    }
  }, [pickupCity, destCity, toCountry, sizeKey, t]);

  // Reset live points when cities change
  useEffect(() => {
    setLivePickupLockers(null);
    setLivePickupBranches(null);
    setCoverage(null);
  }, [pickupCity]);

  useEffect(() => {
    setLiveDestLockers(null);
    setLiveDestBranches(null);
    setCoverage(null);
  }, [destCity, toCountry]);

  useEffect(() => {
    setDestAddressReady(false);
    setDestAddressFocus(null);
    setDestAddressQuery('');
    setDestLocker('');
    setDestBranch('');
  }, [toCountry]);

  const applyDestAddress = useCallback((suggestion: AddressSuggestion) => {
    const extras = { city: suggestion.city, postCode: suggestion.postal };
    const street = withHouseFromQuery(
      suggestion.street || suggestion.label,
      destAddressQuery,
      extras,
    );
    const label = [street, suggestion.city, suggestion.postal].filter(Boolean).join(', ');
    setDestAddressQuery(label);
    setDestAddressFocus({ lat: suggestion.lat, lng: suggestion.lng });
    setDestAddressReady(true);
    const canonical = canonicalCityValue(toCountry, suggestion.city);
    if (canonical) setDestCity(canonical);
    else if (suggestion.city) setDestCity(suggestion.city);
    if (suggestion.postal) setDestPostal(suggestion.postal);
    setDestStreet(street);
    setDestLocker('');
    setDestBranch('');
  }, [toCountry, destAddressQuery]);

  const applyPickupAddress = useCallback((suggestion: AddressSuggestion) => {
    const extras = { city: suggestion.city, postCode: suggestion.postal };
    const street = withHouseFromQuery(
      suggestion.street || suggestion.label,
      pickupAddressQuery,
      extras,
    );
    const label = [street, suggestion.city, suggestion.postal].filter(Boolean).join(', ');
    setPickupAddressQuery(label);
    setPickupAddressFocus({ lat: suggestion.lat, lng: suggestion.lng });
    setPickupAddressReady(true);
    setPickupStreet(street);
    const canonical = canonicalCityValue(PICKUP_COUNTRY, suggestion.city);
    if (canonical) setPickupCity(canonical);
    else if (suggestion.city) setPickupCity(suggestion.city);
    if (suggestion.postal) setPickupPostal(suggestion.postal);
    setPickupLocker('');
    setPickupBranch('');
  }, [pickupAddressQuery]);

  const onPickupAddressQueryChange = useCallback((value: string) => {
    setPickupAddressQuery(value);
    setPickupStreet(value);
    setPickupAddressReady(false);
    setPickupAddressFocus(null);
  }, []);

  const onDestAddressQueryChange = useCallback((value: string) => {
    setDestAddressQuery(value);
    setDestAddressReady(false);
    setDestAddressFocus(null);
  }, []);

  const changeDestCity = useCallback((city: string) => {
    setDestCity(city);
    setDestAddressReady(false);
    setDestAddressFocus(null);
    setDestAddressQuery('');
    setDestLocker('');
    setDestBranch('');
  }, []);

  // Load concrete pickup/delivery points for mode steps and draft restore later.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const needPickupPoints = step >= 5 && isPointPickupMode(pickupType);
      const needDeliveryPoints = step >= 6 && isPointPickupMode(deliveryType);
      if (!needPickupPoints && !needDeliveryPoints) return;

      if (needPickupPoints && isLockerLikeMode(pickupType) && pickupCity.trim()) {
        setPointsLoading(true);
        try {
          const res = await fetchShippingPoints({
            country: PICKUP_COUNTRY,
            city: pickupCity.trim(),
            kind: pointsKindForMode(pickupType),
            side: 'pickup',
          });
          if (!cancelled) {
            const points = preferQuoteablePoints(res.points || []);
            setLivePickupLockers(points);
            setPickupLocker((prev) => (
              points.some((p) => p.id === prev) ? prev : (firstNpDivisionId(points) || '')
            ));
          }
        } catch {
          if (!cancelled) setLivePickupLockers([]);
        } finally {
          if (!cancelled) setPointsLoading(false);
        }
      }
      if (needPickupPoints && pickupType === 'branch' && pickupCity.trim()) {
        setPointsLoading(true);
        try {
          const res = await fetchShippingPoints({
            country: PICKUP_COUNTRY,
            city: pickupCity.trim(),
            kind: 'branch',
            side: 'pickup',
          });
          if (!cancelled) {
            const points = preferQuoteablePoints(res.points || []);
            setLivePickupBranches(points);
            setPickupBranch((prev) => (
              points.some((p) => p.id === prev) ? prev : (firstNpDivisionId(points) || '')
            ));
          }
        } catch {
          if (!cancelled) setLivePickupBranches([]);
        } finally {
          if (!cancelled) setPointsLoading(false);
        }
      }
      if (needDeliveryPoints && isLockerLikeMode(deliveryType) && destCity.trim()) {
        setPointsLoading(true);
        try {
          const res = await fetchShippingPoints({
            country: toCountry,
            city: destCity.trim(),
            kind: pointsKindForMode(deliveryType),
            side: 'delivery',
          });
          if (!cancelled) {
            const points = preferQuoteablePoints(res.points || []);
            setLiveDestLockers(points);
            setDestLocker((prev) => (
              points.some((p) => p.id === prev) ? prev : (firstNpDivisionId(points) || '')
            ));
          }
        } catch {
          if (!cancelled) setLiveDestLockers([]);
        } finally {
          if (!cancelled) setPointsLoading(false);
        }
      }
      if (needDeliveryPoints && deliveryType === 'branch' && destCity.trim()) {
        setPointsLoading(true);
        try {
          const res = await fetchShippingPoints({
            country: toCountry,
            city: destCity.trim(),
            kind: 'branch',
            side: 'delivery',
          });
          if (!cancelled) {
            const points = preferQuoteablePoints(res.points || []);
            setLiveDestBranches(points);
            setDestBranch((prev) => (
              points.some((p) => p.id === prev) ? prev : (firstNpDivisionId(points) || '')
            ));
          }
        } catch {
          if (!cancelled) setLiveDestBranches([]);
        } finally {
          if (!cancelled) setPointsLoading(false);
        }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [step, pickupType, deliveryType, pickupCity, destCity, toCountry]);

  // If user lands mid-flow without coverage (e.g. after restoring draft), load it
  useEffect(() => {
    if (step >= 4 && step <= 9 && !coverage && !coverageLoading && pickupCity.trim() && destCity.trim()) {
      void loadCoverage();
    }
  }, [step, coverage, coverageLoading, pickupCity, destCity, loadCoverage]);

  // Sync selection once live lists arrive. Keep a valid NP draft id while loading (null).
  useEffect(() => {
    if (livePickupLockers == null) {
      if (pickupLocker && !isNpDivisionId(pickupLocker)) setPickupLocker('');
      return;
    }
    if (pickupLockersForCity.some((l) => l.id === pickupLocker)) return;
    setPickupLocker(firstNpDivisionId(pickupLockersForCity));
  }, [livePickupLockers, pickupLockersForCity, pickupLocker]);

  useEffect(() => {
    if (livePickupBranches == null) {
      if (pickupBranch && !isNpDivisionId(pickupBranch)) setPickupBranch('');
      return;
    }
    if (pickupBranchesForCity.some((l) => l.id === pickupBranch)) return;
    setPickupBranch(firstNpDivisionId(pickupBranchesForCity));
  }, [livePickupBranches, pickupBranchesForCity, pickupBranch]);

  useEffect(() => {
    if (liveDestLockers == null) {
      if (destLocker && !isNpDivisionId(destLocker)) setDestLocker('');
      return;
    }
    if (destLockersForCity.some((l) => l.id === destLocker)) return;
    if (destAddressFocus && destLockersForCity.length) {
      const { lat, lng } = destAddressFocus;
      const toRad = (d: number) => (d * Math.PI) / 180;
      const distKm = (aLat: number, aLng: number) => {
        const R = 6371;
        const dLat = toRad(aLat - lat);
        const dLng = toRad(aLng - lng);
        const s =
          Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(lat)) * Math.cos(toRad(aLat)) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(s));
      };
      const nearest = [...destLockersForCity].sort(
        (a, b) => distKm(a.lat, a.lng) - distKm(b.lat, b.lng),
      )[0];
      if (nearest) {
        setDestLocker(nearest.id);
        return;
      }
    }
    setDestLocker(firstNpDivisionId(destLockersForCity));
  }, [liveDestLockers, destLockersForCity, destLocker, destAddressFocus]);

  useEffect(() => {
    if (liveDestBranches == null) {
      if (destBranch && !isNpDivisionId(destBranch)) setDestBranch('');
      return;
    }
    if (destBranchesForCity.some((l) => l.id === destBranch)) return;
    if (destAddressFocus && destBranchesForCity.length) {
      const { lat, lng } = destAddressFocus;
      const toRad = (d: number) => (d * Math.PI) / 180;
      const distKm = (aLat: number, aLng: number) => {
        const R = 6371;
        const dLat = toRad(aLat - lat);
        const dLng = toRad(aLng - lng);
        const s =
          Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(lat)) * Math.cos(toRad(aLat)) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(s));
      };
      const nearest = [...destBranchesForCity].sort(
        (a, b) => distKm(a.lat, a.lng) - distKm(b.lat, b.lng),
      )[0];
      if (nearest) {
        setDestBranch(nearest.id);
        return;
      }
    }
    setDestBranch(firstNpDivisionId(destBranchesForCity));
  }, [liveDestBranches, destBranchesForCity, destBranch, destAddressFocus]);

  const pickupLocationObj = pickupType === 'branch'
    ? pickupBranchesForCity.find((l) => l.id === pickupBranch) || null
    : isLockerLikeMode(pickupType)
      ? pickupLockersForCity.find((l) => l.id === pickupLocker) || null
      : null;
  const destLocationObj = deliveryType === 'branch'
    ? destBranchesForCity.find((l) => l.id === destBranch) || null
    : isLockerLikeMode(deliveryType)
      ? destLockersForCity.find((l) => l.id === destLocker) || null
      : null;

  const buildPickupLine = () => {
    if (isPointPickupMode(pickupType)) {
      return `${countryLabel(PICKUP_COUNTRY, locale)}, ${pickupLocationObj?.address || t('calc.pointFallback')}`;
    }
    return `${countryLabel(PICKUP_COUNTRY, locale)}, ${pickupStreet}, ${pickupCity} ${pickupPostal}`.trim();
  };

  const buildDestLine = () => {
    if (isPointPickupMode(deliveryType)) {
      return `${countryLabel(toCountry, locale)}, ${destLocationObj?.address || t('calc.pointFallback')}`;
    }
    return `${countryLabel(toCountry, locale)}, ${destStreet}, ${destCity} ${destPostal}`.trim();
  };

  const contentLabel = useCallback((key: ContentKey, note?: string) => {
    if (key === 'other' && note?.trim()) return t('calc.otherFmt', { note: note.trim() });
    return t(`calc.content${key.charAt(0).toUpperCase()}${key.slice(1)}`);
  }, [t]);

  const formatDeliveryTypeLocalized = useCallback((pickup: DeliveryMode, delivery: DeliveryMode) => {
    const labels: Record<DeliveryMode, string> = {
      home: t('calc.modeHomeShort'),
      branch: t('calc.modeBranchShort'),
      locker: t('calc.modeLockerShort'),
      pudo: t('calc.modePudoShort'),
    };
    return `${labels[pickup]} → ${labels[delivery]}`;
  }, [t]);

  const valueOptions = useMemo(() => VALUE_KEYS.map((key) => ({
    key,
    label: t(`calc.value${key.charAt(0).toUpperCase()}${key.slice(1)}`),
  })), [t]);

  const sizeLabel = sizeKey === 'custom'
    ? t('calc.sizeCustomFmt', { l: customSize.l, w: customSize.w, h: customSize.h, kg: customSize.kg })
    : sizeKey;

  const summaryRows: SummaryRow[] = useMemo(() => [
    { key: 'from', label: t('calc.summaryFrom'), value: formatRoute(PICKUP_COUNTRY, toCountry), onEdit: () => goTo(1) },
    { key: 'cities', label: t('calc.summaryCities'), value: [cityLabelForValue(PICKUP_COUNTRY, pickupCity, locale), cityLabelForValue(toCountry, destCity, locale)].filter(Boolean).join(' → ') || '—', onEdit: () => goTo(2) },
    { key: 'type', label: t('calc.summaryType'), value: formatDeliveryTypeLocalized(pickupType, deliveryType), onEdit: () => goTo(4) },
    { key: 'size', label: t('calc.summarySize'), value: sizeLabel, onEdit: () => goTo(3) },
    {
      key: 'contents',
      label: t('calc.summaryContents'),
      value: contentLabel(contents, contentsNote),
      onEdit: isEnvelopeSize(sizeKey) ? undefined : () => goTo(7),
    },
    {
      key: 'value',
      label: t('calc.summaryValue'),
      value: valueOptions.find((v) => v.key === contentValue)?.label || '—',
      onEdit: isEnvelopeSize(sizeKey) ? undefined : () => goTo(8),
    },
    {
      key: 'pays',
      label: t('calc.summaryPays'),
      value: payer === 'sender' ? t('calc.payerSender') : t('calc.payerReceiver'),
      onEdit: isEnvelopeSize(sizeKey) ? undefined : () => goTo(8),
    },
    { key: 'sender', label: t('calc.summarySender'), value: [senderFirst, senderLast].filter(Boolean).join(' ') || pickupLocationObj?.provider || '—', onEdit: () => goTo(5) },
    { key: 'recipient', label: t('calc.summaryRecipient'), value: receiverFirst ? `${receiverFirst} ${receiverLast}`.trim() : destLocationObj?.provider || '—', onEdit: () => goTo(6) },
    { key: 'when', label: t('calc.summaryWhen'), value: pickupDate ? `${pickupDate}, ${t('calc.pickupWithinDay')}` : '—' },
  ], [
    t, toCountry, pickupCity, destCity, pickupType, deliveryType, sizeKey, sizeLabel, contents, contentsNote, contentValue, payer,
    senderFirst, senderLast, pickupLocationObj, receiverFirst, receiverLast, destLocationObj, pickupDate, pickupTime,
    contentLabel, formatDeliveryTypeLocalized, valueOptions,
  ]);

  const visibleSummaryRows = useMemo(() => {
    const keys = STEP_SUMMARY_KEYS[step];
    if (!keys) return [];
    return summaryRows.filter((row) => keys.includes(row.key));
  }, [step, summaryRows]);

  const validateCurrentStep = useCallback((): string | null => {
    if (step === 1 && !toCountry) return t('calc.valSelectCountry');
    if (step === 2) {
      if (!pickupCity.trim()) return t('calc.valPickupCity');
      if (!destCity.trim()) return t('calc.valDestCity');
    }
    if (step === 3) {
      if (!SIZE_OPTION_KEYS.includes(sizeKey as ParcelKey | 'custom')) return t('calc.valSelectSize');
      if (sizeKey === 'custom') {
        if (!customSize.kg) {
          return t('calc.valCustomSize');
        }
        if (Number(customSize.kg) > MAX_CUSTOM_WEIGHT_KG) return t('calc.valMaxWeight');

        // Courier-only “label fits” minimum: 5 × 15 × 15 cm (order-independent).
        // We validate sorted ascending to match minSideCm: [5, 15, 15].
        const l = Number(customSize.l);
        const w = Number(customSize.w);
        const h = Number(customSize.h);
        const lwh = [l, w, h].map((cm) => (Number.isFinite(cm) ? cm : 0)).sort((a, b) => a - b);
        const minSmall = NONSTANDARD_LIMITS.minSideCm[0];
        const minMid = NONSTANDARD_LIMITS.minSideCm[1];
        // If the smallest side < 5 or the middle side < 15 — courier label may not fit.
        if (lwh[0] < minSmall || lwh[1] < minMid) return t('calc.sizeNonstandardNote');
        // Official Nova Post: longest ≤120 cm, sum of sides ≤150 cm.
        if (lwh[2] > NONSTANDARD_LIMITS.maxLengthCm) return t('calc.valMaxLength');
        if (lwh[0] + lwh[1] + lwh[2] > NONSTANDARD_LIMITS.maxSumSidesCm) {
          return t('calc.valMaxSumSides');
        }
      }
    }
    if (step === 4) {
      if (!pickupType || !deliveryType) return t('calc.valSelectModes');
      if (PICKUP_FROM_LOCKER_COMING_SOON && pickupType === 'locker') {
        return t('calc.valPickupLockerSoon');
      }
      const sizeModes = modesForSize(sizeKey, customSize);
      if (!sizeModes.includes(pickupType) || !sizeModes.includes(deliveryType)) {
        return t('calc.valSizeMode');
      }
      if (coverage) {
        if (!coverage.pickup[pickupType]?.available) return t('calc.valPickupMode');
        if (!coverage.delivery[deliveryType]?.available) return t('calc.valDeliveryMode');
      }
    }
    if (step === 5) {
      const firstErr = validatePersonName(senderFirst, t('calc.fieldSenderFirst'));
      const lastErr = validatePersonName(senderLast, t('calc.fieldSenderLast'));
      if (firstErr && lastErr) return t('calc.valSenderName');
      const emailErr = validateEmail(senderEmail, t('calc.fieldSenderEmail'));
      if (emailErr) return emailErr;
      const phoneErr = validatePhone(senderDial, senderPhone, countryCodeFromDial(senderDial), t('calc.fieldSenderPhone'));
      if (phoneErr) return phoneErr;
      if (pickupType === 'home') {
        if (!pickupAddressReady) return t('calc.valSelectAddressHint');
        if (!pickupStreet || !pickupCity || !pickupPostal) return t('calc.valPickupAddress');
        if (!pickupDate || isCourierPickupWeekend(pickupDate)) return t('calc.valPickupWeekday');
        if (pickupDate < nextCourierPickupDateIso()) return t('calc.valPickupWeekday');
      }
      // Locker address is optional — it only helps filter nearby points.
      if (pickupType === 'branch' && pickupNeedsAddressRefinement && !pickupAddressReady) {
        return t('calc.valSelectAddressHint');
      }
      if (isLockerLikeMode(pickupType) && !pickupLocker) {
        return pickupType === 'pudo' ? t('calc.valSelectPickupPudo') : t('calc.valSelectPickupLocker');
      }
      if (pickupType === 'branch' && !pickupBranch) return t('calc.valSelectPickupBranch');
      if (!pickupQuoteLocation) {
        return pickupType === 'home' ? t('calc.valPickupAddress') : t('calc.valSelectPickupPointNp');
      }
    }
    if (step === 6) {
      const firstErr = validatePersonName(receiverFirst, t('calc.fieldReceiverFirst'));
      const lastErr = validatePersonName(receiverLast, t('calc.fieldReceiverLast'));
      if (firstErr && lastErr) return t('calc.valReceiverName');
      const emailErr = validateEmail(receiverEmail, t('calc.fieldReceiverEmail'));
      if (emailErr) return emailErr;
      const phoneErr = validatePhone(receiverDial, receiverPhone, countryCodeFromDial(receiverDial), t('calc.fieldReceiverPhone'));
      if (phoneErr) return phoneErr;
      if (toCountry === 'FR' && receiverDial !== (DIAL_BY_CC.FR || '+33')) {
        return `${t('calc.fieldReceiverPhone')}: для доставки во Францию укажите французский номер (+33)`;
      }
      if (deliveryType === 'home') {
        if (!destAddressReady) return t('calc.valSelectAddressHint');
        if (!destStreet || !destCity || !destPostal) return t('calc.valDeliveryAddress');
      }
      // Locker/PUDO/branch address is optional when a point is already chosen.
      if (isLockerLikeMode(deliveryType) && !destLocker) {
        return deliveryType === 'pudo' ? t('calc.valSelectDestPudo') : t('calc.valSelectDestLocker');
      }
      if (deliveryType === 'branch' && !destBranch) return t('calc.valSelectDestBranch');
      if (!deliveryQuoteLocation) {
        return deliveryType === 'home' ? t('calc.valDeliveryAddress') : t('calc.valSelectDeliveryPointNp');
      }
    }
    if (step === 7) {
      if (!contents) return t('calc.valSelectContents');
      if (contents === 'other' && !contentsNote.trim()) return t('calc.valDescribeContents');
    }
    if (step === 8 && (!contentValue || !payer)) return t('calc.valValuePayer');
    if (step === 9) {
      if (!termsAccepted) return t('calc.valAcceptTerms');
      if (totalPrice == null) return t('calc.valWaitQuote');
      if (!(Number(totalPrice) > 0)) return t('calc.valWaitQuote');
      if (!pickupQuoteLocation) {
        return pickupType === 'home' ? t('calc.valPickupAddress') : t('calc.valSelectPickupPointNp');
      }
      if (!deliveryQuoteLocation) {
        return deliveryType === 'home' ? t('calc.valDeliveryAddress') : t('calc.valSelectDeliveryPointNp');
      }
      const firstErr = validatePersonName(senderFirst, t('calc.fieldSenderFirst'));
      const lastErr = validatePersonName(senderLast, t('calc.fieldSenderLast'));
      if (firstErr && lastErr) return t('calc.valSenderName');
      const emailErr = validateEmail(senderEmail, t('calc.fieldSenderEmail'));
      if (emailErr) return emailErr;
      const sPhoneErr = validatePhone(senderDial, senderPhone, countryCodeFromDial(senderDial), t('calc.fieldSenderPhone'));
      if (sPhoneErr) return sPhoneErr;
      const rEmailErr = validateEmail(receiverEmail, t('calc.fieldReceiverEmail'));
      if (rEmailErr) return rEmailErr;
      const rPhoneErr = validatePhone(receiverDial, receiverPhone, countryCodeFromDial(receiverDial), t('calc.fieldReceiverPhone'));
      if (rPhoneErr) return rPhoneErr;
      if (toCountry === 'FR' && receiverDial !== (DIAL_BY_CC.FR || '+33')) {
        return `${t('calc.fieldReceiverPhone')}: для доставки во Францию укажите французский номер (+33)`;
      }
    }
    return null;
  }, [
    t, step, toCountry, pickupType, deliveryType, sizeKey, customSize, contents, contentsNote, contentValue, payer,
    senderFirst, senderLast, senderEmail, senderDial, senderPhone, pickupStreet, pickupCity, pickupPostal, pickupLocker, pickupBranch,
    pickupNeedsAddressRefinement, pickupAddressReady, pickupDate,
    receiverFirst, receiverLast, receiverEmail, receiverDial, receiverPhone, destStreet, destCity, destPostal, destLocker, destBranch,
    destAddressReady, termsAccepted, totalPrice, coverage, pickupQuoteLocation, deliveryQuoteLocation,
  ]);

  const handleNext = async () => {
    const err = validateCurrentStep();
    if (err) {
      setError(err);
      return;
    }
    setError(null);

    if (step === 2) {
      const data = await loadCoverage();
      if (!data) {
        // Coverage failed — size tiles may still show branch samples; step 4
        // re-quotes for the chosen mode (home for Paris-like cities).
        setCoverageError(t('calc.coverageCheckFail'));
      }
    }

    goTo(nextCalcStep(step, sizeKey));
  };

  const handlePay = async () => {
    const stepErr = validateCurrentStep();
    if (stepErr) {
      setError(stepErr);
      return;
    }
    if (totalPrice == null || !(Number(totalPrice) > 0) || payInFlight.current || submitting) return;
    trackAnalytics({
      event: 'calc_pay_click',
      step: 9,
      toCountry,
      fromCity: pickupCity,
      toCity: destCity,
      sizeKey: String(sizeKey),
      pickupMode: pickupType,
      deliveryMode: deliveryType,
      locale,
    });
    const payEmail = senderEmail.trim().toLowerCase();
    const emailErr = validateEmail(payEmail, t('calc.fieldSenderEmail'));
    if (emailErr) {
      setError(emailErr);
      goTo(5);
      return;
    }
    const recipientEmail = receiverEmail.trim().toLowerCase();
    if (payer === 'receiver') {
      const rEmailErr = validateEmail(recipientEmail, t('calc.fieldReceiverEmail'));
      if (rEmailErr) {
        setError(rEmailErr);
        goTo(6);
        return;
      }
    }

    payInFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const preset = sizeToPreset(sizeKey, customSize);
      const boxSize = sizeToApiKey(sizeKey, customSize);
      const declaredForNp = Math.max(insurance ? declaredValue : 100, 50);
      const pickupLabel = buildPickupLine();
      const destLabel = buildDestLine();

      let payAmount = totalPrice;
      const payCurrency = currency;

      const result = await checkout({
        customerEmail: payEmail,
        amount: payAmount,
        currency: payCurrency,
        locale,
        ...(promoCode ? { promoCode } : {}),
        sender: {
          country: PICKUP_COUNTRY,
          line: pickupLabel,
          name: [senderFirst, senderLast].filter(Boolean).join(' ').trim(),
          email: payEmail,
          phone: composePhone(senderDial, senderPhone),
        },
        receiver: {
          firstName: receiverFirst || 'Recipient',
          lastName: receiverLast || 'Customer',
          phone: composePhone(receiverDial, receiverPhone),
          email: recipientEmail,
          destinationLine: destLabel,
          country: toCountry,
        },
        parcel: {
          boxSize: sizeKey === 'custom' ? 'custom' : boxSize,
          ...preset,
          declaredValue: declaredForNp,
          contents,
          contentsNote: contents === 'other' ? contentsNote.trim() : '',
          description: contents === 'other' && contentsNote.trim()
            ? `Parcel ${sizeKey === 'custom' ? 'custom' : boxSize} — ${t('calc.otherFmt', { note: contentsNote.trim() })}`
            : `Parcel ${sizeKey === 'custom' ? 'custom' : boxSize} — ${contentLabel(contents, contentsNote)}`,
          fragile,
          insurance,
          insuredValueEur: declaredValue,
        },
        tariff: {
          service: 'Delivery',
          pickupDate,
          pickupTime,
          fromCountry: PICKUP_COUNTRY,
          toCountry,
          fragile,
          insurance,
          insuredValueEur: insurance ? declaredValue : 0,
          pickupMode: pickupType,
          deliveryMode: deliveryType,
          payer,
          payerType: quotePayerType,
          pickupLocation: pickupType === 'home'
            ? pickupQuoteLocation
            : divisionQuoteLocation(
              PICKUP_COUNTRY,
              isLockerLikeMode(pickupType) ? pickupLocker : pickupBranch,
              pointMeta(pickupLocationObj),
            ),
          deliveryLocation: deliveryType === 'home'
            ? deliveryQuoteLocation
            : divisionQuoteLocation(
              toCountry,
              isLockerLikeMode(deliveryType) ? destLocker : destBranch,
              pointMeta(destLocationObj),
            ),
        },
      });

      if (result.awaitingRecipientPayment) {
        trackAnalytics({
          event: 'calc_checkout_ok',
          step: 9,
          toCountry,
          fromCity: pickupCity,
          toCity: destCity,
          sizeKey: String(sizeKey),
          pickupMode: pickupType,
          deliveryMode: deliveryType,
          locale,
          amount: result.amount,
          currency: result.currency,
        });
        skipDraftFlushRef.current = true;
        suppressCalcDraftWrites(true);
        clearAllCalcDrafts(user?.id);
        onAwaitingRecipientPayment?.({
          orderNumber: result.orderNumber,
          publicToken: result.publicToken,
          recipientEmail: result.recipientEmail || recipientEmail,
          amount: result.amount,
          currency: result.currency,
        });
        _onDone?.();
        return;
      }

      if (result.checkoutUrl) {
        trackAnalytics({
          event: 'calc_checkout_ok',
          step: 9,
          toCountry,
          fromCity: pickupCity,
          toCity: destCity,
          sizeKey: String(sizeKey),
          pickupMode: pickupType,
          deliveryMode: deliveryType,
          locale,
          amount: result.amount,
          currency: result.currency,
        });
        // Clear before Stripe redirect; suppress saves so pagehide cannot revive the cart.
        skipDraftFlushRef.current = true;
        suppressCalcDraftWrites(true);
        clearAllCalcDrafts(user?.id);
        window.location.assign(result.checkoutUrl);
        return;
      }
      throw new Error(t('calc.payLinkMissing'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      const localized = localizeApiError(msg, t, 'calc.orderFail');
      const timedOut = /serverDown|AbortError|timed out|timeout|не отвечает|nem válaszol|не відповідає/i.test(msg + localized);
      setError(timedOut ? t('calc.checkoutTimeout') : localized);
    } finally {
      payInFlight.current = false;
      setSubmitting(false);
    }
  };

  const nav = () => (
    <div className="calc-form__nav">
      {error && (
        <div className="calc-form__error calc-form__error--nav" role="alert">
          {error.split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
      {step > 1 && (
        <button type="button" className="btn btn-outline" onClick={() => goTo(prevCalcStep(step, sizeKey))}>
          {t('common.back')}
        </button>
      )}
      {step < TOTAL_STEPS ? (
        <button
          type="button"
          className="btn btn-lime"
          onClick={handleNext}
          disabled={coverageLoading || (step === 2 && !pickupCity.trim()) || (step === 2 && !destCity.trim())}
        >
          {step === 2 && coverageLoading ? t('common.checking') : t('common.next')}
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-lime"
          disabled={submitting || totalPrice == null || !(Number(totalPrice) > 0) || quoteRefreshing}
          onClick={handlePay}
        >
          {submitting
            ? (payer === 'receiver' ? t('calc.sendingPayLink') : t('calc.paying'))
            : (totalPrice == null || !(Number(totalPrice) > 0) || quoteRefreshing)
              ? t('calc.summaryCalculating')
              : payer === 'receiver'
                ? t('calc.sendPayLink', { amount: formatMoney(totalPrice) })
                : t('calc.pay', { amount: formatMoney(totalPrice) })}
        </button>
      )}
    </div>
  );

  /* Mobile + desktop: hide «Итого» until cities step, then show it above «Далее» */
  const showSummary = step >= 2;
  const summaryCompact = step === 3;
  const navAfterLayout = inModal || showSummary;

  const summaryEl = showSummary ? (
    <OrderSummary
      rows={visibleSummaryRows}
      price={totalPrice}
      currency={currency}
      deliveryEstimate={(() => {
        const npEta = formatScheduledDelivery(npScheduledDeliveryDate, locale);
        if (npEta) return t('calc.deliveryEstimateNp', { date: npEta.dateLabel });
        const band = deliveryEtaForCountry(toCountry);
        return t('calc.deliveryEstimate', { min: band.minDays, max: band.maxDays });
      })()}
      deliveryEstimateNote={
        npScheduledDeliveryDate
          ? t('calc.deliveryEstimateNoteNp')
          : t('calc.deliveryEstimateNote')
      }
      compact={summaryCompact}
      pricePending={quoteRefreshing && totalPrice == null}
      priceIsMinimum={priceIsMinimum}
      welcomeDiscountPercent={welcomeDiscountPercent}
      promoHint={promoHint}
      deliveryAmount={promoTotal == null ? basePrice : extras.base}
      fragileFee={extras.fragileFee}
      insuranceFee={extras.insuranceFee}
      insurancePercent={extras.insurancePercent}
    />
  ) : null;

  const stepMeta = useMemo(() => ({
    1: { title: t('calc.step1Title'), sub: t('calc.step1Sub') },
    2: { title: t('calc.step2Title'), sub: t('calc.step2Sub') },
    3: { title: t('calc.step4Title'), sub: t('calc.step4Sub') },
    4: { title: t('calc.step3Title'), sub: t('calc.step3Sub') },
    5: { title: t('calc.step7Title'), sub: t('calc.step7Sub') },
    6: { title: t('calc.step8Title'), sub: t('calc.step8Sub') },
    7: { title: t('calc.step5Title'), sub: t('calc.step5Sub') },
    8: { title: t('calc.step6Title'), sub: t('calc.step6Sub') },
    9: { title: t('calc.step9Title'), sub: t('calc.step9Sub') },
  }), [t]);

  const sizeAllowedModes = useMemo(
    () => modesForSize(sizeKey, customSize),
    [sizeKey, customSize.l, customSize.w, customSize.h, customSize.kg],
  );

  const deliveryModes = useMemo(() => DELIVERY_MODE_KEYS.map((key) => ({
    key,
    label: t(`calc.mode${key === 'home' ? 'Home' : key === 'branch' ? 'Branch' : key === 'pudo' ? 'Pudo' : 'Locker'}`),
    icon: DELIVERY_MODE_ICONS[key],
  })), [t]);

  const modeChipLabel = useCallback((key: DeliveryMode) => (
    t(`calc.mode${key === 'home' ? 'HomeShort' : key === 'branch' ? 'BranchShort' : key === 'pudo' ? 'PudoShort' : 'LockerShort'}`)
  ), [t]);

  const sizeOptions = useMemo(() => (
    SIZE_OPTION_KEYS.map((key) => {
      const allowed = key === 'custom'
        ? modesForSize('custom', customSize)
        : SIZE_ALLOWED_MODES[key];
      if (key === 'custom') {
        return {
          key,
          label: t('calc.sizeCustom'),
          icon: '📐',
          dims: t('calc.sizeNonstandardDims', { kg: MAX_CUSTOM_WEIGHT_KG, cm: NONSTANDARD_LIMITS.maxLengthCm }),
          weight: null as string | null,
          modes: allowed,
        };
      }
      const p = PARCEL_PRESETS[key];
      const maxKg = PARCEL_LIMITS[key]?.maxWeightKg ?? p.weightKg;
      return {
        key,
        label: key === 'XS' ? t('calc.sizeEnvelope') : key,
        icon: SIZE_ICONS[key],
        dims: key === 'XS' ? '' : t('calc.sizeDimsFmt', { l: p.lengthCm, w: p.widthCm, h: p.heightCm }),
        weight: t('calc.sizeWeightFmt', { kg: key === 'XS' ? p.weightKg : maxKg }),
        modes: allowed,
      };
    })
  ), [t, customSize.l, customSize.w, customSize.h, customSize.kg]);

  const customWeightValue = Math.min(
    MAX_CUSTOM_WEIGHT_KG,
    Math.max(CUSTOM_WEIGHT_MIN_KG, Number(customSize.kg) || CUSTOM_WEIGHT_MIN_KG),
  );

  const modeHint = useCallback((side: CoverageSide | null | undefined, key: DeliveryMode) => {
    if (!sizeAllowedModes.includes(key)) return t('calc.sizeModeUnavailable');
    if (!side || side[key]?.available) return undefined;
    if (key === 'locker') return t('calc.noLockers');
    if (key === 'pudo') return t('calc.noPudo');
    if (key === 'branch') return t('calc.noBranch');
    return t('calc.unavailable');
  }, [t, sizeAllowedModes]);

  const contentOptions = useMemo(() => CONTENT_KEYS.map((key) => ({
    key,
    label: t(`calc.content${key.charAt(0).toUpperCase()}${key.slice(1)}`),
    icon: CONTENT_ICONS[key],
  })), [t]);

  const addressPlaceholder = useCallback((country: string, city: string) => (
    city.trim()
      ? t('calc.addressPlaceholderInCity', { city: cityLabelForValue(country, city, locale) })
      : t('calc.addressPlaceholder')
  ), [t, locale]);

  const stepContent = (
    <>
      {step === 1 && (
        <>
          <StepHeader step={1} title={stepMeta[1].title} subtitle={stepMeta[1].sub} />
              <div className="field-block">
                <label className="calc-form__field-label">{t('calc.from')}</label>
                <div className="calc-form__static calc-form__static--active calc-country-static">
                  <CountryFlag code={PICKUP_COUNTRY} size={22} />
                  <span>{countryLabel(PICKUP_COUNTRY, locale)}</span>
                </div>
              </div>
              <div className="field-block">
                <label className="calc-form__field-label">{t('calc.to')}</label>
                <CountrySelect
                  value={toCountry}
                  onChange={(code) => {
                    setToCountry(code);
                    setReceiverDial(DIAL_BY_CC[code] || '+36');
                  }}
                />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <StepHeader step={2} title={stepMeta[2].title} subtitle={stepMeta[2].sub} />
              <div className="field-block">
                <label className="calc-form__field-label">{t('calc.pickupCity')}</label>
                <div className="calc-city-row">
                  <CitySelect
                    country={PICKUP_COUNTRY}
                    value={pickupCity}
                    onChange={changePickupCity}
                    ariaLabel={t('calc.pickupCityAria')}
                  />
                  <button
                    type="button"
                    className="btn btn-outline calc-geo-btn"
                    onClick={() => { void locatePickupCity(); }}
                    disabled={geoLoading}
                  >
                    {geoLoading ? t('calc.geoLoading') : t('calc.geoBtn')}
                  </button>
                </div>
                <input
                  className="calc-city-custom"
                  value={pickupCity}
                  onChange={(e) => changePickupCity(e.target.value)}
                  placeholder={t('calc.cityPlaceholder')}
                />
                {geoError && <p className="calc-form__hint calc-form__hint--error">{geoError}</p>}
              </div>
              <div className="field-block">
                <label className="calc-form__field-label">{t('calc.destCity')}</label>
                <CitySelect
                  country={toCountry}
                  value={destCity}
                  onChange={changeDestCity}
                  ariaLabel={t('calc.destCityAria')}
                />
                <input
                  className="calc-city-custom"
                  value={destCity}
                  onChange={(e) => changeDestCity(e.target.value)}
                  placeholder={t('calc.cityPlaceholder')}
                />
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <StepHeader step={4} title={stepMeta[4].title} subtitle={stepMeta[4].sub} />
              {coverageLoading && (
                <p className="calc-form__hint calc-form__hint--inline calc-form__hint--wait" aria-live="polite">
                  <span className="calc-user-loc__pulse" aria-hidden />
                  {t('calc.checkingCoverage')}
                </p>
              )}
              {coverageError && (
                <p className="calc-form__hint">{t('calc.coverageFail', { error: coverageError })}</p>
              )}
              <p className="calc-form__group-label">{t('calc.pickupWhere')}</p>
              <OptionGrid
                options={deliveryModes}
                value={pickupType}
                onChange={setPickupType}
                columns={2}
                disabledKeys={{
                  locker: PICKUP_FROM_LOCKER_COMING_SOON
                    || !sizeAllowedModes.includes('locker')
                    || (coverage ? !coverage.pickup.locker.available : false),
                  pudo: !sizeAllowedModes.includes('pudo')
                    || (coverage ? !coverage.pickup.pudo?.available : false),
                  branch: !sizeAllowedModes.includes('branch') || (coverage ? !coverage.pickup.branch.available : false),
                  home: !sizeAllowedModes.includes('home'),
                }}
                comingSoonKeys={{
                  locker: PICKUP_FROM_LOCKER_COMING_SOON,
                }}
                hints={{
                  locker: PICKUP_FROM_LOCKER_COMING_SOON
                    ? t('calc.pickupLockerSoonHint')
                    : modeHint(coverage?.pickup, 'locker'),
                  pudo: modeHint(coverage?.pickup, 'pudo'),
                  branch: modeHint(coverage?.pickup, 'branch'),
                  home: modeHint(coverage?.pickup, 'home'),
                }}
              />
              <p className="calc-form__group-label">{t('calc.deliverWhere')}</p>
              <OptionGrid
                options={deliveryModes}
                value={deliveryType}
                onChange={setDeliveryType}
                columns={2}
                disabledKeys={{
                  locker: !sizeAllowedModes.includes('locker') || (coverage ? !coverage.delivery.locker.available : false),
                  pudo: !sizeAllowedModes.includes('pudo') || (coverage ? !coverage.delivery.pudo?.available : false),
                  branch: !sizeAllowedModes.includes('branch') || (coverage ? !coverage.delivery.branch.available : false),
                  home: !sizeAllowedModes.includes('home'),
                }}
                hints={{
                  locker: modeHint(coverage?.delivery, 'locker'),
                  pudo: modeHint(coverage?.delivery, 'pudo'),
                  branch: modeHint(coverage?.delivery, 'branch'),
                  home: modeHint(coverage?.delivery, 'home'),
                }}
              />
            </>
          )}

          {step === 3 && (
            <>
              <StepHeader
                step={3}
                title={stepMeta[3].title}
                subtitle={stepMeta[3].sub}
              />
              <div className="calc-form__sizes">
                {sizeOptions.map((s) => {
                  const price = s.key === 'custom'
                    ? (sizeKey === 'custom' ? customQuote : null)
                    : parcelQuotes[s.key];
                  return (
                    <button
                      key={s.key}
                      type="button"
                      className={`calc-form__size${sizeKey === s.key ? ' active' : ''}`}
                      onClick={() => {
                        if (s.key === 'custom') {
                          if (sizeKey !== 'custom') {
                            modesBeforeCustomRef.current = {
                              pickup: pickupType,
                              delivery: deliveryType,
                            };
                          }
                          setSizeKey('custom');
                          return;
                        }

                        setSizeKey(s.key);
                        setCustomSize(presetToEditableSize(PARCEL_PRESETS[s.key]));
                        if (s.key === 'XS') {
                          setContents('documents');
                          setContentsNote('');
                          setContentValue('under100');
                        }
                        const restored = modesBeforeCustomRef.current;
                        if (restored) {
                          modesBeforeCustomRef.current = null;
                          setPickupType(
                            clampModeToSize(restored.pickup, s.key, coverage?.pickup, pickupExcludedModes()),
                          );
                          setDeliveryType(
                            clampModeToSize(restored.delivery, s.key, coverage?.delivery),
                          );
                        }
                      }}
                    >
                      <span className="calc-form__size-icon" aria-hidden>{s.icon}</span>
                      <span className="calc-form__size-body">
                        <b>{s.label}</b>
                        {s.dims ? <span className="calc-form__size-dims">{s.dims}</span> : null}
                        {s.weight && <span className="calc-form__size-weight">{s.weight}</span>}
                        <span className="calc-form__size-modes">
                          {MODE_CHIP_ORDER.filter((m) => s.modes.includes(m)).map((m) => (
                            <span key={m} className="calc-form__size-mode">{modeChipLabel(m)}</span>
                          ))}
                        </span>
                      </span>
                      {price != null ? (
                        <em className={quoteRefreshing && !quotesFromNp ? 'calc-form__price-est' : ''}>
                          {formatMoney(price)}
                        </em>
                      ) : s.key === 'custom' ? (
                        <em className="calc-form__price-est">{t('calc.sizeCustomPrice')}</em>
                      ) : quoteRefreshing ? (
                        <em className="calc-form__price-est">{t('calc.summaryCalculating')}</em>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <p className="calc-form__hint calc-form__hint--brand">
                {t('calc.sizeCustomBestPriceHint')}
              </p>
              {sizeKey === 'custom' && (
              <div className="calc-custom-dims">
                <div className="calc-weight-slider">
                  <div className="calc-weight-slider__head">
                    <label className="calc-weight-slider__label">{t('calc.weightKg')}</label>
                    <b className="calc-weight-slider__value">
                      {(Number.isFinite(customWeightValue) ? (Math.round(customWeightValue * 10) / 10) : CUSTOM_WEIGHT_MIN_KG).toLocaleString(locale === 'en' ? 'en-US' : 'ru-RU', {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })}{' '}
                      <span>kg</span>
                    </b>
                  </div>
                  <div className="calc-weight-slider__rail">
                    <input
                      type="range"
                      className="calc-weight-slider__range"
                      min={CUSTOM_WEIGHT_MIN_KG}
                      max={MAX_CUSTOM_WEIGHT_KG}
                      step={0.1}
                      value={customWeightValue}
                      aria-label={t('calc.weightKg')}
                      onChange={(e) => {
                        const n = Math.round(Number(e.target.value) * 10) / 10;
                        setSizeKey('custom');
                        setCustomSize(buildCustomSizeFromWeight(n));
                      }}
                      style={{
                        ['--weight-pct' as string]: `${Math.min(
                          100,
                          Math.max(
                            0,
                            ((customWeightValue - CUSTOM_WEIGHT_MIN_KG) / (MAX_CUSTOM_WEIGHT_KG - CUSTOM_WEIGHT_MIN_KG)) * 100,
                          ),
                        )}%`,
                      }}
                    />
                    <div className="calc-weight-slider__ticks" aria-hidden>
                      {CUSTOM_WEIGHT_SCALE.map((m, i) => {
                        const pct = ((m.w - CUSTOM_WEIGHT_MIN_KG) / (MAX_CUSTOM_WEIGHT_KG - CUSTOM_WEIGHT_MIN_KG)) * 100;
                        const label = m.labelKey === 'xs'
                          ? 'XS'
                          : m.labelKey === '2'
                            ? '2'
                            : m.labelKey === 's5'
                              ? 'S · 5'
                              : m.labelKey === 'm10'
                                ? 'M · 10'
                                : m.labelKey === 'l20'
                                  ? 'L · 20'
                                  : t('calc.weightScaleMax', { kg: MAX_CUSTOM_WEIGHT_KG });
                        const edge = i === 0 ? ' calc-weight-slider__tick--start' : i === CUSTOM_WEIGHT_SCALE.length - 1 ? ' calc-weight-slider__tick--end' : '';
                        return (
                          <span
                            key={m.labelKey}
                            className={`calc-weight-slider__tick${edge}`}
                            style={edge ? undefined : { left: `${pct}%` }}
                          >
                            <i />
                            <b>{label}</b>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <p className="calc-weight-slider__hint">{t('calc.weightHint')}</p>
                </div>
                <div className="calc-form__grid">
                  <div className="field-block">
                    <label>{t('calc.lengthCm')}</label>
                    <input
                      type="number"
                      min={NONSTANDARD_LIMITS.minSideCm[0]}
                      max={NONSTANDARD_LIMITS.maxLengthCm}
                      inputMode="decimal"
                      value={customSize.l}
                      onChange={(e) => {
                        setSizeKey('custom');
                        setCustomSize((prev) => ({ ...prev, l: e.target.value }));
                      }}
                    />
                    <small>{t('calc.yourDims')}</small>
                  </div>
                  <div className="field-block">
                    <label>{t('calc.widthCm')}</label>
                    <input
                      type="number"
                      min={NONSTANDARD_LIMITS.minSideCm[0]}
                      max={NONSTANDARD_LIMITS.maxLengthCm}
                      inputMode="decimal"
                      value={customSize.w}
                      onChange={(e) => {
                        setSizeKey('custom');
                        setCustomSize((prev) => ({ ...prev, w: e.target.value }));
                      }}
                    />
                    <small>{t('calc.yourDims')}</small>
                  </div>
                  <div className="field-block">
                    <label>{t('calc.heightCm')}</label>
                    <input
                      type="number"
                      min={NONSTANDARD_LIMITS.minSideCm[0]}
                      max={NONSTANDARD_LIMITS.maxLengthCm}
                      inputMode="decimal"
                      value={customSize.h}
                      onChange={(e) => {
                        setSizeKey('custom');
                        setCustomSize((prev) => ({ ...prev, h: e.target.value }));
                      }}
                    />
                    <small>{t('calc.yourDims')}</small>
                  </div>
                  <div className="field-block">
                    <label>{t('calc.weightKg')}</label>
                    <input
                      type="number"
                      min={CUSTOM_WEIGHT_MIN_KG}
                      max={MAX_CUSTOM_WEIGHT_KG}
                      step={0.1}
                      inputMode="decimal"
                      value={customSize.kg}
                      onChange={(e) => {
                        setSizeKey('custom');
                        setCustomSize((prev) => ({ ...prev, kg: e.target.value }));
                      }}
                    />
                    <small>{t('calc.yourWeight')}</small>
                  </div>
                </div>
                <p className="calc-form__hint">{t('calc.sizeNonstandardNote')}</p>
              </div>
              )}
              <label className="calc-form__check">
                <input type="checkbox" checked={fragile} onChange={(e) => setFragile(e.target.checked)} />
                <span>{t('calc.fragile', { fee: fragileFeeLabel })}</span>
              </label>
              <label className="calc-form__check">
                <input type="checkbox" checked={insurance} onChange={(e) => setInsurance(e.target.checked)} />
                <span>{t('calc.insurance', { percent: insurancePercentLabel, fee: insuranceFeeLabel })}</span>
              </label>
              {showQuoteWait && step === 3 && (
                <p className="calc-form__hint calc-form__hint--inline calc-form__hint--wait" aria-live="polite">
                  <span className="calc-form__wait-dot" aria-hidden />
                  {t('calc.waiting')}
                </p>
              )}
            </>
          )}

          {step === 7 && (
            <>
              <StepHeader step={7} title={stepMeta[7].title} subtitle={stepMeta[7].sub} />
              <div className="calc-form__options calc-form__options--2">
                {contentOptions.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={`calc-form__option${contents === c.key ? ' active' : ''}`}
                    onClick={() => setContents(c.key)}
                  >
                    <span className="calc-form__option-icon">{c.icon}</span>
                    <span>{c.label}</span>
                  </button>
                ))}
              </div>
              {contents === 'other' && (
                <div className="field-block">
                  <label>{t('calc.contentsDescLabel')}</label>
                  <textarea
                    className="calc-form__textarea"
                    value={contentsNote}
                    onChange={(e) => setContentsNote(e.target.value)}
                    placeholder={t('calc.contentsDescPlaceholder')}
                    rows={3}
                  />
                </div>
              )}
            </>
          )}

          {step === 8 && (
            <>
              <StepHeader
                step={8}
                title={isEnvelopeSize(sizeKey) ? t('calc.whoPays') : stepMeta[8].title}
                subtitle={isEnvelopeSize(sizeKey) ? undefined : stepMeta[8].sub}
              />
              {!isEnvelopeSize(sizeKey) && (
                <div className="calc-form__options calc-form__options--2">
                  {valueOptions.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      className={`calc-form__option${contentValue === v.key ? ' active' : ''}`}
                      onClick={() => setContentValue(v.key)}
                    >
                      <span>{v.label}</span>
                    </button>
                  ))}
                </div>
              )}
              {!isEnvelopeSize(sizeKey) && (
                <p className="calc-form__group-label">{t('calc.whoPays')}</p>
              )}
              <div className="calc-form__options calc-form__options--2">
                <button
                  type="button"
                  className={`calc-form__option${payer === 'sender' ? ' active' : ''}`}
                  onClick={() => setPayer('sender')}
                >
                  <span>{t('calc.payerSender')}</span>
                </button>
                <button
                  type="button"
                  className={`calc-form__option${payer === 'receiver' ? ' active' : ''}`}
                  onClick={() => setPayer('receiver')}
                >
                  <span>{t('calc.payerReceiver')}</span>
                </button>
              </div>
            </>
          )}

          {step === 5 && (
            <>
              <StepHeader
                step={5}
                title={stepMeta[5].title}
                subtitle={
                  pickupType === 'locker'
                    ? t('calc.senderSubLocker')
                    : pickupType === 'pudo'
                      ? t('calc.senderSubPudo')
                      : pickupType === 'branch'
                        ? t('calc.senderSubBranch')
                        : t('calc.senderSubHome')
                }
              />
              {quoteRefreshing && (
                <p className="calc-form__hint">{t('calc.refiningPrice')}</p>
              )}
              <div className="calc-form__grid">
                <div className="field-block">
                  <label>{t('calc.senderFirst')}</label>
                  <input
                    name="sender_first_name"
                    autoComplete="given-name"
                    value={senderFirst}
                    onChange={(e) => setSenderFirst(e.target.value)}
                    placeholder={t('calc.senderFirstPlaceholder')}
                  />
                </div>
                <div className="field-block">
                  <label>{t('calc.senderLast')}</label>
                  <input
                    name="sender_last_name"
                    autoComplete="family-name"
                    value={senderLast}
                    onChange={(e) => setSenderLast(e.target.value)}
                    placeholder={t('calc.senderLastPlaceholder')}
                  />
                </div>
              </div>
              <div className="field-block">
                <label>{t('calc.phone')}</label>
                <PhoneDialField
                  dial={senderDial}
                  onDialChange={setSenderDial}
                  phone={senderPhone}
                  onPhoneChange={setSenderPhone}
                  defaultCountry={PICKUP_COUNTRY}
                  autoComplete="tel-national"
                  name="sender_phone"
                />
              </div>
              <div className="field-block">
                <label>{t('calc.email')}</label>
                <input
                  type="email"
                  name="sender_email"
                  autoComplete="email"
                  value={senderEmail}
                  onChange={(e) => setSenderEmail(e.target.value)}
                  placeholder="you@email.com"
                  required
                />
              </div>

              {isLockerLikeMode(pickupType) && (
                <>
                  <AddressSuggest
                    label={t('calc.senderAddress')}
                    value={pickupAddressQuery}
                    onChange={onPickupAddressQueryChange}
                    onSelect={applyPickupAddress}
                    country={PICKUP_COUNTRY}
                    city={pickupCity}
                    placeholder={addressPlaceholder(PICKUP_COUNTRY, pickupCity)}
                    hint={pickupType === 'pudo' ? t('calc.addressHintPudo') : t('calc.addressHintLockers')}
                    name="sender_address_locker"
                    bookAddresses={bookAddresses}
                  />
                  <p className="calc-form__group-label">
                    {pickupType === 'pudo' ? t('calc.pickupPudoLabel') : t('calc.pickupLockersLabel')}
                  </p>
                  {pointsLoading && <p className="calc-form__hint">{t('calc.loadingPoints')}</p>}
                  <LockerPicker
                    lockers={pickupLockersForCity}
                    selected={pickupLocker}
                    onSelect={setPickupLocker}
                    focusPos={pickupAddressFocus}
                  />
                </>
              )}
              {pickupType === 'branch' && (
                <>
                  {pickupNeedsAddressRefinement && (
                    <AddressSuggest
                      label={t('calc.senderAddress')}
                      value={pickupAddressQuery || pickupStreet}
                      onChange={onPickupAddressQueryChange}
                      onSelect={applyPickupAddress}
                      country={PICKUP_COUNTRY}
                      city={pickupCity}
                      placeholder={addressPlaceholder(PICKUP_COUNTRY, pickupCity)}
                      hint={t('calc.addressHintBranches')}
                      name="sender_address_branch"
                      bookAddresses={bookAddresses}
                    />
                  )}
                  {(!pickupNeedsAddressRefinement || pickupAddressReady) ? (
                    <>
                      <p className="calc-form__group-label">{t('calc.pickupBranchesLabel')}</p>
                      <LockerPicker
                        lockers={pickupBranchesForCity}
                        selected={pickupBranch}
                        onSelect={setPickupBranch}
                        focusPos={pickupAddressFocus}
                      />
                    </>
                  ) : (
                    <p className="calc-form__hint">{t('calc.afterAddressBranches')}</p>
                  )}
                </>
              )}
              {pickupType === 'home' && (
                <>
                  <AddressSuggest
                    label={t('calc.senderAddress')}
                    value={pickupAddressQuery || pickupStreet}
                    onChange={onPickupAddressQueryChange}
                    onSelect={applyPickupAddress}
                    country={PICKUP_COUNTRY}
                    city={pickupCity}
                    placeholder={addressPlaceholder(PICKUP_COUNTRY, pickupCity)}
                    hint={t('calc.addressHint')}
                    name="sender_address"
                    bookAddresses={bookAddresses}
                  />
                  <div className="calc-form__grid">
                    <div className="field-block">
                      <label>{t('calc.city')}</label>
                      <input
                        name="sender_city"
                        autoComplete="address-level2"
                        value={pickupCity}
                        onChange={(e) => setPickupCity(e.target.value)}
                      />
                    </div>
                    <div className="field-block">
                      <label>{t('calc.postal')}</label>
                      <input
                        name="sender_postal"
                        autoComplete="postal-code"
                        value={pickupPostal}
                        onChange={(e) => setPickupPostal(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="calc-form__grid">
                    <div className="field-block">
                      <label>{t('calc.pickupDate')}</label>
                      <input
                        type="date"
                        value={pickupDate}
                        min={nextCourierPickupDateIso()}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const next = coerceCourierPickupDate(raw);
                          setPickupDate(next);
                        }}
                        onBlur={() => setPickupDate((prev) => coerceCourierPickupDate(prev))}
                      />
                      <p className="calc-form__hint calc-form__hint--inline">{t('calc.pickupWeekdaysHint')}</p>
                      <p className="calc-form__hint calc-form__hint--inline">{t('calc.pickupWithinDayHint')}</p>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {step === 6 && (
            <>
              <StepHeader
                step={6}
                title={stepMeta[6].title}
                subtitle={
                  deliveryType === 'locker'
                    ? t('calc.receiverSubLocker')
                    : deliveryType === 'pudo'
                      ? t('calc.receiverSubPudo')
                      : deliveryType === 'branch'
                        ? t('calc.receiverSubBranch')
                        : t('calc.receiverSubHome')
                }
              />
              {quoteRefreshing && (
                <p className="calc-form__hint">{t('calc.refiningPrice')}</p>
              )}
              <div className="calc-form__grid">
                <div className="field-block">
                  <label>{t('calc.receiverFirst')}</label>
                  <input
                    name="receiver_first_name"
                    autoComplete="shipping given-name"
                    value={receiverFirst}
                    onChange={(e) => setReceiverFirst(e.target.value)}
                  />
                </div>
                <div className="field-block">
                  <label>{t('calc.receiverLast')}</label>
                  <input
                    name="receiver_last_name"
                    autoComplete="shipping family-name"
                    value={receiverLast}
                    onChange={(e) => setReceiverLast(e.target.value)}
                  />
                </div>
              </div>
              <div className="field-block">
                <label>{t('calc.phone')}</label>
                <PhoneDialField
                  dial={receiverDial}
                  onDialChange={setReceiverDial}
                  phone={receiverPhone}
                  onPhoneChange={setReceiverPhone}
                  defaultCountry={toCountry}
                  lockedCountry={toCountry === 'FR' ? 'FR' : undefined}
                  autoComplete="shipping tel-national"
                  name="receiver_phone"
                />
              </div>
              <div className="field-block">
                <label>{t('calc.email')}</label>
                <input
                  type="email"
                  name="receiver_email"
                  autoComplete="shipping email"
                  value={receiverEmail}
                  onChange={(e) => setReceiverEmail(e.target.value)}
                  placeholder="recipient@email.com"
                  required
                />
              </div>

              {isLockerLikeMode(deliveryType) && (
                <>
                  <AddressSuggest
                    label={t('calc.receiverAddress')}
                    value={destAddressQuery}
                    onChange={onDestAddressQueryChange}
                    onSelect={applyDestAddress}
                    country={toCountry}
                    city={destCity}
                    placeholder={addressPlaceholder(toCountry, destCity)}
                    hint={deliveryType === 'pudo' ? t('calc.addressHintPudo') : t('calc.addressHintLockers')}
                    name="receiver_address"
                    bookAddresses={bookAddresses}
                  />
                  <p className="calc-form__group-label">
                    {deliveryType === 'pudo' ? t('calc.pickupPudoLabel') : t('calc.pickupLockersLabel')}
                  </p>
                  {pointsLoading && <p className="calc-form__hint">{t('calc.loadingPoints')}</p>}
                  <LockerPicker
                    lockers={destLockersForCity}
                    selected={destLocker}
                    onSelect={setDestLocker}
                    focusPos={destAddressFocus}
                  />
                </>
              )}
              {deliveryType === 'branch' && (
                <>
                  <AddressSuggest
                    label={t('calc.receiverAddress')}
                    value={destAddressQuery}
                    onChange={onDestAddressQueryChange}
                    onSelect={applyDestAddress}
                    country={toCountry}
                    city={destCity}
                    placeholder={addressPlaceholder(toCountry, destCity)}
                    hint={t('calc.addressHintBranches')}
                    name="receiver_address_branch"
                    bookAddresses={bookAddresses}
                  />
                  <p className="calc-form__group-label">{t('calc.pickupBranchesLabel')}</p>
                  {pointsLoading && <p className="calc-form__hint">{t('calc.loadingPoints')}</p>}
                  <LockerPicker
                    lockers={destBranchesForCity}
                    selected={destBranch}
                    onSelect={setDestBranch}
                    focusPos={destAddressFocus}
                  />
                </>
              )}
              {deliveryType === 'home' && (
                <>
                  <AddressSuggest
                    label={t('calc.deliveryAddress')}
                    value={destAddressQuery || destStreet}
                    onChange={(v) => {
                      onDestAddressQueryChange(v);
                      setDestStreet(v);
                    }}
                    onSelect={applyDestAddress}
                    country={toCountry}
                    city={destCity}
                    placeholder={addressPlaceholder(toCountry, destCity)}
                    name="receiver_street"
                    bookAddresses={bookAddresses}
                  />
                  <div className="calc-form__grid">
                    <div className="field-block">
                      <label>{t('calc.city')}</label>
                      <input
                        name="receiver_city"
                        autoComplete="shipping address-level2"
                        value={destCity}
                        onChange={(e) => setDestCity(e.target.value)}
                      />
                    </div>
                    <div className="field-block">
                      <label>{t('calc.postal')}</label>
                      <input
                        name="receiver_postal"
                        autoComplete="shipping postal-code"
                        value={destPostal}
                        onChange={(e) => setDestPostal(e.target.value)}
                      />
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {step === 9 && (
            <>
              <StepHeader step={9} title={stepMeta[9].title} subtitle={stepMeta[9].sub} />
              <div className="calc-form__confirm">
                <div className="calc-form__confirm-row">
                  <span>{t('calc.confirmRoute')}</span>
                  <b className="calc-form__confirm-route">
                    <CountryFlag code={PICKUP_COUNTRY} size={18} />
                    {countryLabel(PICKUP_COUNTRY, locale)}
                    <span>→</span>
                    <CountryFlag code={toCountry} size={18} />
                    {countryLabel(toCountry, locale)}
                  </b>
                </div>
                <div className="calc-form__confirm-row">
                  <span>{t('calc.summaryCities')}</span>
                  <b>{cityLabelForValue(PICKUP_COUNTRY, pickupCity, locale) || '—'} → {cityLabelForValue(toCountry, destCity, locale) || '—'}</b>
                </div>
                <div className="calc-form__confirm-row">
                  <span>{t('calc.confirmSize')}</span>
                  <b>{sizeLabel} · {totalPrice != null ? formatMoney(totalPrice) : '—'}</b>
                </div>
                <div className="calc-form__confirm-row">
                  <span>{t('calc.confirmContents')}</span>
                  <b>{contentLabel(contents, contentsNote)}</b>
                </div>
                <div className="calc-form__confirm-row">
                  <span>{t('calc.confirmPayment')}</span>
                  <b>{payer === 'sender' ? t('calc.payerSender') : t('calc.payerReceiver')}</b>
                </div>
              </div>

              <div className="calc-form__promo">
                {!promoOpen && !promoCode ? (
                  <button
                    type="button"
                    className="calc-form__promo-toggle"
                    onClick={() => setPromoOpen(true)}
                  >
                    {t('calc.promoAsk')}
                  </button>
                ) : (
                  <div className="calc-form__promo-box">
                    <label className="calc-form__promo-label" htmlFor="calc-promo-input">
                      {t('calc.promoLabel')}
                    </label>
                    <div className="calc-form__promo-row">
                      <input
                        id="calc-promo-input"
                        className="calc-form__promo-input"
                        value={promoInput}
                        placeholder={t('calc.promoPlaceholder')}
                        autoCapitalize="characters"
                        autoCorrect="off"
                        spellCheck={false}
                        disabled={promoApplying}
                        onChange={(e) => {
                          setPromoInput(e.target.value.toUpperCase());
                          setPromoError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void applyPromo();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-lime calc-form__promo-apply"
                        disabled={promoApplying || !promoInput.trim()}
                        onClick={() => void applyPromo()}
                      >
                        {promoApplying ? t('calc.promoApplying') : t('calc.promoApply')}
                      </button>
                    </div>
                    {promoCode && promoHint && (
                      <p className="calc-form__promo-ok">
                        {promoHint}
                        {' · '}
                        <button type="button" className="text-link" onClick={() => { clearPromo(); setPromoInput(''); setPromoOpen(false); }}>
                          {t('calc.promoClear')}
                        </button>
                      </p>
                    )}
                    {promoError && <p className="calc-form__promo-err">{promoError}</p>}
                  </div>
                )}
              </div>

              <label className="calc-form__check calc-form__terms">
                <input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} />
                <span>{t('calc.terms')}</span>
              </label>
            </>
          )}
    </>
  );

  return (
    <div className={`calc-form${showSummary ? ' calc-form--with-summary calc-form--summary-bottom' : ''}${inModal ? ' calc-form--in-modal' : ''}`}>
      {error && (
        <div className="calc-form__error" role="alert">
          {error.split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
      {quoteWarning && !error && <p className="calc-form__hint">{quoteWarning}</p>}

      <div className={`calc-form__layout${inModal ? ' calc-form__layout--modal' : ''}`}>
        <div className="calc-form__main">
          <div className="calc-form__step-body">
            {stepContent}
          </div>
          {!navAfterLayout && nav()}
        </div>

        {summaryEl}
      </div>
      {navAfterLayout && nav()}
    </div>
  );
}

type ModalProps = {
  open: boolean;
  onClose: () => void;
  user?: AuthUser | null;
  onSuccess?: (order: ShippingOrder) => void;
  onAwaitingRecipientPayment?: (info: {
    orderNumber: string;
    publicToken: string;
    recipientEmail: string;
    amount: number;
    currency: string;
  }) => void;
  /** Bump to remount form with latest draft (e.g. continue unfinished shipment). */
  resumeKey?: number;
  /** When true, open on the last saved draft step instead of step 1. */
  draftResume?: boolean;
};

export function ShipmentCalculator({
  open,
  onClose,
  user,
  onSuccess,
  onAwaitingRecipientPayment,
  resumeKey = 0,
  draftResume = false,
}: ModalProps) {
  const { t } = useI18n();
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (!resumeKey) return;
    setFormKey(resumeKey);
  }, [resumeKey]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="ship-calc-overlay" role="dialog" aria-modal="true" aria-labelledby="ship-calc-title">
      <button type="button" className="ship-calc-overlay__backdrop" onClick={onClose} aria-label={t('calc.close')} />
      <aside className="calc-card card calc-card--modal">
        <div className="calc-card__head">
          <div>
            <p className="calc-card__eyebrow">{t('calc.modalEyebrow')}</p>
            <h2 id="ship-calc-title">{t('calc.modalTitle')}</h2>
          </div>
          <button type="button" className="calc-card__close" onClick={onClose} aria-label={t('calc.close')}>×</button>
        </div>
        <div className="calc-card__modal-body">
          <CalcForm
            key={formKey}
            inModal
            user={user}
            startFromStep1={!draftResume}
            onSuccess={onSuccess}
            onAwaitingRecipientPayment={onAwaitingRecipientPayment}
            onDone={() => { setFormKey((k) => k + 1); onClose(); }}
          />
        </div>
        <div className="calc-meta calc-meta--modal">
          <span>{t('calc.metaFast')}</span>
          <span>{t('calc.metaClear')}</span>
          <span>{t('calc.metaReliable')}</span>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

export function TrackShipment() {
  const { t, locale } = useI18n();
  const [ttn, setTtn] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<ShippingOrder | null>(null);

  const handleTrack = async () => {
    if (!ttn.trim()) return;
    setLoading(true);
    setError(null);
    setOrder(null);
    try {
      setOrder(await trackByTtn(ttn.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('calc.notFound'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ship-track">
      <div className="field-block">
        <label>{t('calc.trackLabel')}</label>
        <input value={ttn} onChange={(e) => setTtn(e.target.value)} placeholder={t('calc.trackPlaceholder')} onKeyDown={(e) => e.key === 'Enter' && handleTrack()} />
      </div>
      {error && <p className="calc-form__error-inline">{error}</p>}
      {order && (
        <div className="ship-track__result">
          <TrackingMap
            fromCountry={order.fromCountry}
            toCountry={order.toCountry}
            fromLine={order.senderLine}
            toLine={order.receiverLine}
            active={order.status === 'submitted' || order.status === 'delivered'}
          />
          <b>{order.orderNumber}</b>
          <span>{countryLabel(order.fromCountry || 'HU', locale)} → {countryLabel(order.toCountry || '', locale)}</span>
          <span>{t('calc.statusLabel')}: {
            order.status === 'submitted' ? t('calc.statusSubmitted')
            : order.status === 'delivered' ? t('dash.statusDelivered')
            : order.status === 'waiting_from_you' ? t('dash.statusWaitingFromYou')
            : order.status === 'paid' ? t('calc.statusPaid')
            : order.status === 'pending_payment' ? t('dash.statusPending')
            : order.status === 'cancelled' ? t('dash.statusCancelled')
            : order.status
          }</span>
          {order.npTtn && <span>{t('calc.ttnLabel')}: {order.npTtn}</span>}
          {Array.isArray(order.tracking) && order.tracking.length > 0 && (
            <ul className="client-dash__timeline ship-track__timeline">
              {order.tracking.map((ev) => (
                <li key={ev.id} className={`client-dash__timeline-item${ev.done ? ' done' : ''}${ev.current ? ' current' : ''}`}>
                  <span className="client-dash__timeline-dot" />
                  <div>
                    <b>{trackingEventLabel(ev, t)}</b>
                    {ev.place && <span className="client-dash__timeline-place">{ev.place}</span>}
                    {ev.at && (
                      <small>
                        {new Date(ev.at).toLocaleString(localeToIntl(locale), {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </small>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <button className="btn btn-lime calc-submit" type="button" disabled={loading} onClick={handleTrack}>
        {loading ? t('calc.trackSearching') : t('calc.trackBtn')}
      </button>
    </div>
  );
}

export async function resumePaymentFromUrl(token: string) {
  const status = await fetchOrderStatus(token);
  // Paid without a real NP TTN means create-shipment failed after Stripe — retry NP.
  if (['submitted', 'waiting_from_you', 'delivered'].includes(status.status)) return status;
  if (status.status === 'paid' && status.npTtn && status.npValid !== false) return status;
  return confirmPayment(token);
}
