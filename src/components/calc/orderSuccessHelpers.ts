import type { ShippingOrder } from '../../api/client-types';
import { countryLabel, formatQuoteMoney } from '../../constants/shipping';
import type { Locale, TranslateVars } from '../../i18n/types';
import { localeToIntl } from '../../i18n/config';

type TFn = (key: string, vars?: TranslateVars) => string;

export function parseAddressLine(line?: string | null) {
  if (!line?.trim()) {
    return { cityLine: '—', streetLine: '—' };
  }
  const parts = line.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3) {
    return {
      cityLine: `${parts[1]}, ${parts[0]}`,
      streetLine: parts.slice(2).join(', '),
    };
  }
  if (parts.length === 2) {
    return { cityLine: parts[0], streetLine: parts[1] };
  }
  return { cityLine: line.trim(), streetLine: '—' };
}

function addBusinessDays(from: Date, days: number) {
  const date = new Date(from);
  let added = 0;
  while (added < days) {
    date.setDate(date.getDate() + 1);
    const dow = date.getDay();
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return date;
}

export function estimateDeliveryWindow(order: ShippingOrder, t: TFn, locale: Locale) {
  const base = new Date(order.paidAt || order.createdAt || Date.now());
  const latest = addBusinessDays(base, 3);
  const intl = localeToIntl(locale);
  const weekday = latest.toLocaleDateString(intl, { weekday: 'long' });
  const dateLabel = latest.toLocaleDateString(intl, { day: 'numeric', month: 'long' });
  return {
    range: t('orderSuccess.etaRange'),
    hint: t('orderSuccess.etaUntil', { date: dateLabel, weekday }),
  };
}

export function deliveryServiceLabel(mode: string | null | undefined, t: TFn) {
  switch (mode) {
    case 'home':
    case 'address':
      return { title: t('orderSuccess.serviceHomeTitle'), hint: t('orderSuccess.serviceHomeHint') };
    case 'locker':
      return { title: t('orderSuccess.serviceLockerTitle'), hint: t('orderSuccess.serviceLockerHint') };
    case 'branch':
      return { title: t('orderSuccess.serviceBranchTitle'), hint: t('orderSuccess.serviceBranchHint') };
    default:
      return { title: t('orderSuccess.serviceDefaultTitle'), hint: t('orderSuccess.serviceDefaultHint') };
  }
}

export function orderStatusHeadline(order: ShippingOrder, t: TFn) {
  if (order.status === 'submitted' || order.npTtn) {
    return {
      label: t('orderSuccess.statusSubmitted'),
      hint: t('orderSuccess.statusSubmittedHint'),
    };
  }
  if (order.status === 'paid') {
    return {
      label: t('orderSuccess.statusPaid'),
      hint: t('orderSuccess.statusPaidHint'),
    };
  }
  return {
    label: t('orderSuccess.statusAccepted'),
    hint: t('orderSuccess.statusAcceptedHint'),
  };
}

export function carrierLabel(order: ShippingOrder, t: TFn) {
  if (order.npTtn || order.npValid) {
    return { name: 'Nova Post', hint: t('orderSuccess.carrierNpHint') };
  }
  return { name: 'Mate AI', hint: t('orderSuccess.carrierMateHint') };
}

export function trackingNumber(order: ShippingOrder) {
  return order.npTtn || order.orderNumber;
}

export function formatOrderMoney(order: ShippingOrder) {
  return formatQuoteMoney(order.amount, order.currency || 'EUR');
}

export function routeCityLine(countryCode?: string, line?: string | null, locale?: Locale) {
  const parsed = parseAddressLine(line);
  if (countryCode && parsed.cityLine !== '—') {
    const country = countryLabel(countryCode, locale);
    if (!parsed.cityLine.toLowerCase().includes(country.toLowerCase())) {
      const city = parsed.cityLine.split(',')[0]?.trim() || parsed.cityLine;
      return `${city}, ${country}`;
    }
  }
  return parsed.cityLine;
}
