import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AuthUser } from '../api/auth';
import {
  calculateBatch,
  calculateFinal,
  checkout,
  confirmPayment,
  computeClientExtras,
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
  type ShippingOrder,
  type ShippingPoint,
} from '../api/shipping';
import {
  DIAL_BY_CC,
  DEFAULT_QUOTE_CURRENCY,
  PARCEL_PRESETS,
  PICKUP_COUNTRY,
  PICKUP_TIMES,
  formatQuoteMoney,
  composePhone,
  validateEmail,
  validatePersonName,
  validatePhone,
  estimateParcelPrice,
  type ParcelKey,
  countryLabel,
  countryFlag,
  countryCodeFromDial,
} from '../constants/shipping';
import { TrackingMap } from './client-dash/TrackingMap';
import {
  DEST_BRANCHES,
  DEST_LOCKERS,
  LockerPicker,
  PICKUP_BRANCHES,
  PICKUP_LOCKERS,
  detectCityByGeolocation,
  filterPointsByCity,
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
import { loadCalcDraft, clearCalcDraft } from './calc/calcDraft';
import { CalcDraftHints, type DraftHintItem } from './calc/CalcDraftHints';
import { useCalcDraftPersistence } from './calc/useCalcDraft';
import { useI18n } from '../i18n/context';
import { localizeApiError } from '../i18n/localizeApiError';

type FormProps = {
  user?: AuthUser | null;
  initialTo?: string;
  onSuccess?: (order: ShippingOrder) => void;
  onDone?: () => void;
  inModal?: boolean;
  onStepChange?: (step: number) => void;
  /** Increment to force calculator back to step 1 (e.g. backdrop dismiss). */
  resetToStep1Signal?: number;
  /** Start from step 1 but still load saved field values for hints. */
  startFromStep1?: boolean;
};

type DeliveryMode = 'home' | 'branch' | 'locker';
type ContentKey = 'documents' | 'clothing' | 'shoes' | 'cosmetics' | 'electronics' | 'gift' | 'other';
type ValueKey = 'under100' | 'mid' | 'high' | 'over';
type SizeKey = 'envelope' | ParcelKey | 'custom';

const PARCEL_KEYS: ParcelKey[] = ['S', 'M', 'L', 'XL', 'XXL'];
/** Sizes shown on step 3 — only these need live NP quotes there. */
const STEP3_QUOTE_KEYS: ParcelKey[] = ['S', 'M', 'L'];
const STEP_SUMMARY_KEYS: Record<number, string[]> = {
  1: ['from'],
  2: ['from', 'cities'],
  3: ['from', 'cities', 'type'],
  4: ['from', 'cities', 'type', 'size'],
  5: ['from', 'cities', 'type', 'size', 'contents'],
  6: ['from', 'cities', 'type', 'size', 'contents', 'value', 'pays'],
  7: ['from', 'cities', 'type', 'size', 'contents', 'value', 'pays', 'sender', 'when'],
  8: ['from', 'cities', 'type', 'size', 'contents', 'value', 'pays', 'sender', 'recipient', 'when'],
  9: ['from', 'cities', 'type', 'size', 'contents', 'value', 'pays', 'sender', 'recipient', 'when'],
};

const TOTAL_STEPS = 9;

const ENVELOPE_PRESET = { lengthCm: 35, widthCm: 25, heightCm: 2, weightKg: 0.5 };

const SIZE_OPTION_KEYS: SizeKey[] = ['envelope', 'S', 'M', 'L', 'custom'];
const CONTENT_KEYS: ContentKey[] = ['documents', 'clothing', 'shoes', 'cosmetics', 'electronics', 'gift', 'other'];
const VALUE_KEYS: ValueKey[] = ['under100', 'mid', 'high', 'over'];
const DELIVERY_MODE_KEYS: DeliveryMode[] = ['home', 'branch', 'locker'];

const CONTENT_ICONS: Record<ContentKey, string> = {
  documents: '📄',
  clothing: '👕',
  shoes: '👟',
  cosmetics: '💄',
  electronics: '📱',
  gift: '🎁',
  other: '📦',
};

const DELIVERY_MODE_ICONS: Record<DeliveryMode, string> = {
  home: '🏠',
  branch: '🏢',
  locker: '📦',
};

const MODE_ORDER: DeliveryMode[] = ['locker', 'branch', 'home'];

function firstAvailableMode(side: CoverageSide | null | undefined, preferred?: DeliveryMode): DeliveryMode {
  if (preferred && side?.[preferred]?.available) return preferred;
  for (const key of MODE_ORDER) {
    if (side?.[key]?.available) return key;
  }
  return 'home';
}

const VALUE_TO_EUR: Record<ValueKey, number> = {
  under100: 80,
  mid: 300,
  high: 750,
  over: 1500,
};

function tomorrowIso() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Nova Post tier limits — keep in sync with server/novapost/parcel.mjs */
const PARCEL_LIMITS: Record<ParcelKey, { maxLongestCm: number; maxGirthCm: number; maxWeightKg: number }> = {
  S: { maxLongestCm: 64, maxGirthCm: 200, maxWeightKg: 5 },
  M: { maxLongestCm: 64, maxGirthCm: 220, maxWeightKg: 10 },
  L: { maxLongestCm: 64, maxGirthCm: 240, maxWeightKg: 20 },
  XL: { maxLongestCm: 150, maxGirthCm: 300, maxWeightKg: 30 },
  XXL: { maxLongestCm: 250, maxGirthCm: 400, maxWeightKg: 100 },
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

/** Map UI size to API boxSize. Custom uses dims+weight — never default to S when custom is missing. */
function sizeToApiKey(
  sizeKey: SizeKey,
  custom?: { l: string; w: string; h: string; kg: string },
): ParcelKey {
  if (sizeKey === 'envelope') return 'S';
  if (sizeKey === 'custom') {
    const lengthCm = Math.max(1, Number(custom?.l) || 30);
    const widthCm = Math.max(1, Number(custom?.w) || 20);
    const heightCm = Math.max(1, Number(custom?.h) || 15);
    const weightKg = Math.max(0.1, Number(custom?.kg) || 2);
    for (const tier of ['S', 'M', 'L', 'XL', 'XXL'] as ParcelKey[]) {
      if (fitsParcelTier(lengthCm, widthCm, heightCm, weightKg, tier)) return tier;
    }
    return 'XXL';
  }
  return sizeKey;
}

function deliveryModeToApi(mode: DeliveryMode): 'locker' | 'branch' | 'address' {
  if (mode === 'home') return 'address';
  return mode;
}

function sizeToPreset(sizeKey: SizeKey, custom: { l: string; w: string; h: string; kg: string }) {
  if (sizeKey === 'envelope') return ENVELOPE_PRESET;
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
  hints,
}: {
  options: Array<{ key: T; label: string; icon?: string }>;
  value: T;
  onChange: (v: T) => void;
  columns?: 2 | 3;
  disabledKeys?: Partial<Record<T, boolean>>;
  hints?: Partial<Record<T, string | undefined>>;
}) {
  const { t } = useI18n();
  return (
    <div className={`calc-form__options calc-form__options--${columns}`}>
      {options.map((opt) => {
        const disabled = Boolean(disabledKeys?.[opt.key]);
        const hint = hints?.[opt.key];
        return (
          <button
            key={opt.key}
            type="button"
            className={`calc-form__option${value === opt.key ? ' active' : ''}${disabled ? ' is-disabled' : ''}`}
            onClick={() => { if (!disabled) onChange(opt.key); }}
            disabled={disabled}
            title={disabled ? (hint || t('calc.unavailableInCity')) : undefined}
            aria-disabled={disabled}
          >
            {opt.icon && <span className="calc-form__option-icon">{opt.icon}</span>}
            <span>{opt.label}</span>
            {disabled && <small className="calc-form__option-note">{t('calc.unavailable')}</small>}
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
  const restoredHintsRef = useRef({
    pickupCity: saved?.pickupCity ?? '',
    pickupAddress: saved?.pickupAddressQuery || saved?.pickupStreet || '',
    destCity: saved?.destCity ?? '',
    destAddress: saved?.destAddressQuery || saved?.destStreet || '',
  });

  const [step, setStep] = useState(startFromStep1 ? 1 : (saved?.step ?? 1));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quoteWarning, setQuoteWarning] = useState<string | null>(null);

  const [toCountry, setToCountry] = useState(saved?.toCountry ?? initialTo);
  const [pickupType, setPickupType] = useState<DeliveryMode>(saved?.pickupType ?? 'locker');
  const [deliveryType, setDeliveryType] = useState<DeliveryMode>(saved?.deliveryType ?? 'locker');
  const [coverage, setCoverage] = useState<{ pickup: CoverageSide; delivery: CoverageSide } | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [livePickupLockers, setLivePickupLockers] = useState<ShippingPoint[] | null>(null);
  const [liveDestLockers, setLiveDestLockers] = useState<ShippingPoint[] | null>(null);
  const [pointsLoading, setPointsLoading] = useState(false);

  const [sizeKey, setSizeKey] = useState<SizeKey>(saved?.sizeKey ?? 'M');
  const [customSize, setCustomSize] = useState(saved?.customSize ?? { l: '30', w: '20', h: '15', kg: '2' });
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
  const [pickupDate, setPickupDate] = useState(saved?.pickupDate || tomorrowIso());
  const [pickupTime, setPickupTime] = useState(saved?.pickupTime ?? PICKUP_TIMES[0]);
  const [pickupLocker, setPickupLocker] = useState(saved?.pickupLocker ?? PICKUP_LOCKERS[0].id);
  const [pickupBranch, setPickupBranch] = useState(saved?.pickupBranch ?? PICKUP_BRANCHES[0].id);
  const [destLocker, setDestLocker] = useState(saved?.destLocker ?? DEST_LOCKERS[0].id);
  const [destBranch, setDestBranch] = useState(saved?.destBranch ?? DEST_BRANCHES[0].id);

  const [fragile, setFragile] = useState(saved?.fragile ?? false);
  const [insurance, setInsurance] = useState(saved?.insurance ?? false);
  const [quoteSettings, setQuoteSettings] = useState<QuoteSettings | null>(null);

  const [senderName, setSenderName] = useState(saved?.senderName || user?.name || '');
  const [senderEmail, setSenderEmail] = useState(saved?.senderEmail || user?.email || '');
  const [senderDial, setSenderDial] = useState(saved?.senderDial ?? (DIAL_BY_CC[PICKUP_COUNTRY] || '+36'));
  const [senderPhone, setSenderPhone] = useState(saved?.senderPhone || user?.phone?.replace(/^\+\d+\s*/, '') || '');
  const [receiverFirst, setReceiverFirst] = useState(saved?.receiverFirst ?? '');
  const [receiverLast, setReceiverLast] = useState(saved?.receiverLast ?? '');
  const [receiverDial, setReceiverDial] = useState(saved?.receiverDial ?? (DIAL_BY_CC[saved?.toCountry ?? initialTo] || '+49'));
  const [receiverPhone, setReceiverPhone] = useState(saved?.receiverPhone ?? '');

  const [termsAccepted, setTermsAccepted] = useState(saved?.termsAccepted ?? false);
  const [parcelQuotes, setParcelQuotes] = useState<Partial<Record<ParcelKey, number>>>({});
  const [quoteRefreshing, setQuoteRefreshing] = useState(false);
  const [welcomeDiscountPercent, setWelcomeDiscountPercent] = useState<number | null>(null);
  const [showQuoteWait, setShowQuoteWait] = useState(false);
  const [quotesFromNp, setQuotesFromNp] = useState(false);
  const [currency, setCurrency] = useState(DEFAULT_QUOTE_CURRENCY);
  const [bookAddresses, setBookAddresses] = useState<AddressEntry[]>([]);

  useEffect(() => {
    const h = restoredHintsRef.current;
    if (pickupCity.trim()) h.pickupCity = pickupCity.trim();
    if (destCity.trim()) h.destCity = destCity.trim();
    const pickupAddr = (pickupAddressQuery || pickupStreet).trim();
    if (pickupAddr) h.pickupAddress = pickupAddr;
    const destAddr = (destAddressQuery || destStreet).trim();
    if (destAddr) h.destAddress = destAddr;
  }, [pickupCity, destCity, pickupAddressQuery, pickupStreet, destAddressQuery, destStreet]);

  const quoteDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  useEffect(() => {
    onStepChange?.(step);
  }, []);

  const prevResetSignal = useRef(resetToStep1Signal);
  useEffect(() => {
    if (resetToStep1Signal == null) return;
    if (prevResetSignal.current === resetToStep1Signal) return;
    prevResetSignal.current = resetToStep1Signal;
    skipDraftFlushRef.current = true;
    setStep(1);
    onStepChange?.(1);
    setError(null);
  }, [resetToStep1Signal, onStepChange]);

  useEffect(() => {
    if (initialRef.current?.restored) return;
    setToCountry(initialTo);
    setReceiverDial(DIAL_BY_CC[initialTo] || '+49');
  }, [initialTo]);

  const skipInitialDestCitySync = useRef(Boolean(saved?.destCity?.trim()));

  useEffect(() => {
    const cities = citiesForCountry(toCountry);
    if (!cities.length) return;
    const destOk = destCity.trim() && cities.some((c) => c.toLowerCase() === destCity.trim().toLowerCase());
    if (skipInitialDestCitySync.current) {
      skipInitialDestCitySync.current = false;
      if (destOk) return;
    }
    if (!destOk) {
      setDestCity(defaultCityValueForCountry(toCountry));
    }
  }, [toCountry, destCity]);

  useEffect(() => {
    if (!user) return;
    if (initialRef.current?.restored && saved?.senderEmail) return;
    setSenderName(user.name);
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
    senderName,
    senderEmail,
    senderDial,
    senderPhone,
    receiverFirst,
    receiverLast,
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
    senderName,
    senderEmail,
    senderDial,
    senderPhone,
    receiverFirst,
    receiverLast,
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
  }, [resetPickupAddressRefinement]);

  const apiParcelKey = sizeToApiKey(sizeKey, customSize);
  const declaredValue = VALUE_TO_EUR[contentValue];
  const quoteDeliveryMode = deliveryModeToApi(deliveryType);

  const routeCacheKey = `${PICKUP_COUNTRY}:${toCountry}:${declaredValue}:${quoteDeliveryMode}`;

  const applyCachedRouteQuotes = useCallback(() => {
    const cached = routeQuoteCache.current.get(routeCacheKey);
    if (!cached) return false;
    setParcelQuotes((prev) => ({ ...prev, ...cached.quotes }));
    setCurrency(cached.currency);
    setQuotesFromNp(true);
    return true;
  }, [routeCacheKey]);

  const applyEstimateFallback = useCallback((keys: ParcelKey[] = STEP3_QUOTE_KEYS) => {
    setParcelQuotes((prev) => {
      const next = { ...prev };
      for (const key of keys) {
        if (next[key] == null) {
          next[key] = estimateParcelPrice(PARCEL_PRESETS[key]);
        }
      }
      return next;
    });
  }, []);

  const fetchQuoteKeys = useCallback(async (
    keys: ParcelKey[],
    sizeOverrides?: Array<{ boxSize: string; lengthCm: number; widthCm: number; heightCm: number; weightKg: number }>,
  ) => {
    if (!keys.length) return;
    quoteInFlight.current = true;
    const reqId = ++quoteRequestId.current;
    setQuoteRefreshing(true);
    try {
      const sizes = sizeOverrides ?? keys.map((key) => ({ boxSize: key, ...PARCEL_PRESETS[key] }));
      const data = await calculateBatch({
        fromCountry: PICKUP_COUNTRY,
        toCountry,
        declaredValue,
        deliveryMode: quoteDeliveryMode,
        sizes,
      });
      if (reqId !== quoteRequestId.current) return;

      const code = (data.currency?.code || DEFAULT_QUOTE_CURRENCY).toUpperCase();
      setCurrency(code);

      const updates: Partial<Record<ParcelKey, number>> = {};
      for (const key of keys) {
        const q = data.quotes[key];
        const base = typeof q === 'number' ? q : (q?.total ?? null);
        if (base != null) updates[key] = base;
      }

      if (Object.keys(updates).length) {
        setParcelQuotes((prev) => {
          const merged = { ...prev, ...updates };
          if (keys.every((k) => STEP3_QUOTE_KEYS.includes(k))) {
            routeQuoteCache.current.set(routeCacheKey, { quotes: merged, currency: code });
          }
          return merged;
        });
        setQuotesFromNp(data.priceSource === 'novapost' || data.priceSource === 'mate-matrix');
      }

      if (data.priceSource === 'estimate' || data.priceSource === 'mock') {
        setQuoteWarning(t('calc.quoteEst'));
      } else {
        setQuoteWarning(null);
      }
    } catch {
      if (reqId !== quoteRequestId.current) return;
      applyEstimateFallback(keys);
      setQuoteWarning(t('calc.quoteEst'));
    } finally {
      quoteInFlight.current = false;
      if (reqId === quoteRequestId.current) setQuoteRefreshing(false);
    }
  }, [toCountry, declaredValue, routeCacheKey, quoteDeliveryMode, applyEstimateFallback, t]);

  useEffect(() => {
    if (step < 3 || step >= 7) return;

    // Prefer cache / API — do not flash crude EUR×HUF estimates (e.g. 13 200 → 8 610).
    if (applyCachedRouteQuotes()) return;

    if (quoteDebounce.current) clearTimeout(quoteDebounce.current);
    if (step <= 3) {
      quoteDebounce.current = setTimeout(() => { void fetchQuoteKeys(STEP3_QUOTE_KEYS); }, step === 3 ? 80 : 120);
    } else {
      const preset = sizeToPreset(sizeKey, customSize);
      quoteDebounce.current = setTimeout(() => {
        void fetchQuoteKeys([apiParcelKey], [{ boxSize: apiParcelKey, ...preset }]);
      }, 120);
    }

    return () => {
      if (quoteDebounce.current) clearTimeout(quoteDebounce.current);
    };
  }, [
    step, toCountry, declaredValue, apiParcelKey, sizeKey, quoteDeliveryMode,
    customSize.l, customSize.w, customSize.h, customSize.kg,
    fragile, insurance,
    applyCachedRouteQuotes, fetchQuoteKeys,
  ]);

  // Steps 7–8: reconcile matrix net vs Nova Post, then VAT (final price before extras)
  useEffect(() => {
    if (step !== 7 && step !== 8) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      const preset = sizeToPreset(sizeKey, customSize);
      setQuoteRefreshing(true);
      setQuoteWarning(null);
      try {
        const data = await calculateFinal({
          fromCountry: PICKUP_COUNTRY,
          toCountry,
          declaredValue,
          deliveryMode: quoteDeliveryMode,
          parcel: { boxSize: apiParcelKey, ...preset },
        });
        if (cancelled) return;
        setCurrency((data.currency || DEFAULT_QUOTE_CURRENCY).toUpperCase());
        setParcelQuotes((prev) => ({ ...prev, [apiParcelKey]: data.total }));
        setWelcomeDiscountPercent(data.breakdown?.welcomeDiscountPercent ?? null);
        setQuotesFromNp(true);
      } catch {
        if (cancelled) return;
        setQuoteWarning(t('calc.quoteNpFail'));
        await fetchQuoteKeys([apiParcelKey], [{ boxSize: apiParcelKey, ...preset }]);
      } finally {
        if (!cancelled) setQuoteRefreshing(false);
      }
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    step, toCountry, declaredValue, apiParcelKey, sizeKey, quoteDeliveryMode,
    customSize.l, customSize.w, customSize.h, customSize.kg,
    fetchQuoteKeys,
    t,
  ]);

  useEffect(() => {
    if (prevRouteKey.current && prevRouteKey.current !== routeCacheKey) {
      routeQuoteCache.current.delete(prevRouteKey.current);
      setQuotesFromNp(false);
      // Drop previous route/mode prices so the summary doesn't briefly show a stale total.
      setParcelQuotes({});
    }
    prevRouteKey.current = routeCacheKey;
  }, [routeCacheKey]);

  const basePrice = parcelQuotes[apiParcelKey] ?? null;

  const extras = useMemo(() => {
    if (basePrice == null || !quoteSettings) {
      return { base: basePrice ?? 0, fragileFee: 0, insuranceFee: 0, insurancePercent: 1, total: basePrice };
    }
    return computeClientExtras(basePrice, { fragile, insurance }, quoteSettings);
  }, [basePrice, fragile, insurance, quoteSettings]);

  const totalPrice = extras.total;
  const formatMoney = (n: number) => formatQuoteMoney(n, currency);
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
    if (livePickupLockers) return livePickupLockers as typeof PICKUP_LOCKERS;
    return filterPointsByCity(PICKUP_LOCKERS, pickupCity, PICKUP_COUNTRY);
  }, [livePickupLockers, pickupCity]);
  const pickupBranchesForCity = useMemo(
    () => filterPointsByCity(PICKUP_BRANCHES, pickupCity, PICKUP_COUNTRY),
    [pickupCity],
  );
  const destLockersForCity = useMemo(() => {
    if (liveDestLockers) return liveDestLockers as typeof DEST_LOCKERS;
    return filterPointsByCity(DEST_LOCKERS, destCity, toCountry);
  }, [liveDestLockers, destCity, toCountry]);
  const destBranchesForCity = useMemo(
    () => filterPointsByCity(DEST_BRANCHES, destCity, toCountry),
    [destCity, toCountry],
  );

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
      setPickupType((prev) => firstAvailableMode(data.pickup, prev));
      setDeliveryType((prev) => firstAvailableMode(data.delivery, prev));
      return data;
    } catch (e) {
      setCoverageError(e instanceof Error ? e.message : t('calc.coverageCheckFail'));
      setCoverage(null);
      return null;
    } finally {
      setCoverageLoading(false);
    }
  }, [pickupCity, destCity, toCountry]);

  // Reset live points when cities change
  useEffect(() => {
    setLivePickupLockers(null);
    setCoverage(null);
  }, [pickupCity]);

  useEffect(() => {
    setLiveDestLockers(null);
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
    setDestAddressQuery(suggestion.label);
    setDestAddressFocus({ lat: suggestion.lat, lng: suggestion.lng });
    setDestAddressReady(true);
    const canonical = canonicalCityValue(toCountry, suggestion.city);
    if (canonical) setDestCity(canonical);
    if (suggestion.postal) setDestPostal(suggestion.postal);
    if (suggestion.street) setDestStreet(suggestion.street);
    setDestLocker('');
    setDestBranch('');
  }, [toCountry]);

  const applyPickupAddress = useCallback((suggestion: AddressSuggestion) => {
    setPickupAddressQuery(suggestion.label);
    setPickupAddressFocus({ lat: suggestion.lat, lng: suggestion.lng });
    setPickupAddressReady(true);
    if (suggestion.street) setPickupStreet(suggestion.street);
    else setPickupStreet(suggestion.label.split(',')[0]?.trim() || suggestion.label);
    const canonical = canonicalCityValue(PICKUP_COUNTRY, suggestion.city);
    if (canonical) setPickupCity(canonical);
    if (suggestion.postal) setPickupPostal(suggestion.postal);
    setPickupLocker('');
    setPickupBranch('');
  }, []);

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

  const draftHintItems = useMemo((): DraftHintItem[] => {
    const hints = restoredHintsRef.current;
    const items: DraftHintItem[] = [];
    const push = (
      id: string,
      label: string,
      restored: string,
      current: string,
      apply: () => void,
    ) => {
      const value = restored.trim();
      const now = current.trim();
      if (!value || value === now) return;
      items.push({ id, label, value, onApply: apply });
    };

    if (step === 2) {
      push('pickupCity', t('calc.pickupCity'), hints.pickupCity, pickupCity, () => changePickupCity(hints.pickupCity));
      push('destCity', t('calc.destCity'), hints.destCity, destCity, () => changeDestCity(hints.destCity));
    }

    if (step === 7) {
      push('pickupCity', t('calc.city'), hints.pickupCity, pickupCity, () => changePickupCity(hints.pickupCity));
      push(
        'pickupAddress',
        t('calc.senderAddress'),
        hints.pickupAddress,
        pickupAddressQuery || pickupStreet,
        () => {
          setPickupAddressQuery(hints.pickupAddress);
          setPickupStreet(hints.pickupAddress);
        },
      );
      if (hints.destCity.trim()) {
        items.push({
          id: 'destCityCtx',
          label: t('calc.destCity'),
          value: hints.destCity.trim(),
          onApply: () => changeDestCity(hints.destCity),
        });
      }
    }

    if (step === 8) {
      push('destCity', t('calc.city'), hints.destCity, destCity, () => changeDestCity(hints.destCity));
      push(
        'destAddress',
        t('calc.deliveryAddress'),
        hints.destAddress,
        destAddressQuery || destStreet,
        () => {
          setDestAddressQuery(hints.destAddress);
          setDestStreet(hints.destAddress);
        },
      );
      if (hints.pickupCity.trim()) {
        items.push({
          id: 'pickupCityCtx',
          label: t('calc.pickupCity'),
          value: hints.pickupCity.trim(),
          onApply: () => changePickupCity(hints.pickupCity),
        });
      }
    }

    return items;
  }, [
    step,
    t,
    pickupCity,
    destCity,
    pickupAddressQuery,
    pickupStreet,
    destAddressQuery,
    destStreet,
    changePickupCity,
    changeDestCity,
  ]);

  // Load live locker points when entering steps 7/8
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (step === 7 && pickupType === 'locker' && pickupCity.trim()) {
        setPointsLoading(true);
        try {
          const res = await fetchShippingPoints({
            country: PICKUP_COUNTRY,
            city: pickupCity.trim(),
            kind: 'locker',
            side: 'pickup',
          });
          if (!cancelled) {
            setLivePickupLockers(res.points);
            if (res.points[0]) setPickupLocker(res.points[0].id);
          }
        } catch {
          if (!cancelled) setLivePickupLockers(null);
        } finally {
          if (!cancelled) setPointsLoading(false);
        }
      }
      if (step === 8 && deliveryType === 'locker' && destCity.trim() && destAddressReady) {
        setPointsLoading(true);
        try {
          const res = await fetchShippingPoints({
            country: toCountry,
            city: destCity.trim(),
            kind: 'locker',
            side: 'delivery',
          });
          if (!cancelled) {
            setLiveDestLockers(res.points);
          }
        } catch {
          if (!cancelled) setLiveDestLockers(null);
        } finally {
          if (!cancelled) setPointsLoading(false);
        }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [step, pickupType, deliveryType, pickupCity, destCity, toCountry, pickupAddressReady, destAddressReady]);

  // If user lands mid-flow without coverage (e.g. after restoring draft), load it
  useEffect(() => {
    if (step >= 3 && step <= 9 && !coverage && !coverageLoading && pickupCity.trim() && destCity.trim()) {
      void loadCoverage();
    }
  }, [step, coverage, coverageLoading, pickupCity, destCity, loadCoverage]);

  useEffect(() => {
    if (pickupLockersForCity.length && !pickupLockersForCity.some((l) => l.id === pickupLocker)) {
      setPickupLocker(pickupLockersForCity[0].id);
    }
  }, [pickupLockersForCity, pickupLocker]);

  useEffect(() => {
    if (pickupBranchesForCity.length && !pickupBranchesForCity.some((l) => l.id === pickupBranch)) {
      setPickupBranch(pickupBranchesForCity[0].id);
    }
  }, [pickupBranchesForCity, pickupBranch]);

  useEffect(() => {
    if (!destLockersForCity.length) return;
    if (destLockersForCity.some((l) => l.id === destLocker)) return;
    if (destAddressFocus) {
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
      if (nearest) setDestLocker(nearest.id);
      return;
    }
    setDestLocker(destLockersForCity[0].id);
  }, [destLockersForCity, destLocker, destAddressFocus]);

  useEffect(() => {
    if (!destBranchesForCity.length) return;
    if (destBranchesForCity.some((l) => l.id === destBranch)) return;
    if (destAddressFocus) {
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
      if (nearest) setDestBranch(nearest.id);
      return;
    }
    setDestBranch(destBranchesForCity[0].id);
  }, [destBranchesForCity, destBranch, destAddressFocus]);

  const pickupLocationObj = pickupType === 'branch'
    ? pickupBranchesForCity.find((l) => l.id === pickupBranch) || PICKUP_BRANCHES.find((l) => l.id === pickupBranch)
    : pickupType === 'locker'
      ? pickupLockersForCity.find((l) => l.id === pickupLocker) || PICKUP_LOCKERS.find((l) => l.id === pickupLocker)
      : null;
  const destLocationObj = deliveryType === 'branch'
    ? destBranchesForCity.find((l) => l.id === destBranch) || DEST_BRANCHES.find((l) => l.id === destBranch)
    : deliveryType === 'locker'
      ? destLockersForCity.find((l) => l.id === destLocker) || DEST_LOCKERS.find((l) => l.id === destLocker)
      : null;

  const buildPickupLine = () => {
    if (pickupType === 'locker' || pickupType === 'branch') {
      return `${countryLabel(PICKUP_COUNTRY, locale)}, ${pickupLocationObj?.address || t('calc.pointFallback')}`;
    }
    return `${countryLabel(PICKUP_COUNTRY, locale)}, ${pickupStreet}, ${pickupCity} ${pickupPostal}`.trim();
  };

  const buildDestLine = () => {
    if (deliveryType === 'locker' || deliveryType === 'branch') {
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
    };
    return `${labels[pickup]} → ${labels[delivery]}`;
  }, [t]);

  const valueOptions = useMemo(() => VALUE_KEYS.map((key) => ({
    key,
    label: t(`calc.value${key.charAt(0).toUpperCase()}${key.slice(1)}`),
  })), [t]);

  const sizeLabel = sizeKey === 'custom'
    ? t('calc.sizeCustomFmt', { l: customSize.l, w: customSize.w, h: customSize.h, kg: customSize.kg })
    : sizeKey === 'envelope'
      ? t('calc.sizeEnvelope')
      : sizeKey;

  const summaryRows: SummaryRow[] = useMemo(() => [
    { key: 'from', label: t('calc.summaryFrom'), value: formatRoute(PICKUP_COUNTRY, toCountry), onEdit: () => goTo(1) },
    { key: 'cities', label: t('calc.summaryCities'), value: [cityLabelForValue(PICKUP_COUNTRY, pickupCity, locale), cityLabelForValue(toCountry, destCity, locale)].filter(Boolean).join(' → ') || '—', onEdit: () => goTo(2) },
    { key: 'type', label: t('calc.summaryType'), value: formatDeliveryTypeLocalized(pickupType, deliveryType), onEdit: () => goTo(3) },
    { key: 'size', label: t('calc.summarySize'), value: sizeLabel, onEdit: () => goTo(4) },
    {
      key: 'contents',
      label: t('calc.summaryContents'),
      value: contentLabel(contents, contentsNote),
      onEdit: () => goTo(5),
    },
    { key: 'value', label: t('calc.summaryValue'), value: valueOptions.find((v) => v.key === contentValue)?.label || '—', onEdit: () => goTo(6) },
    { key: 'pays', label: t('calc.summaryPays'), value: payer === 'sender' ? t('calc.payerSender') : t('calc.payerReceiver'), onEdit: () => goTo(6) },
    { key: 'sender', label: t('calc.summarySender'), value: senderName || pickupLocationObj?.provider || '—', onEdit: () => goTo(7) },
    { key: 'recipient', label: t('calc.summaryRecipient'), value: receiverFirst ? `${receiverFirst} ${receiverLast}`.trim() : destLocationObj?.provider || '—', onEdit: () => goTo(8) },
    { key: 'when', label: t('calc.summaryWhen'), value: pickupDate ? `${pickupDate}, ${pickupTime}` : '—' },
  ], [
    t, toCountry, pickupCity, destCity, pickupType, deliveryType, sizeLabel, contents, contentsNote, contentValue, payer,
    senderName, pickupLocationObj, receiverFirst, receiverLast, destLocationObj, pickupDate, pickupTime,
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
      if (!pickupType || !deliveryType) return t('calc.valSelectModes');
      if (coverage) {
        if (!coverage.pickup[pickupType]?.available) return t('calc.valPickupMode');
        if (!coverage.delivery[deliveryType]?.available) return t('calc.valDeliveryMode');
      }
    }
    if (step === 4) {
      if (sizeKey === 'custom') {
        if (!customSize.l || !customSize.w || !customSize.h || !customSize.kg) return t('calc.valCustomSize');
        if (Number(customSize.kg) > 20) return t('calc.valMaxWeight');
      }
    }
    if (step === 5) {
      if (!contents) return t('calc.valSelectContents');
      if (contents === 'other' && !contentsNote.trim()) return t('calc.valDescribeContents');
    }
    if (step === 6 && (!contentValue || !payer)) return t('calc.valValuePayer');
    if (step === 7) {
      const nameErr = validatePersonName(senderName, t('calc.fieldSenderName'));
      if (nameErr) return nameErr;
      const emailErr = validateEmail(senderEmail, t('calc.fieldSenderEmail'));
      if (emailErr) return emailErr;
      const phoneErr = validatePhone(senderDial, senderPhone, countryCodeFromDial(senderDial), t('calc.fieldSenderPhone'));
      if (phoneErr) return phoneErr;
      if (pickupType === 'home') {
        if (!pickupAddressReady) return t('calc.valSelectAddressHint');
        if (!pickupStreet || !pickupCity || !pickupPostal) return t('calc.valPickupAddress');
      }
      if (pickupType === 'locker' && !pickupAddressReady) return t('calc.valSelectAddressHint');
      if (pickupType === 'branch' && pickupNeedsAddressRefinement && !pickupAddressReady) {
        return t('calc.valSelectAddressHint');
      }
      if (pickupType === 'locker' && !pickupLocker) return t('calc.valSelectPickupLocker');
      if (pickupType === 'branch' && !pickupBranch) return t('calc.valSelectPickupBranch');
    }
    if (step === 8) {
      const firstErr = validatePersonName(receiverFirst, t('calc.fieldReceiverFirst'));
      const lastErr = validatePersonName(receiverLast, t('calc.fieldReceiverLast'));
      if (firstErr && lastErr) return t('calc.valReceiverName');
      const phoneErr = validatePhone(receiverDial, receiverPhone, countryCodeFromDial(receiverDial), t('calc.fieldReceiverPhone'));
      if (phoneErr) return phoneErr;
      if (deliveryType === 'home') {
        if (!destAddressReady) return t('calc.valSelectAddressHint');
        if (!destStreet || !destCity || !destPostal) return t('calc.valDeliveryAddress');
      }
      if ((deliveryType === 'locker' || deliveryType === 'branch') && !destAddressReady) return t('calc.valSelectAddressHint');
      if (deliveryType === 'locker' && !destLocker) return t('calc.valSelectDestLocker');
      if (deliveryType === 'branch' && !destBranch) return t('calc.valSelectDestBranch');
    }
    if (step === 9) {
      if (!termsAccepted) return t('calc.valAcceptTerms');
      if (totalPrice == null) return t('calc.valWaitQuote');
      const nameErr = validatePersonName(senderName, t('calc.fieldSenderName'));
      if (nameErr) return nameErr;
      const emailErr = validateEmail(senderEmail, t('calc.fieldSenderEmail'));
      if (emailErr) return emailErr;
      const sPhoneErr = validatePhone(senderDial, senderPhone, countryCodeFromDial(senderDial), t('calc.fieldSenderPhone'));
      if (sPhoneErr) return sPhoneErr;
      const rPhoneErr = validatePhone(receiverDial, receiverPhone, countryCodeFromDial(receiverDial), t('calc.fieldReceiverPhone'));
      if (rPhoneErr) return rPhoneErr;
    }
    return null;
  }, [
    t, step, toCountry, pickupType, deliveryType, sizeKey, customSize, contents, contentsNote, contentValue, payer,
    senderName, senderEmail, senderDial, senderPhone, pickupStreet, pickupCity, pickupPostal, pickupLocker, pickupBranch,
    pickupNeedsAddressRefinement, pickupAddressReady,
    receiverFirst, receiverLast, receiverDial, receiverPhone, destStreet, destCity, destPostal, destLocker, destBranch,
    destAddressReady, termsAccepted, totalPrice, coverage,
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
        // Still allow continue with home-only fallback if API failed
        setPickupType('home');
        setDeliveryType('home');
      }
    }

    goTo(step + 1);
  };

  const handlePay = async () => {
    const stepErr = validateCurrentStep();
    if (stepErr) {
      setError(stepErr);
      return;
    }
    if (totalPrice == null || payInFlight.current || submitting) return;
    const payEmail = senderEmail.trim().toLowerCase();
    const emailErr = validateEmail(payEmail, t('calc.fieldSenderEmail'));
    if (emailErr) {
      setError(emailErr);
      goTo(7);
      return;
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
        sender: {
          country: PICKUP_COUNTRY,
          line: pickupLabel,
          name: senderName,
          email: payEmail,
          phone: composePhone(senderDial, senderPhone),
        },
        receiver: {
          firstName: receiverFirst || 'Recipient',
          lastName: receiverLast || 'Customer',
          phone: composePhone(receiverDial, receiverPhone),
          email: payEmail,
          destinationLine: destLabel,
          country: toCountry,
        },
        parcel: {
          boxSize,
          ...preset,
          declaredValue: declaredForNp,
          description: contents === 'other' && contentsNote.trim()
            ? `Parcel ${boxSize} — ${t('calc.otherFmt', { note: contentsNote.trim() })}`
            : `Parcel ${boxSize} — ${contentLabel(contents, contentsNote)}`,
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
        },
      });

      if (result.checkoutUrl) {
        clearCalcDraft(inModal, user?.id);
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
        <button type="button" className="btn btn-outline" onClick={() => goTo(step - 1)}>
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
          disabled={submitting}
          onClick={handlePay}
        >
          {submitting ? t('calc.paying') : t('calc.pay', { amount: formatMoney(totalPrice ?? 0) })}
        </button>
      )}
    </div>
  );

  /* Mobile + desktop: hide «Итого» until cities step, then show it above «Далее» */
  const showSummary = step >= 2;
  const summaryCompact = step === 4;
  const navAfterLayout = inModal || showSummary;

  const summaryEl = showSummary ? (
    <OrderSummary
      rows={visibleSummaryRows}
      price={totalPrice}
      currency={currency}
      compact={summaryCompact}
      pricePending={quoteRefreshing && totalPrice == null}
      welcomeDiscountPercent={welcomeDiscountPercent}
      deliveryAmount={basePrice}
      fragileFee={extras.fragileFee}
      insuranceFee={extras.insuranceFee}
      insurancePercent={extras.insurancePercent}
    />
  ) : null;

  const stepMeta = useMemo(() => ({
    1: { title: t('calc.step1Title'), sub: t('calc.step1Sub') },
    2: { title: t('calc.step2Title'), sub: t('calc.step2Sub') },
    3: { title: t('calc.step3Title'), sub: t('calc.step3Sub') },
    4: { title: t('calc.step4Title'), sub: t('calc.step4Sub') },
    5: { title: t('calc.step5Title'), sub: t('calc.step5Sub') },
    6: { title: t('calc.step6Title'), sub: t('calc.step6Sub') },
    7: { title: t('calc.step7Title'), sub: t('calc.step7Sub') },
    8: { title: t('calc.step8Title'), sub: t('calc.step8Sub') },
    9: { title: t('calc.step9Title'), sub: t('calc.step9Sub') },
  }), [t]);

  const deliveryModes = useMemo(() => DELIVERY_MODE_KEYS.map((key) => ({
    key,
    label: t(`calc.mode${key === 'home' ? 'Home' : key === 'branch' ? 'Branch' : 'Locker'}`),
    icon: DELIVERY_MODE_ICONS[key],
  })), [t]);

  const sizeOptions = useMemo(() => {
    const presetDesc = (key: ParcelKey) => {
      const p = PARCEL_PRESETS[key];
      return t('calc.sizePresetDesc', { l: p.lengthCm, w: p.widthCm, h: p.heightCm, kg: p.weightKg });
    };
    return SIZE_OPTION_KEYS.map((key) => {
      if (key === 'envelope') {
        return { key, label: t('calc.sizeEnvelope'), icon: '✉️', desc: t('calc.sizeEnvelopeDesc') };
      }
      if (key === 'custom') {
        return { key, label: t('calc.sizeCustom'), icon: '📐', desc: t('calc.sizeCustomDesc') };
      }
      return { key, label: key, icon: '📦', desc: presetDesc(key) };
    });
  }, [t]);

  const contentOptions = useMemo(() => CONTENT_KEYS.map((key) => ({
    key,
    label: t(`calc.content${key.charAt(0).toUpperCase()}${key.slice(1)}`),
    icon: CONTENT_ICONS[key],
  })), [t]);

  const modeHint = useCallback((side: CoverageSide | null | undefined, key: DeliveryMode) => {
    if (!side || side[key]?.available) return undefined;
    if (key === 'locker') return t('calc.noLockers');
    if (key === 'branch') return t('calc.noBranch');
    return t('calc.unavailable');
  }, [t]);

  const addressPlaceholder = useCallback((country: string, city: string) => (
    city.trim()
      ? t('calc.addressPlaceholderInCity', { city: cityLabelForValue(country, city, locale) })
      : t('calc.addressPlaceholder')
  ), [t]);

  const stepContent = (
    <>
      {step === 1 && (
        <>
          <StepHeader step={1} title={stepMeta[1].title} subtitle={stepMeta[1].sub} />
              <div className="field-block">
                <label className="calc-form__field-label">{t('calc.from')}</label>
                <div className="calc-form__static calc-form__static--active calc-country-static">
                  <CountryFlag code={PICKUP_COUNTRY} size={22} />
                  <span>{countryLabel(PICKUP_COUNTRY, locale)} {countryFlag(PICKUP_COUNTRY)}</span>
                </div>
              </div>
              <div className="field-block">
                <label className="calc-form__field-label">{t('calc.to')}</label>
                <CountrySelect
                  value={toCountry}
                  exclude={PICKUP_COUNTRY}
                  onChange={(code) => {
                    setToCountry(code);
                    setReceiverDial(DIAL_BY_CC[code] || '+49');
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

          {step === 3 && (
            <>
              <StepHeader step={3} title={stepMeta[3].title} subtitle={stepMeta[3].sub} />
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
                disabledKeys={{
                  locker: coverage ? !coverage.pickup.locker.available : false,
                  branch: coverage ? !coverage.pickup.branch.available : false,
                  home: false,
                }}
                hints={{
                  locker: modeHint(coverage?.pickup, 'locker'),
                  branch: modeHint(coverage?.pickup, 'branch'),
                }}
              />
              <p className="calc-form__group-label">{t('calc.deliverWhere')}</p>
              <OptionGrid
                options={deliveryModes}
                value={deliveryType}
                onChange={setDeliveryType}
                disabledKeys={{
                  locker: coverage ? !coverage.delivery.locker.available : false,
                  branch: coverage ? !coverage.delivery.branch.available : false,
                  home: false,
                }}
                hints={{
                  locker: modeHint(coverage?.delivery, 'locker'),
                  branch: modeHint(coverage?.delivery, 'branch'),
                }}
              />
            </>
          )}

          {step === 4 && (
            <>
              <StepHeader step={4} title={stepMeta[4].title} subtitle={stepMeta[4].sub} />
              <div className="calc-form__sizes">
                {sizeOptions.map((s) => {
                  const priceKey: ParcelKey | null = s.key === 'envelope'
                    ? 'S'
                    : s.key === 'custom'
                      ? (sizeKey === 'custom' ? apiParcelKey : null)
                      : s.key;
                  const price = priceKey && PARCEL_KEYS.includes(priceKey)
                    ? parcelQuotes[priceKey]
                    : null;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      className={`calc-form__size${sizeKey === s.key ? ' active' : ''}${s.key === 'custom' ? ' calc-form__size--wide' : ''}`}
                      onClick={() => setSizeKey(s.key)}
                    >
                      <span className="calc-form__size-icon">{s.icon}</span>
                      <b>{s.label}</b>
                      <span>{s.desc}</span>
                      {price != null && (
                        <em className={quoteRefreshing && !quotesFromNp ? 'calc-form__price-est' : ''}>
                          {formatMoney(price)}
                        </em>
                      )}
                    </button>
                  );
                })}
              </div>
              {sizeKey === 'custom' && (
                <div className="calc-custom-dims">
                  <div className="calc-form__grid calc-form__grid--3">
                    <div className="field-block">
                      <label>{t('calc.lengthCm')}</label>
                      <input
                        inputMode="decimal"
                        value={customSize.l}
                        onChange={(e) => setCustomSize((p) => ({ ...p, l: e.target.value }))}
                      />
                    </div>
                    <div className="field-block">
                      <label>{t('calc.widthCm')}</label>
                      <input
                        inputMode="decimal"
                        value={customSize.w}
                        onChange={(e) => setCustomSize((p) => ({ ...p, w: e.target.value }))}
                      />
                    </div>
                    <div className="field-block">
                      <label>{t('calc.heightCm')}</label>
                      <input
                        inputMode="decimal"
                        value={customSize.h}
                        onChange={(e) => setCustomSize((p) => ({ ...p, h: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="calc-weight-stepper">
                    <label className="calc-weight-stepper__label">{t('calc.weightKg')}</label>
                    <div className="calc-weight-stepper__control">
                      <button
                        type="button"
                        className="calc-weight-stepper__btn"
                        aria-label={t('calc.decreaseWeight')}
                        disabled={Number(customSize.kg) <= 0.1}
                        onClick={() => setCustomSize((p) => ({
                          ...p,
                          kg: String(Math.max(0.1, Math.round((Number(p.kg) || 0.1) * 10 - 1) / 10)),
                        }))}
                      >
                        −
                      </button>
                      <div className="calc-weight-stepper__value">
                        <input
                          className="calc-weight-stepper__input"
                          inputMode="decimal"
                          value={customSize.kg}
                          aria-label={t('calc.weightKg')}
                          onChange={(e) => {
                            const raw = e.target.value.replace(',', '.').replace(/[^\d.]/g, '');
                            setCustomSize((p) => ({ ...p, kg: raw }));
                          }}
                          onBlur={() => {
                            let n = Number(customSize.kg);
                            if (!Number.isFinite(n) || n < 0.1) n = 0.1;
                            if (n > 20) n = 20;
                            setCustomSize((p) => ({ ...p, kg: String(Math.round(n * 10) / 10) }));
                          }}
                        />
                        <span>kg</span>
                      </div>
                      <button
                        type="button"
                        className="calc-weight-stepper__btn"
                        aria-label={t('calc.increaseWeight')}
                        disabled={Number(customSize.kg) >= 20}
                        onClick={() => setCustomSize((p) => ({
                          ...p,
                          kg: String(Math.min(20, Math.round((Number(p.kg) || 0) * 10 + 1) / 10)),
                        }))}
                      >
                        +
                      </button>
                    </div>
                    <p className="calc-weight-stepper__hint">{t('calc.weightHint')}</p>
                  </div>
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
              {showQuoteWait && step === 4 && (
                <p className="calc-form__hint calc-form__hint--inline calc-form__hint--wait" aria-live="polite">
                  <span className="calc-form__wait-dot" aria-hidden />
                  {t('calc.waiting')}
                </p>
              )}
            </>
          )}

          {step === 5 && (
            <>
              <StepHeader step={5} title={stepMeta[5].title} subtitle={stepMeta[5].sub} />
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

          {step === 6 && (
            <>
              <StepHeader step={6} title={stepMeta[6].title} subtitle={stepMeta[6].sub} />
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
              <p className="calc-form__group-label">{t('calc.whoPays')}</p>
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

          {step === 7 && (
            <>
              <StepHeader
                step={7}
                title={stepMeta[7].title}
                subtitle={
                  pickupType === 'locker'
                    ? t('calc.senderSubLocker')
                    : pickupType === 'branch'
                      ? t('calc.senderSubBranch')
                      : t('calc.senderSubHome')
                }
              />
              {quoteRefreshing && (
                <p className="calc-form__hint">{t('calc.refiningPrice')}</p>
              )}
              <div className="field-block">
                <label>{t('calc.senderName')}</label>
                <input
                  name="sender_name"
                  autoComplete="name"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  placeholder={t('calc.senderNamePlaceholder')}
                />
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

              {pickupType === 'locker' && (
                <>
                  <AddressSuggest
                    label={t('calc.senderAddress')}
                    value={pickupAddressQuery}
                    onChange={onPickupAddressQueryChange}
                    onSelect={applyPickupAddress}
                    country={PICKUP_COUNTRY}
                    city={pickupCity}
                    placeholder={addressPlaceholder(PICKUP_COUNTRY, pickupCity)}
                    hint={t('calc.addressHintLockers')}
                    name="sender_address_locker"
                    bookAddresses={bookAddresses}
                  />
                  <p className="calc-form__group-label">{t('calc.pickupLockersLabel')}</p>
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
                      <input type="date" value={pickupDate} min={tomorrowIso()} onChange={(e) => setPickupDate(e.target.value)} />
                    </div>
                    <div className="field-block">
                      <label>{t('calc.pickupTime')}</label>
                      <select value={pickupTime} onChange={(e) => setPickupTime(e.target.value)}>
                        {PICKUP_TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {step === 8 && (
            <>
              <StepHeader
                step={8}
                title={stepMeta[8].title}
                subtitle={
                  deliveryType === 'locker'
                    ? t('calc.receiverSubLocker')
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
                  autoComplete="shipping tel-national"
                  name="receiver_phone"
                />
              </div>

              {deliveryType === 'locker' && (
                <>
                  <AddressSuggest
                    label={t('calc.receiverAddress')}
                    value={destAddressQuery}
                    onChange={onDestAddressQueryChange}
                    onSelect={applyDestAddress}
                    country={toCountry}
                    city={destCity}
                    placeholder={addressPlaceholder(toCountry, destCity)}
                    hint={t('calc.addressHintLockers')}
                    name="receiver_address"
                    bookAddresses={bookAddresses}
                  />
                  {destAddressReady ? (
                    <>
                      <p className="calc-form__group-label">{t('calc.pickupLockersLabel')}</p>
                      {pointsLoading && <p className="calc-form__hint">{t('calc.loadingPoints')}</p>}
                      <LockerPicker
                        lockers={destLockersForCity}
                        selected={destLocker}
                        onSelect={setDestLocker}
                        focusPos={destAddressFocus}
                      />
                    </>
                  ) : (
                    <p className="calc-form__hint">{t('calc.afterAddressLockers')}</p>
                  )}
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
                  {destAddressReady ? (
                    <>
                      <p className="calc-form__group-label">{t('calc.pickupBranchesLabel')}</p>
                      <LockerPicker
                        lockers={destBranchesForCity}
                        selected={destBranch}
                        onSelect={setDestBranch}
                        focusPos={destAddressFocus}
                      />
                    </>
                  ) : (
                    <p className="calc-form__hint">{t('calc.afterAddressBranches')}</p>
                  )}
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
                    onSelect={(s) => {
                      applyDestAddress(s);
                      if (s.street) setDestStreet(s.street);
                    }}
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
            {(step === 2 || step === 7 || step === 8) && <CalcDraftHints items={draftHintItems} />}
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
  /** Bump to remount form with latest draft (e.g. continue unfinished shipment). */
  resumeKey?: number;
  /** When true, open on the last saved draft step instead of step 1. */
  draftResume?: boolean;
};

export function ShipmentCalculator({ open, onClose, user, onSuccess, resumeKey = 0, draftResume = false }: ModalProps) {
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
            active={order.status === 'submitted'}
          />
          <b>{order.orderNumber}</b>
          <span>{countryLabel(order.fromCountry || 'HU', locale)} → {countryLabel(order.toCountry || '', locale)}</span>
          <span>{t('calc.statusLabel')}: {
            order.status === 'submitted' ? t('calc.statusSubmitted')
            : order.status === 'paid' ? t('calc.statusPaid')
            : order.status === 'pending_payment' ? t('dash.statusPending')
            : order.status === 'cancelled' ? t('dash.statusCancelled')
            : order.status
          }</span>
          {order.npTtn && <span>{t('calc.ttnLabel')}: {order.npTtn}</span>}
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
  if (status.status === 'submitted' || status.status === 'paid') return status;
  return confirmPayment(token);
}
