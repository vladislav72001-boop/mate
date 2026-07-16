import type { ShippingOrder } from '../../api/client-types';
import { countryLabel, formatQuoteMoney } from '../../constants/shipping';

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

export function estimateDeliveryWindow(order: ShippingOrder) {
  const base = new Date(order.paidAt || order.createdAt || Date.now());
  const latest = addBusinessDays(base, 3);
  const weekday = latest.toLocaleDateString('ru-RU', { weekday: 'long' });
  const dateLabel = latest.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  return {
    range: '2–3 рабочих дня',
    hint: `До ${dateLabel}, ${weekday}`,
  };
}

export function deliveryServiceLabel(mode?: string | null) {
  switch (mode) {
    case 'home':
    case 'address':
      return { title: 'Стандартная доставка', hint: 'Доставка до двери' };
    case 'locker':
      return { title: 'Доставка в постамат', hint: 'Nova Post / партнёры' };
    case 'branch':
      return { title: 'Доставка в филиал', hint: 'Пункт выдачи Mate' };
    default:
      return { title: 'Стандартная доставка', hint: 'Доставка по Европе' };
  }
}

export function orderStatusHeadline(order: ShippingOrder) {
  if (order.status === 'submitted' || order.npTtn) {
    return {
      label: 'Ожидает передачи перевозчику',
      hint: 'После подтверждения перевозчиком статус автоматически обновится.',
    };
  }
  if (order.status === 'paid') {
    return {
      label: 'Оплачено, начинаем обработку',
      hint: 'Мы передали заказ перевозчику и готовим отправление.',
    };
  }
  return {
    label: 'Заявка принята',
    hint: 'Мы уже начали обработку вашего заказа.',
  };
}

export function carrierLabel(order: ShippingOrder) {
  if (order.npTtn || order.npValid) {
    return { name: 'Nova Post', hint: 'Выбран автоматически Mate AI' };
  }
  return { name: 'Mate AI', hint: 'Оптимальный перевозчик подобран автоматически' };
}

export function trackingNumber(order: ShippingOrder) {
  return order.npTtn || order.orderNumber;
}

export function formatOrderMoney(order: ShippingOrder) {
  return formatQuoteMoney(order.amount, order.currency || 'EUR');
}

export function routeCityLine(countryCode?: string, line?: string | null) {
  const parsed = parseAddressLine(line);
  if (countryCode && parsed.cityLine !== '—') {
    const country = countryLabel(countryCode);
    if (!parsed.cityLine.toLowerCase().includes(country.toLowerCase())) {
      const city = parsed.cityLine.split(',')[0]?.trim() || parsed.cityLine;
      return `${city}, ${country}`;
    }
  }
  return parsed.cityLine;
}
