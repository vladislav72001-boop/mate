import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { CalcCard } from './components/CalcCard';
import { ClientAuthModal, type ClientOnboardingTarget } from './components/ClientAuthModal';
import { ClientDashboard, type ClientDashTab } from './components/ClientDashboard';
import { ShipmentCalculator, resumePaymentFromUrl } from './components/ShipmentCalculator';
import {
  loadActiveCalcDraft,
  clearCalcDraft,
  mergeGuestDraftIntoCart,
  CALC_DRAFT_EVENT,
} from './components/calc/calcDraft';
import { CalcDraftCart } from './components/calc/CalcDraftCart';
import { isMeaningfulCalcDraft } from './components/calc/calcDraftSummary';
import { ScrollToTop } from './components/ScrollToTop';
import { OrderSuccessScreen } from './components/calc/OrderSuccessScreen';
import { AdminApp } from './components/admin/AdminApp';
import { MateLogo } from './components/MateLogo';
import { PartnerLogo, PARTNER_IDS } from './components/PartnerLogo';
import { LanguageSelect } from './components/LanguageSelect';
import { useI18n } from './i18n/context';
import type { ShippingOrder } from './api/shipping';
import {
  clearSession,
  fetchMe,
  getStoredToken,
  storeSession,
  type AuthUser,
} from './api/auth';

type TopPage = 'home' | 'services' | 'business' | 'about' | 'dashboard' | 'client-dashboard' | 'admin';
type ClientAuthMode = 'register' | 'login';
type ServiceFilter =
  | 'all'
  | 'parcel'
  | 'cargo'
  | 'warehouse'
  | 'fulfillment'
  | 'express'
  | 'returns'
  | 'customs'
  | 'tracking';

type ServiceItem = {
  id: ServiceFilter;
  icon: string;
  title: string;
  description: string;
  soon?: boolean;
};

const services: ServiceItem[] = [
  {
    id: 'parcel',
    icon: '📦',
    title: 'Доставка посылок',
    description: 'Быстрая и надежная доставка посылок в Европе и по миру от двери до двери.',
  },
  {
    id: 'cargo',
    icon: '🚚',
    title: 'Грузовые перевозки',
    description: 'Перевозка крупногабаритных и тяжелых грузов любым видом транспорта.',
    soon: true,
  },
  {
    id: 'warehouse',
    icon: '🏬',
    title: 'Складские решения',
    description: 'Безопасное хранение товаров на современных складах в стратегических локациях.',
    soon: true,
  },
  {
    id: 'fulfillment',
    icon: '📋',
    title: 'Фулфилмент',
    description: 'Комплексная обработка заказов: хранение, упаковка, комплектация и доставка.',
    soon: true,
  },
  {
    id: 'all',
    icon: '🌍',
    title: 'Международная доставка',
    description: 'Доставка в более чем 200 стран мира с полным контролем на каждом этапе.',
    soon: true,
  },
  {
    id: 'express',
    icon: '⚡',
    title: 'Экспресс-доставка',
    description: 'Срочная доставка посылок и документов в кратчайшие сроки по всему миру.',
    soon: true,
  },
  {
    id: 'returns',
    icon: '🔄',
    title: 'Возвраты',
    description: 'Простое и удобное управление возвратами товаров для бизнеса и клиентов.',
    soon: true,
  },
  {
    id: 'customs',
    icon: '📄',
    title: 'Таможенное оформление',
    description: 'Полное таможенное оформление и подготовка документов без задержек и сложностей.',
    soon: true,
  },
  {
    id: 'tracking',
    icon: '📍',
    title: 'Отслеживание',
    description: 'Отслеживайте отправления в реальном времени на каждом этапе доставки.',
    soon: true,
  },
];

const bizSolutions = [
  { id: 'parcel',      svgId: 'parcel',      title: 'Доставка заказов',    desc: 'Автоматический выбор лучшего перевозчика по цене и срокам доставки.' },
  { id: 'warehouse',   svgId: 'warehouse',   title: 'Склады в Европе',     desc: 'Хранение товаров на наших складах в ключевых странах Европы.' },
  { id: 'fulfillment', svgId: 'fulfillment', title: 'Фулфилмент',          desc: 'Приёмка, хранение, упаковка, комплектация и отправка заказов вашим клиентам.' },
  { id: 'returns',     svgId: 'returns',     title: 'Возвраты',            desc: 'Удобное управление возвратами и обменами по всей Европе.' },
  { id: 'analytics',   svgId: 'tracking',    title: 'Аналитика',           desc: 'Полная аналитика по отправлениям, расходам и SLA в реальном времени.' },
  { id: 'api',         svgId: 'customs',     title: 'API и интеграции',    desc: 'Быстрое подключение через API и готовые интеграции с вашими системами.' },
];

const bizStats = [
  { icon: 'cargo',       num: '1000+', label: 'компаний\nдоверяют нам' },
  { icon: 'warehouse',   num: '26',    label: 'складов\nв Европе' },
  { icon: 'parcel',      num: '200+',  label: 'перевозчиков\nпо всему миру' },
  { icon: 'tracking',    num: '99.8%', label: 'доставок\nвовремя' },
  { icon: 'fulfillment', num: '24/7',  label: 'поддержка\nклиентов' },
];

const bizSteps = [
  { n: '1', icon: 'parcel',      title: 'Заказ',               desc: 'Поступает заказ в ваш магазин' },
  { n: '2', icon: 'fulfillment', title: 'MATE получает',        desc: 'Мы получаем заказ и проверяем его' },
  { n: '3', icon: 'cargo',       title: 'Выбор перевозчика',   desc: 'Система выбирает лучшего перевозчика' },
  { n: '4', icon: 'customs',     title: 'Создание отправки',   desc: 'Создаём накладную и этикетку' },
  { n: '5', icon: 'warehouse',   title: 'Передача на склад',   desc: 'Товар передаётся на ближайший склад' },
  { n: '6', icon: 'tracking',    title: 'Доставка клиенту',    desc: 'Клиент получает заказ в срок' },
];

const aboutStatDefs = [
  { icon: 'warehouse', num: '16', labelKey: 'statsWarehouses' },
  { icon: 'cargo', num: '6+', labelKey: 'statsCarriers' },
  { icon: 'all', num: '16', labelKey: 'statsCountries' },
  { icon: 'users', num: '50+', labelKey: 'statsCompanies' },
] as const;

const aboutContacts = [
  { id: 'email',    label: 'Email',          value: 'Info@matedelivery.com', href: 'mailto:Info@matedelivery.com' },
  { id: 'phone',    label: 'Телефон',        value: '+36 705 549 233',       href: 'tel:+36705549233' },
  { id: 'whatsapp', label: 'WhatsApp',       value: '+36 705 549 233',       href: 'https://wa.me/36705549233' },
  { id: 'telegram', label: 'Telegram',       value: '@matedelivery',         href: 'https://t.me/matedelivery' },
  { id: 'support',  label: 'Поддержка 24/7', value: 'Мы всегда на связи и готовы помочь.', href: 'mailto:Info@matedelivery.com?subject=Поддержка%20MATE' },
];

const dashOrders = [
  { id: '#10254', carrier: 'DPD',    status: 'В пути',     stColor: '#1da1f2', route: 'Таллин → Берлин',   price: '․24.50' },
  { id: '#10253', carrier: 'DHL',    status: 'Доставлено', stColor: '#22c55e', route: 'Рига → Мюнхен',     price: '․18.75' },
  { id: '#10252', carrier: 'UPS',    status: 'В пути',     stColor: '#1da1f2', route: 'Варшава → Париж',   price: '․22.10' },
  { id: '#10251', carrier: 'Omniva', status: 'Создано',    stColor: '#94a3b8', route: 'Хельсинки → Милан', price: '․15.30' },
  { id: '#10250', carrier: 'DPD',    status: 'Доставлено', stColor: '#22c55e', route: 'Прага → Вена',      price: '․17.80' },
];

function DashIcon({ id, size = 16 }: { id: string; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'home':         return <svg {...p}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
    case 'shipments':    return <svg {...p}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>;
    case 'orders':       return <svg {...p}><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="2"/><line x1="9" y1="12" x2="15" y2="12"/></svg>;
    case 'warehouses':   return <svg {...p}><path d="M2 20h20"/><path d="M4 20V10l8-6 8 6v10"/><rect x="9" y="14" width="6" height="6"/></svg>;
    case 'finance':      return <svg {...p}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>;
    case 'analytics':    return <svg {...p}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>;
    case 'integrations': return <svg {...p}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>;
    case 'support':      return <svg {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
    case 'settings':     return <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;
    default: return <svg {...p}><circle cx="12" cy="12" r="4"/></svg>;
  }
}

function ServiceSvgIcon({ id, size = 40 }: { id: string; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'parcel': return <svg {...p}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>;
    case 'cargo': return <svg {...p}><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>;
    case 'warehouse': return <svg {...p}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
    case 'fulfillment': return <svg {...p}><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="2"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="12" y2="16"/></svg>;
    case 'all': return <svg {...p}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>;
    case 'express': return <svg {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
    case 'returns': return <svg {...p}><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>;
    case 'customs': return <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>;
    case 'tracking': return <svg {...p}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>;
    case 'users': return <svg {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
    default: return <svg {...p}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>;
  }
}

function ContactIcon({ id, size = 18 }: { id: string; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'email': return <svg {...p}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>;
    case 'phone': return <svg {...p}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>;
    case 'whatsapp': return <svg {...p}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>;
    case 'telegram': return <svg {...p}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;
    case 'support': return <svg {...p}><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>;
    case 'company': return <svg {...p}><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/><path d="M9 10h.01M15 10h.01M9 14h.01M15 14h.01"/></svg>;
    case 'pin': return <svg {...p}><path d="M12 21s7-4.5 7-11a7 7 0 1 0-14 0c0 6.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.2"/></svg>;
    case 'tax': return <svg {...p}><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>;
    case 'reg': return <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h4"/></svg>;
    case 'vat': return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M8 10h5a2.5 2.5 0 0 1 0 5H8V7h4.5"/></svg>;
    default: return <svg {...p}><circle cx="12" cy="12" r="4"/></svg>;
  }
}

function ArrowIcon({ size = 14 }: { size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return <svg {...p} aria-hidden><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>;
}

function TextLink({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button className="text-link" type="button" onClick={onClick}>
      <span>{children}</span>
      <span className="text-link__arrow"><ArrowIcon size={13} /></span>
    </button>
  );
}

function FeatureIcon({ id }: { id: string }) {
  const p = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'ai': return <svg {...p}><path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z"/><circle cx="18" cy="5" r="1.2" fill="currentColor" stroke="none"/><circle cx="6" cy="18" r="1.2" fill="currentColor" stroke="none"/></svg>;
    case 'price': return <svg {...p}><circle cx="12" cy="12" r="8"/><path d="M12 7v10M9 9.5c0-1.4 1.3-2.5 3-2.5s3 1.1 3 2.5-3 2.5-3 2.5 3 1.1 3 2.5-1.3 2.5-3 2.5-3-1.1-3-2.5"/></svg>;
    case 'track': return <svg {...p}><path d="M12 21s7-4.5 7-11a7 7 0 1 0-14 0c0 6.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.2"/></svg>;
    case 'platform': return <svg {...p}><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/></svg>;
    case 'form': return <svg {...p}><path d="M8 7h8M8 12h8M8 17h5"/><rect x="4" y="3" width="16" height="18" rx="2"/></svg>;
    case 'compare': return <svg {...p}><path d="M4 18V9M10 18V6M16 18v-7M20 18V8"/></svg>;
    case 'select': return <svg {...p}><path d="M9 12l2.2 2.2L16 9.5"/><circle cx="12" cy="12" r="8"/></svg>;
    case 'ship': return <svg {...p}><path d="M3 16h13l3-5h2v5h1"/><circle cx="7.5" cy="18.5" r="1.6"/><circle cx="16.5" cy="18.5" r="1.6"/><path d="M3 16V8h10v8"/></svg>;
    default: return <svg {...p}><circle cx="12" cy="12" r="4"/></svg>;
  }
}

function StepFlowIcon({ id }: { id: string }) {
  const p = {
    width: 28,
    height: 28,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.6',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (id) {
    case 'details':
      return (
        <svg {...p}>
          <path d="M8 7h8M8 11h8M8 15h5" />
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="M16.5 17.5l1.5 1.5 3-3" />
          <circle cx="17" cy="16" r="2.8" />
        </svg>
      );
    case 'ai':
      return (
        <svg {...p}>
          <path d="M5 18V8M9 18V5M13 18v-6M17 18V10M21 18V7" />
          <circle cx="17" cy="7" r="2.5" />
          <path d="M15.8 8.8L19 12" />
        </svg>
      );
    case 'carrier':
      return (
        <svg {...p}>
          <path d="M3 14h11l2.5-4H20v4h1" />
          <circle cx="7" cy="17" r="1.8" />
          <circle cx="17" cy="17" r="1.8" />
          <path d="M1 10h2M1 13h2M1 16h2" />
        </svg>
      );
    case 'track':
      return (
        <svg {...p}>
          <path d="M4 8h12v10H4z" />
          <path d="M8 8V6a2 2 0 0 1 2-2h4v4" />
          <path d="M16 12l2 2 3.5-3.5" />
        </svg>
      );
    default:
      return <svg {...p}><circle cx="12" cy="12" r="4" /></svg>;
  }
}

function MateHowItWorks() {
  const { t } = useI18n();
  const steps = [
    { icon: 'details', title: t('how.step1Title'), text: t('how.step1Text') },
    { icon: 'ai', title: t('how.step2Title'), text: t('how.step2Text') },
    { icon: 'carrier', title: t('how.step3Title'), text: t('how.step3Text') },
    { icon: 'track', title: t('how.step4Title'), text: t('how.step4Text') },
  ] as const;

  return (
    <section className="how-it-works how-it-works--timeline" aria-label={t('how.aria')}>
      <header className="how-it-works__head">
        <h2>{t('how.title')}</h2>
        <p>{t('how.lead')}</p>
      </header>
      <ol className="mate-steps">
        {steps.map((step, index) => (
          <li key={step.title} className="mate-step">
            <div className="mate-step__track" aria-hidden>
              <span className="mate-step__num">{index + 1}</span>
              {index < steps.length - 1 && <span className="mate-step__line" />}
            </div>
            <div className="mate-step__card">
              <div className="mate-step__icon">
                <StepFlowIcon id={step.icon} />
              </div>
              <div className="mate-step__body">
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PartnersHandshakeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 12.5 7.5 9l2.8 2.8M20 12.5 16.5 9l-2.8 2.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 11.5 12 14l2.5-2.5M14.5 11.5 12 14l-2.5-2.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 16.5c1.2 1.2 2.4 1.8 4 1.8s2.8-.6 4-1.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function PartnersSection({ about = false }: { about?: boolean }) {
  const { t } = useI18n();
  return (
    <section
      className={`partners-showcase${about ? ' partners-showcase--about card' : ''}`}
      aria-label={t('partners.aria')}
    >
      <header className="partners-showcase__head">
        <span className="partners-showcase__eyebrow">
          <PartnersHandshakeIcon size={15} />
          {t('partners.eyebrow')}
        </span>
        <h2 className="partners-showcase__title">{t('partners.title')}</h2>
        <p className="partners-showcase__lead">
          {t('partners.lead')}
        </p>
      </header>
      <div className="partners-showcase__grid">
        {PARTNER_IDS.map((id) => (
          <div key={id} className="partners-showcase__card">
            <PartnerLogo id={id} />
            <span className="partners-showcase__chev" aria-hidden>›</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function App() {
  const { t } = useI18n();
  const [page, setPage] = useState<TopPage>(() => (
    window.location.pathname.replace(/\/+$/, '') === '/admin' ? 'admin' : 'home'
  ));
  const [filter, setFilter] = useState<ServiceFilter>('all');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [calcOpen, setCalcOpen] = useState(false);
  const [calcResumeSignal, setCalcResumeSignal] = useState(0);
  const [draftTick, setDraftTick] = useState(0);
  const [dashNav, setDashNav] = useState<{ tab: ClientDashTab; openCalc?: boolean } | null>(null);
  const [ordersRefresh, setOrdersRefresh] = useState(0);
  const [clientAuthMode, setClientAuthMode] = useState<ClientAuthMode | null>(null);
  const [clientAuthStep, setClientAuthStep] = useState(0);
  const [corpRegOpen, setCorpRegOpen] = useState(false);
  const [corpRegStep, setCorpRegStep] = useState(0);
  const [regVol, setRegVol] = useState('1000–5000');
  const [dashboardType, setDashboardType] = useState<'client' | 'corp'>('client');
  const [paymentNotice, setPaymentNotice] = useState<{
    type: 'success' | 'cancel' | 'error';
    order?: ShippingOrder;
    message?: string;
  } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [heroCalcStep, setHeroCalcStep] = useState(1);
  const [calcResetSignal, setCalcResetSignal] = useState(0);
  const [calcFocusDesktop, setCalcFocusDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 901px)').matches : false,
  );
  // Focus/blur only on desktop; mobile keeps the calculator in place without overlay.
  const calcFocused = page === 'home' && heroCalcStep > 1 && calcFocusDesktop;

  const activeDraft = useMemo(() => {
    void draftTick;
    const draft = loadActiveCalcDraft(user?.id);
    return draft && isMeaningfulCalcDraft(draft) ? draft : null;
  }, [user?.id, draftTick]);

  const showDraftCart = Boolean(
    activeDraft
    && page !== 'admin'
    && !calcOpen
    && !(page === 'home' && heroCalcStep > 1),
  );
  const [calcModalKey, setCalcModalKey] = useState(0);
  const [calcModalResume, setCalcModalResume] = useState(false);

  const resumeDraftStep = useCallback(() => {
    const resumeStep = activeDraft?.step ?? 1;
    setHeroCalcStep(resumeStep);
    document.querySelector('.hero-module')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setCalcResumeSignal((n) => n + 1);
  }, [activeDraft?.step]);

  const handleContinueDraft = useCallback(() => {
    if (page === 'home') {
      resumeDraftStep();
      return;
    }
    // From dashboard and other pages — open modal immediately with saved draft.
    setCalcModalResume(true);
    setCalcModalKey((n) => n + 1);
    setCalcOpen(true);
  }, [page, resumeDraftStep]);

  const openCalcFresh = useCallback(() => {
    setCalcModalResume(false);
    setCalcOpen(true);
  }, []);

  const handleDismissDraft = useCallback(() => {
    clearCalcDraft(true, user?.id);
    clearCalcDraft(false, user?.id);
    setDraftTick((n) => n + 1);
  }, [user?.id]);

  const dismissCalcFocus = useCallback(() => {
    setCalcResetSignal((n) => n + 1);
    setHeroCalcStep(1);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 901px)');
    const sync = () => setCalcFocusDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!calcFocused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissCalcFocus();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [calcFocused, dismissCalcFocus]);

  useEffect(() => {
    const onDraftChange = () => setDraftTick((n) => n + 1);
    window.addEventListener(CALC_DRAFT_EVENT, onDraftChange);
    return () => window.removeEventListener(CALC_DRAFT_EVENT, onDraftChange);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    mergeGuestDraftIntoCart(user.id);
    setDraftTick((n) => n + 1);
  }, [user?.id]);

  const goPage = useCallback((next: TopPage) => {
    setPage(next);
    setMenuOpen(false);
    setHeroCalcStep(1);
    if (next === 'home') {
      setCalcOpen(false);
      setCalcModalResume(false);
      setCalcResetSignal((n) => n + 1);
      setCalcResumeSignal(0);
    }
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    setMenuOpen(false);
  }, [page]);

  useEffect(() => {
    const goAdmin = () => {
      if (window.location.pathname.replace(/\/+$/, '') === '/admin') setPage('admin');
    };
    window.addEventListener('popstate', goAdmin);
    return () => window.removeEventListener('popstate', goAdmin);
  }, []);

  useEffect(() => {
    if (page === 'admin') {
      if (window.location.pathname.replace(/\/+$/, '') !== '/admin') {
        window.history.pushState({}, '', '/admin');
      }
      return;
    }
    if (window.location.pathname.replace(/\/+$/, '') === '/admin') {
      window.history.pushState({}, '', '/');
    }
  }, [page]);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) return;
    fetchMe(token)
      .then(({ user: me }) => {
        setUser(me);
        setDashboardType(me.type === 'corp' ? 'corp' : 'client');
      })
      .catch(() => clearSession());
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    const token = params.get('token');
    if (payment === 'success' && token) {
      resumePaymentFromUrl(token)
        .then(async (order) => {
          setPaymentNotice({ type: 'success', order });
          setOrdersRefresh((n) => n + 1);
          const sessionToken = getStoredToken();
          if (sessionToken) {
            try {
              const { user: me } = await fetchMe(sessionToken);
              setUser(me);
            } catch {
              /* loyalty/orders refresh still updates discount visibility */
            }
          }
          setPage(user ? 'client-dashboard' : 'home');
        })
        .catch((err) => {
          setPaymentNotice({
            type: 'error',
            message: err instanceof Error ? err.message : t('payment.confirmError'),
          });
        })
        .finally(() => {
          window.history.replaceState({}, '', window.location.pathname);
        });
    } else if (payment === 'cancel') {
      setPaymentNotice({ type: 'cancel', message: t('payment.cancelMsg') });
      window.history.replaceState({}, '', window.location.pathname);
      if (user) setPage('client-dashboard');
    }
  }, [user]);

  const handleAuthSuccess = useCallback((authUser: AuthUser, token: string) => {
    storeSession(token);
    mergeGuestDraftIntoCart(authUser.id);
    setUser(authUser);
    setDashboardType(authUser.type === 'corp' ? 'corp' : 'client');
    setDraftTick((n) => n + 1);
  }, []);

  const openClientAuth = useCallback((mode: ClientAuthMode) => {
    setClientAuthMode(mode);
    setClientAuthStep(0);
  }, []);

  const closeClientAuth = useCallback(() => {
    setClientAuthMode(null);
    setClientAuthStep(0);
    if (user) {
      setDashNav({ tab: 'home' });
      setPage('client-dashboard');
    }
  }, [user]);

  const handleAuthNavigate = useCallback((target: ClientOnboardingTarget) => {
    setClientAuthMode(null);
    setClientAuthStep(0);
    setPage('client-dashboard');
    if (target === 'shipment') {
      setDashNav({ tab: 'home', openCalc: true });
    } else if (target === 'address') {
      setDashNav({ tab: 'address' });
    } else {
      setDashNav({ tab: 'payments' });
    }
  }, []);

  const handleLogout = useCallback(() => {
    clearSession();
    setUser(null);
    goPage('home');
  }, [goPage]);

  useEffect(() => {
    if (corpRegStep === 1) {
      const t = setTimeout(() => setCorpRegStep(2), 2800);
      return () => clearTimeout(t);
    }
  }, [corpRegStep]);

  const localizedServices = useMemo(() => services.map((s) => {
    const titleKey = s.id === 'all' ? 'services.intlTitle' : `services.${s.id}Title`;
    const descKey = s.id === 'all' ? 'services.intlDesc' : `services.${s.id}Desc`;
    return {
      ...s,
      title: t(titleKey),
      description: t(descKey),
    };
  }), [t]);

  const filteredServices = useMemo(() => {
    if (filter === 'all') return localizedServices;
    return localizedServices.filter((s) => s.id === filter);
  }, [filter, localizedServices]);

  const serviceLabel = useCallback((id: string) => {
    if (id === 'all') return t('services.filterAll');
    const titleKey = `services.${id}Title`;
    const label = t(titleKey);
    return label === titleKey ? id : label;
  }, [t]);

  const inDashboard = page === 'dashboard' || page === 'client-dashboard';

  if (page === 'admin') {
    return (
      <AdminApp
        onExit={() => {
          goPage('home');
          window.history.pushState({}, '', '/');
        }}
      />
    );
  }

  return (
    <div className={`mate-app${menuOpen ? ' mate-app--menu-open' : ''}${calcFocused ? ' mate-app--calc-focus' : ''}`}>
      {!inDashboard && calcFocused && (
        <button
          type="button"
          className="calc-focus-backdrop"
          aria-label={t('calc.focusBackdropAria')}
          onClick={dismissCalcFocus}
        />
      )}
      {!inDashboard && (
      <header className="topbar container">
          <button
          className="brand"
          type="button"
          onClick={() => goPage('home')}
          aria-label={t('nav.homeAria')}
        >
          <MateLogo height={62} />
        </button>

        <nav className="main-nav" aria-label={t('nav.mainAria')}>
          <button
            className={`nav-link ${page === 'services' ? 'active' : ''}`}
            onClick={() => goPage('services')}
            type="button"
          >
            {t('nav.services')}
          </button>
          <button
            className={`nav-link ${page === 'about' ? 'active' : ''}`}
            onClick={() => goPage('about')}
            type="button"
          >
            {t('nav.about')}
          </button>
        </nav>

        <div className="top-actions top-actions--desktop">
          <LanguageSelect />
          {user ? (
            <button
              className="btn btn-lime"
              type="button"
              onClick={() => goPage(dashboardType === 'corp' ? 'dashboard' : 'client-dashboard')}
            >
              {t('nav.dashboard')}
            </button>
          ) : (
            <>
              <button className="btn btn-ghost" type="button" onClick={() => openClientAuth('login')}>{t('nav.login')}</button>
              <button className="btn btn-lime" type="button" onClick={() => openClientAuth('register')}>{t('nav.register')}</button>
            </>
          )}
        </div>

        <div className="top-actions top-actions--mobile">
          <LanguageSelect variant="compact" />
        </div>

        <button
          type="button"
          className={`menu-toggle${menuOpen ? ' is-open' : ''}`}
          aria-label={menuOpen ? t('nav.closeMenu') : t('nav.openMenu')}
          aria-expanded={menuOpen}
          aria-controls="site-mobile-menu"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className="menu-toggle__grid" aria-hidden>
            <i /><i /><i /><i />
          </span>
        </button>
      </header>
      )}

      {!inDashboard && menuOpen && (
        <div className="mobile-menu" id="site-mobile-menu" role="dialog" aria-modal="true" aria-label={t('nav.menuAria')}>
          <button
            type="button"
            className="mobile-menu__backdrop"
            aria-label={t('nav.closeMenu')}
            onClick={() => setMenuOpen(false)}
          />
          <div className="mobile-menu__panel">
            <nav className="mobile-menu__nav">
              <button
                type="button"
                className={`mobile-menu__link${page === 'services' ? ' is-active' : ''}`}
                onClick={() => goPage('services')}
              >
                <span className="mobile-menu__link-label">{t('nav.services')}</span>
                <span className="mobile-menu__chev" aria-hidden>→</span>
              </button>
              <button
                type="button"
                className={`mobile-menu__link${page === 'about' ? ' is-active' : ''}`}
                onClick={() => goPage('about')}
              >
                <span className="mobile-menu__link-label">{t('nav.about')}</span>
                <span className="mobile-menu__chev" aria-hidden>→</span>
              </button>
              <button
                type="button"
                className={`mobile-menu__link${page === 'home' ? ' is-active' : ''}`}
                onClick={() => goPage('home')}
              >
                <span className="mobile-menu__link-label">{t('nav.home')}</span>
                <span className="mobile-menu__chev" aria-hidden>→</span>
              </button>
            </nav>

            <div className="mobile-menu__actions">
              {user ? (
                <button
                  className="btn btn-lime"
                  type="button"
                  onClick={() => goPage(dashboardType === 'corp' ? 'dashboard' : 'client-dashboard')}
                >
                  {t('nav.dashboard')}
                </button>
              ) : (
                <>
                  <button
                    className="btn btn-lime"
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      openClientAuth('register');
                    }}
                  >
                    {t('nav.register')}
                  </button>
                  <button
                    className="btn btn-outline"
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      openClientAuth('login');
                    }}
                  >
                    {t('nav.login')}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {!inDashboard && (page === 'home' ? (
        <main className="container page-enter home-page">
          <section className="hero-grid" aria-label="Mate Delivery">
            <div className="hero-copy">
              <div className="ai-badge">
                <span className="ai-badge__star" aria-hidden>✦</span>
                <span className="ai-badge__text">{t('home.badge')}</span>
              </div>
              <h1>
                {t('home.titleYou')}<br />
                <span className="hero-logo-word" aria-label="MATE">
                  <MateLogo height={68} />
                </span>{' '}
                {t('home.titleMate')}
                <br />
                <span className="hero-highlight">{t('home.titleRest')}</span>
              </h1>
              <p className="hero-lead">
                {t('home.lead')}
              </p>
              <div className="hero-actions">
                <button className="btn btn-lime" type="button" onClick={openCalcFresh}>
                  {t('common.start')}
                </button>
                <button className="btn btn-outline" type="button" onClick={() => setPage('services')}>
                  {t('nav.services')}
                </button>
              </div>
              <div className="hero-trust">{t('home.trust')}</div>
            </div>
            <div className="hero-module">
              <CalcCard
                user={user}
                onOrderSuccess={() => setOrdersRefresh((n) => n + 1)}
                onStepChange={setHeroCalcStep}
                resetToStep1Signal={calcResetSignal}
                resumeSignal={calcResumeSignal}
              />
            </div>
          </section>

          <PartnersSection />

          <section className="features home-features" aria-label={t('home.featuresTitle')}>
            <header className="home-features__head">
              <span className="home-features__eyebrow">{t('home.featuresEyebrow')}</span>
              <h2>{t('home.featuresTitle')}</h2>
              <p>{t('home.featuresLead')}</p>
            </header>
            <div className="home-features__grid">
              <article className="feature-card">
                <div className="feature-icon feature-icon--ai"><FeatureIcon id="ai" /></div>
                <h3>{t('home.featureAiTitle')}</h3>
                <p>{t('home.featureAiText')}</p>
              </article>
              <article className="feature-card">
                <div className="feature-icon feature-icon--price"><FeatureIcon id="price" /></div>
                <h3>{t('home.featurePriceTitle')}</h3>
                <p>{t('home.featurePriceText')}</p>
              </article>
              <article className="feature-card">
                <div className="feature-icon feature-icon--track"><FeatureIcon id="track" /></div>
                <h3>{t('home.featureTrackTitle')}</h3>
                <p>{t('home.featureTrackText')}</p>
              </article>
              <article className="feature-card">
                <div className="feature-icon feature-icon--platform"><FeatureIcon id="platform" /></div>
                <h3>{t('home.featurePlatformTitle')}</h3>
                <p>{t('home.featurePlatformText')}</p>
              </article>
            </div>
          </section>

          <MateHowItWorks />
        </main>
      ) : page === 'business' ? (
        <main className="container page-enter">
          {/* ── HERO ── */}
          <section className="biz-hero card">
            <div className="biz-hero__map" aria-hidden>
              <svg className="biz-map-svg" viewBox="0 0 600 360" fill="none">
                <defs>
                  <pattern id="map-dots" x="0" y="0" width="14" height="14" patternUnits="userSpaceOnUse">
                    <circle cx="7" cy="7" r="1.7" fill="#122023" fillOpacity="0.18"/>
                  </pattern>
                </defs>
                <rect width="600" height="360" fill="url(#map-dots)"/>
                {/* spokes from hub */}
                {([[95,80],[190,38],[325,45],[462,72],[495,198],[378,292],[185,282],[48,208]] as [number,number][]).map(([x,y],i)=>(
                  <line key={i} x1="232" y1="158" x2={x} y2={y} stroke="#E1FF01" strokeWidth="1.3" strokeOpacity="0.5"/>
                ))}
                {([[95,80],[190,38],[325,45],[462,72],[495,198],[378,292],[185,282],[48,208]] as [number,number][]).map(([x,y],i)=>(
                  <circle key={i} cx={x} cy={y} r="4.2" fill="#E1FF01" fillOpacity="0.88"/>
                ))}
                <circle cx="232" cy="158" r="7" fill="#E1FF01"/>
                <circle cx="232" cy="158" r="14" stroke="#E1FF01" strokeWidth="1.5" strokeOpacity="0.3"/>
                <circle cx="232" cy="158" r="22" stroke="#E1FF01" strokeWidth="0.8" strokeOpacity="0.15"/>
              </svg>
            </div>
            <div className="biz-hero__copy">
              <div className="biz-badge">✦ MATE FOR BUSINESS</div>
              <h1>Логистика, которая<br /><span>усиливает</span> ваш бизнес</h1>
              <p>Доставка, склады, фулфилмент, возвраты, интеграции и аналитика — всё, что нужно для роста компании. В одной платформе.</p>
              <div className="biz-hero__btns">
                <button className="btn btn-lime" type="button" onClick={() => { setCorpRegOpen(true); setCorpRegStep(0); }}>Стать клиентом →</button>
                <button className="btn btn-outline" type="button">Связаться с нами</button>
              </div>
              <div className="hero-trust">Нам доверяют 1000+ компаний</div>
            </div>
          </section>

          {/* ── SOLUTIONS ── */}
          <section className="page-section">
            <h2 className="biz-section-title">Все логистические решения для вашего бизнеса</h2>
            <div className="biz-solutions">
              {bizSolutions.map((s) => (
                <article key={s.id} className="biz-card card">
                  <div className="biz-card__icon"><ServiceSvgIcon id={s.svgId} size={26} /></div>
                  <h3>{s.title}</h3>
                  <p>{s.desc}</p>
                  <TextLink>Подробнее</TextLink>
                </article>
              ))}
            </div>
          </section>

          {/* ── STATSBAR ── */}
          <section className="biz-statsbar card page-section">
            <div className="biz-statsbar__label"><b>MATE — надёжный<br />партнёр для бизнеса<br />по всей Европе</b></div>
            <div className="biz-statsbar__items">
              {bizStats.map((s) => (
                <div key={s.num} className="biz-stat">
                  <ServiceSvgIcon id={s.icon} size={22} />
                  <div><b>{s.num}</b><span>{s.label}</span></div>
                </div>
              ))}
            </div>
          </section>

          {/* ── HOW IT WORKS ── */}
          <section className="biz-how card page-section">
            <h2 className="biz-section-title">Как это работает</h2>
            <div className="biz-steps">
              {bizSteps.map((s, i) => (
                <div key={s.n} className="biz-step-wrap">
                  <div className="biz-step">
                    <div className="biz-step__num">{s.n}</div>
                    <ServiceSvgIcon id={s.icon} size={24} />
                    <b>{s.title}</b>
                    <p>{s.desc}</p>
                  </div>
                  {i < bizSteps.length - 1 && (
                    <span className="biz-step__arr" aria-hidden><ArrowIcon size={16} /></span>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* ── INTEGRATIONS ── */}
          <section className="biz-integrations card page-section">
            <h2 className="biz-section-title">Интеграции без границ</h2>
            <p className="biz-section-sub">Подключайтесь к популярным платформам и управляйте логистикой из одного кабинета.</p>
            <div className="biz-int-logos">
              {[{c:'#96bf48',l:'shopify'},{c:'#7f54b3',l:'WooCommerce'},{c:'#f26322',l:'Magento'},{c:'#1da1f2',l:'opencart'},{c:'#df0067',l:'PrestaShop'},{c:'#ff9900',l:'amazon'},{c:'#e53238',l:'ebay'},{c:'#122023',l:'⚙ API'}].map((p) => (
                <span key={p.l} className="biz-int-logo" style={{ color: p.c }}>{p.l}</span>
              ))}
            </div>
            <TextLink>Смотреть все интеграции</TextLink>
          </section>

          {/* ── CTA ── */}
          <section className="biz-cta page-section">
            <div className="biz-cta__copy">
              <h2>Готовы масштабировать<br />ваш бизнес с <span className="biz-cta__accent">MATE?</span></h2>
              <p>Присоединяйтесь к тысячам компаний, которые уже доверяют нам свою логистику и сосредоточены на росте.</p>
              <div className="biz-cta__btns">
                <button className="btn btn-lime" type="button" onClick={() => { setCorpRegOpen(true); setCorpRegStep(0); }}>Начать сотрудничество →</button>
                <button className="btn biz-cta__ghost" type="button">Связаться с нами</button>
              </div>
            </div>
            <div className="biz-cta__img" aria-hidden><div className="biz-cta__truck">MATE.</div></div>
          </section>
        </main>
      ) : page === 'services' ? (
        <main className="container page-enter">
          <section className="services-hero card">
            <div className="world-fx world-fx--services" aria-hidden />
            <h1>{t('services.heroTitle')}</h1>
            <p>
              {t('services.heroLead')}
            </p>
          </section>

          <section className="services-layout">
            <aside className="services-sidebar card">
              {([
                'all',
                'parcel',
                'cargo',
                'warehouse',
                'fulfillment',
                'express',
                'returns',
                'tracking',
              ] as ServiceFilter[]).map((id) => {
                const soon = id !== 'all' && id !== 'parcel';
                return (
                  <button
                    key={id}
                    type="button"
                    className={`side-link ${filter === id ? 'active' : ''}${soon ? ' side-link--soon' : ''}`}
                    onClick={() => setFilter(id)}
                  >
                    <span className="side-link__icon"><ServiceSvgIcon id={id} size={16} /></span>
                    <span className="side-link__text">{serviceLabel(id)}</span>
                    {soon && <small className="side-link__soon">{t('common.soon')}</small>}
                  </button>
                );
              })}
            </aside>

            <div className="services-grid">
              {filteredServices.map((service) => (
                <article key={service.id} className="service-card card">
                  <div className="service-icon">
                    <ServiceSvgIcon id={service.id} size={26} />
                  </div>
                  <h3>
                    {service.title}{service.soon && <small>{t('common.soon')}</small>}
                  </h3>
                  <p>{service.description}</p>
                  <TextLink
                    onClick={
                      service.id === 'parcel'
                        ? openCalcFresh
                        : undefined
                    }
                  >
                    {t('services.learnMore')}
                  </TextLink>
                </article>
              ))}
            </div>
          </section>

          <section className="stats card page-section">
            <div>
              <div className="stat-icon"><ServiceSvgIcon id="all" size={24} /></div>
              <div className="stat-text"><b>{t('services.statBlock1Title')}</b><span>{t('services.statBlock1Sub')}</span></div>
            </div>
            <div>
              <div className="stat-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              </div>
              <div className="stat-text"><b>{t('services.statBlock2Title')}</b><span>{t('services.statBlock2Sub')}</span></div>
            </div>
            <div>
              <div className="stat-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
              </div>
              <div className="stat-text"><b>{t('services.statBlock3Title')}</b><span>{t('services.statBlock3Sub')}</span></div>
            </div>
            <div>
              <div className="stat-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
                  <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/>
                  <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
                </svg>
              </div>
              <div className="stat-text"><b>{t('about.support247')}</b><span>{t('about.support247Sub')}</span></div>
            </div>
          </section>
        </main>
      ) : page === 'about' ? (
        <main className="container page-enter about-page">
          <section className="about-top">
            <div className="about-hero card">
              <div className="about-hero__glow" aria-hidden />
              <div className="about-hero__inner">
                <div className="about-hero__copy">
                  <div className="about-badge">{t('about.badge')}</div>
                  <h1>
                    {t('about.titleLine1')}<br />
                    <span>{t('about.titleLine2')}</span>
                  </h1>
                  <p>
                    {t('about.pageLead')}
                  </p>
                  <button className="about-video" type="button">
                    <span className="about-play" aria-hidden>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="8 5 19 12 8 19 8 5"/></svg>
                    </span>
                    {t('about.watchVideo')}
                  </button>
                </div>
                <div className="about-hero__map" aria-hidden>
                  <svg className="about-map-svg" viewBox="0 0 600 360" fill="none">
                    <defs>
                      <pattern id="about-map-dots" x="0" y="0" width="14" height="14" patternUnits="userSpaceOnUse">
                        <circle cx="7" cy="7" r="1.7" fill="#122023" fillOpacity="0.16"/>
                      </pattern>
                      <radialGradient id="about-map-glow" cx="0.5" cy="0.5" r="0.5">
                        <stop offset="0%" stopColor="#E1FF01" stopOpacity="0.28"/>
                        <stop offset="100%" stopColor="#E1FF01" stopOpacity="0"/>
                      </radialGradient>
                    </defs>
                    <rect width="600" height="360" fill="url(#about-map-dots)"/>
                    <circle cx="300" cy="180" r="120" fill="url(#about-map-glow)"/>
                    {([[95,80],[190,38],[325,45],[462,72],[495,198],[378,292],[185,282],[48,208]] as [number,number][]).map(([x,y],i)=>(
                      <line key={`l${i}`} x1="232" y1="158" x2={x} y2={y} stroke="#E1FF01" strokeWidth="1.4" strokeOpacity="0.72"/>
                    ))}
                    {([[95,80],[190,38],[325,45],[462,72],[495,198],[378,292],[185,282],[48,208]] as [number,number][]).map(([x,y],i)=>(
                      <circle key={`c${i}`} cx={x} cy={y} r="4.2" fill="#E1FF01" fillOpacity="0.92"/>
                    ))}
                    <circle cx="232" cy="158" r="8" fill="#E1FF01"/>
                    <circle cx="232" cy="158" r="16" stroke="#E1FF01" strokeWidth="1.5" strokeOpacity="0.4"/>
                    <circle cx="232" cy="158" r="26" stroke="#E1FF01" strokeWidth="0.8" strokeOpacity="0.2"/>
                  </svg>
                </div>
              </div>
            </div>

            <aside className="about-contact card">
              <div className="about-contact__badge">{t('about.contactBadge')}</div>
              <h2>{t('about.contactTitle')}</h2>
              <p>{t('about.contactLead')}</p>
              <ul className="about-contact__list">
                {aboutContacts.map((c) => (
                  <li key={c.id}>
                    <a
                      className="about-contact__item"
                      href={c.href}
                      target={c.href.startsWith('http') ? '_blank' : undefined}
                      rel={c.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                    >
                      <span className="about-contact__icon"><ContactIcon id={c.id} size={17} /></span>
                      <span className="about-contact__text">
                        <small>{c.id === 'email' ? t('about.emailLabel') : c.id === 'phone' ? t('about.phoneLabel') : c.id === 'whatsapp' ? t('about.whatsappLabel') : c.id === 'support' ? t('about.supportLabel') : c.label}</small>
                        <b>{c.id === 'support' ? t('about.supportValue') : c.value}</b>
                      </span>
                      <span className="about-contact__arr"><ArrowIcon size={14} /></span>
                    </a>
                  </li>
                ))}
              </ul>
              <a className="btn btn-lime about-contact__cta" href="mailto:Info@matedelivery.com">
                {t('about.writeUs')}
                <ArrowIcon size={14} />
              </a>
            </aside>
          </section>

          <section className="about-stats" aria-label={t('about.statsAria')}>
            {aboutStatDefs.map((s, i) => (
              <article
                key={s.icon}
                className="about-stat card"
                style={{ '--delay': `${80 + i * 60}ms` } as React.CSSProperties}
              >
                <div className="about-stat__icon"><ServiceSvgIcon id={s.icon} size={22} /></div>
                <div className="about-stat__text">
                  <b>{s.num}</b>
                  <span>{t(`about.${s.labelKey}`)}</span>
                </div>
              </article>
            ))}
          </section>

          <PartnersSection about />

          <section className="about-features" aria-label={t('about.featuresTitle')}>
            <header className="about-features__head">
              <span className="about-features__eyebrow">{t('about.featuresEyebrow')}</span>
              <h2>{t('about.featuresTitle')}</h2>
              <p>{t('about.featuresLead')}</p>
            </header>
            <div className="about-features__grid">
              <article className="about-feature-card" style={{ '--delay': '40ms' } as React.CSSProperties}>
                <div className="feature-icon feature-icon--ai"><FeatureIcon id="ai" /></div>
                <h3>{t('home.featureAiTitle')}</h3>
                <p>{t('home.featureAiText')}</p>
              </article>
              <article className="about-feature-card" style={{ '--delay': '100ms' } as React.CSSProperties}>
                <div className="feature-icon feature-icon--price"><FeatureIcon id="price" /></div>
                <h3>{t('home.featurePriceTitle')}</h3>
                <p>{t('home.featurePriceText')}</p>
              </article>
              <article className="about-feature-card" style={{ '--delay': '160ms' } as React.CSSProperties}>
                <div className="feature-icon feature-icon--track"><FeatureIcon id="track" /></div>
                <h3>{t('home.featureTrackTitle')}</h3>
                <p>{t('home.featureTrackText')}</p>
              </article>
              <article className="about-feature-card" style={{ '--delay': '220ms' } as React.CSSProperties}>
                <div className="feature-icon feature-icon--platform"><FeatureIcon id="platform" /></div>
                <h3>{t('home.featurePlatformTitle')}</h3>
                <p>{t('home.featurePlatformText')}</p>
              </article>
            </div>
          </section>

          <footer className="about-legal" aria-label={t('about.legalTitle')}>
            <div className="about-legal__brand">
              <span className="about-legal__badge" aria-hidden>
                <ContactIcon id="company" size={16} />
              </span>
              <div>
                <div className="about-legal__title">{t('about.legalTitle')}</div>
                <strong className="about-legal__company-name">{t('about.legalCompany')}</strong>
              </div>
            </div>
            <ul className="about-legal__list">
              {([
                { id: 'pin', label: t('about.legalAddressLabel'), value: t('about.legalAddress') },
                { id: 'tax', label: t('about.legalTaxLabel'), value: t('about.legalTaxValue') },
                { id: 'reg', label: t('about.legalRegLabel'), value: t('about.legalRegValue') },
                { id: 'vat', label: t('about.legalVatLabel'), value: t('about.legalVatValue') },
              ] as const).map((row) => (
                <li key={row.id} className="about-legal__row">
                  <span className="about-legal__icon"><ContactIcon id={row.id} size={15} /></span>
                  <span className="about-legal__text">
                    <small>{row.label}</small>
                    <b>{row.value}</b>
                  </span>
                </li>
              ))}
            </ul>
          </footer>
        </main>
      ) : null)}

      {clientAuthMode && (
        <ClientAuthModal
          mode={clientAuthMode}
          step={clientAuthStep}
          onClose={closeClientAuth}
          onSwitchMode={setClientAuthMode}
          onStepChange={setClientAuthStep}
          onSuccess={handleAuthSuccess}
          onNavigate={handleAuthNavigate}
        />
      )}

      {corpRegOpen && (
        <div
          className="reg-overlay"
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) { setCorpRegOpen(false); setCorpRegStep(0); } }}
        >
          <div className={`reg-modal reg-modal--step${corpRegStep}`}>

            {/* ── STEP 0: FORM ── */}
            {corpRegStep === 0 && (
              <div className="reg-s1">
                <button className="reg-close" type="button" onClick={() => { setCorpRegOpen(false); setCorpRegStep(0); }}>✕</button>
                <div className="reg-left">
                  <div className="reg-logo">MATE<span>.</span></div>
                  <h2>Создайте корпоративный аккаунт за 1 минуту</h2>
                  <p>Получите доступ ко всем возможностям платформы и индивидуальные условия для вашего бизнеса.</p>
                  <ul className="reg-benefits">
                    <li><span className="reg-check">✓</span>Индивидуальные тарифы под ваш объём</li>
                    <li><span className="reg-check">✓</span>Персональный менеджер и поддержка 24/7</li>
                    <li><span className="reg-check">✓</span>Все логистические решения в одной платформе</li>
                  </ul>
                  <div className="reg-privacy">🔒 Ваши данные защищены и не будут переданы третьим лицам</div>
                </div>
                <div className="reg-right">
                  <div className="reg-progress">
                    <span className="reg-prog-step active">1</span>
                    <span className="reg-prog-line" />
                    <span className="reg-prog-step">2</span>
                    <span className="reg-prog-line" />
                    <span className="reg-prog-step">3</span>
                  </div>
                  <h3>Расскажите о вашей компании</h3>
                  <label className="reg-field"><span>Название компании</span><input placeholder="ООО «Ваша компания»" type="text" /></label>
                  <label className="reg-field">
                    <span>Страна</span>
                    <select><option>Венгрия</option><option>Германия</option><option>Польша</option><option>Франция</option><option>Украина</option></select>
                  </label>
                  <label className="reg-field"><span>Email</span><input placeholder="name@company.com" type="email" /></label>
                  <label className="reg-field"><span>Телефон</span><input placeholder="+7 (...)" type="tel" /></label>
                  <div className="reg-vol-label">Сколько отправлений в месяц?</div>
                  <div className="reg-vol-btns">
                    {['До 100', '100–500', '500–1000', '1000–5000', '5000+'].map((v) => (
                      <button key={v} type="button" className={`reg-vol-btn${regVol === v ? ' active' : ''}`} onClick={() => setRegVol(v)}>{v}</button>
                    ))}
                  </div>
                  {(regVol === '1000–5000' || regVol === '5000+') && (
                    <p className="reg-vol-note">Для вашего объёма мы подготовим индивидуальные тарифы и персонального менеджера.</p>
                  )}
                  <button className="btn btn-lime reg-submit" type="button" onClick={() => setCorpRegStep(1)}>
                    Создать корпоративный аккаунт
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 1: PROCESSING ── */}
            {corpRegStep === 1 && (
              <div className="reg-s2">
                <div className="reg-s2__left">
                  <div className="reg-logo">MATE<span>.</span></div>
                  <h2>Создаём ваш<br />корпоративный аккаунт</h2>
                  <p>Это займёт всего несколько секунд</p>
                  <ul className="reg-checklist">
                    <li className="done"><span className="reg-check-circle">✓</span>Создаём аккаунт</li>
                    <li className="anim1"><span className="reg-check-circle">✓</span>Настраиваем рабочее пространство</li>
                    <li className="anim2"><span className="reg-check-empty">○</span>Подключаем тарифы и условия</li>
                    <li className="anim3"><span className="reg-check-empty">○</span>Готово!</li>
                  </ul>
                </div>
                <div className="reg-s2__right">
                  <div className="reg-illustration">
                    <span>📦</span>
                    <span className="reg-illu-truck">🚚</span>
                    <span className="reg-illu-globe">🌍</span>
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP 2: SUCCESS ── */}
            {corpRegStep === 2 && (
              <div className="reg-s3">
                <div className="reg-logo">MATE<span>.</span></div>
                <div className="reg-success-icon">✓</div>
                <h2>Добро пожаловать<br />в MATE!</h2>
                <p>Ваш корпоративный аккаунт успешно создан.</p>
                <div className="reg-next-label">Что дальше?</div>
                <ul className="reg-next-list">
                  <li>
                    <div className="reg-next-icon"><ServiceSvgIcon id="parcel" size={18} /></div>
                    <div><b>Создайте первую отправку</b><span>Рассчитайте стоимость и отправьте посылку</span></div>
                    <span className="reg-next-arr">→</span>
                  </li>
                  <li>
                    <div className="reg-next-icon"><ServiceSvgIcon id="customs" size={18} /></div>
                    <div><b>Подключите ваш магазин</b><span>Интегрируйте Shopify, WooCommerce и другие платформы</span></div>
                    <span className="reg-next-arr">→</span>
                  </li>
                  <li>
                    <div className="reg-next-icon"><ServiceSvgIcon id="fulfillment" size={18} /></div>
                    <div><b>Получите индивидуальный тариф</b><span>Наш менеджер свяжется с вами в ближайшее время</span></div>
                    <span className="reg-next-arr">→</span>
                  </li>
                </ul>
                <button className="btn btn-lime reg-submit" type="button" onClick={() => { setCorpRegOpen(false); setCorpRegStep(0); setDashboardType('corp'); setPage('dashboard'); }}>
                  Перейти в личный кабинет
                </button>
              </div>
            )}

          </div>
        </div>
      )}

      {/* ── PAYMENT NOTICE ── */}
      {paymentNotice && paymentNotice.type === 'success' && paymentNotice.order ? (
        <OrderSuccessScreen
          order={paymentNotice.order}
          onTrack={() => {
            setPaymentNotice(null);
            if (user) {
              setDashNav({ tab: 'tracking' });
              setPage('client-dashboard');
            } else {
              goPage('home');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }}
          onCreateAnother={() => {
            setPaymentNotice(null);
            clearCalcDraft(false, user?.id);
            clearCalcDraft(true, user?.id);
            goPage('home');
            openCalcFresh();
          }}
          onOpenDashboard={user ? () => {
            setPaymentNotice(null);
            setDashNav({ tab: 'shipments' });
            setPage('client-dashboard');
          } : undefined}
        />
      ) : paymentNotice && (
        <div className="payment-notice-overlay" role="dialog" aria-modal="true">
          <div className={`payment-notice card payment-notice--${paymentNotice.type}`}>
            {paymentNotice.type === 'cancel' && (
              <>
                <div className="payment-notice__icon payment-notice__icon--muted">!</div>
                <h2>{t('payment.cancelTitle')}</h2>
                <p>{paymentNotice.message}</p>
              </>
            )}
            {paymentNotice.type === 'error' && (
              <>
                <div className="payment-notice__icon payment-notice__icon--error">×</div>
                <h2>{t('payment.errorTitle')}</h2>
                <p>{paymentNotice.message}</p>
              </>
            )}
            <button
              className="btn btn-lime"
              type="button"
              onClick={() => {
                setPaymentNotice(null);
                if (user) setPage('client-dashboard');
              }}
            >
              {paymentNotice.type === 'success' ? t('common.toDashboard') : t('common.ok')}
            </button>
          </div>
        </div>
      )}

      {/* ── CLIENT DASHBOARD ── */}
      {page === 'client-dashboard' && user && (
        <ClientDashboard
          user={user}
          onExit={() => goPage('home')}
          onLogout={handleLogout}
          onCreateShipment={openCalcFresh}
          onUserUpdate={setUser}
          ordersRefresh={ordersRefresh}
          initialTab={dashNav?.tab}
          openShipmentOnMount={dashNav?.openCalc}
          onNavigated={() => setDashNav(null)}
        />
      )}

      <ShipmentCalculator
        open={calcOpen}
        onClose={() => {
          setCalcOpen(false);
          setCalcModalResume(false);
        }}
        user={user}
        resumeKey={calcModalKey}
        draftResume={calcModalResume}
        onSuccess={() => {
          setOrdersRefresh((n) => n + 1);
          setCalcOpen(false);
          setCalcModalResume(false);
        }}
      />

      {/* ── CORP DASHBOARD OVERLAY ── */}
      {page === 'dashboard' && dashboardType === 'corp' && (
        <div className="dash-overlay">
          {/* Sidebar */}
          <aside className="dash-sidebar">
            <button className="dash-logo" type="button" onClick={() => goPage('home')}>MATE<span>.</span></button>
            <nav className="dash-nav">
              {([
                ['home',         'Главная',     true  ],
                ['shipments',    'Отправления', false ],
                ['orders',       'Заказы',      false ],
                ['warehouses',   'Склады',      false ],
                ['finance',      'Финансы',     false ],
                ['analytics',    'Аналитика',   false ],
                ['integrations', 'Интеграции',  false ],
                ['support',      'Поддержка',   false ],
                ['settings',     'Настройки',   false ],
              ] as [string, string, boolean][]).map(([id, label, active]) => (
                <button key={id} type="button" className={`dash-nav-link${active ? ' active' : ''}`}>
                  <DashIcon id={id} size={16} />
                  <span>{label}</span>
                </button>
              ))}
            </nav>
            <div className="dash-user">
              <div className="dash-avatar">И</div>
              <div>
                <b>Иван Петров</b>
                <small>ООО «Ваша компания»</small>
              </div>
            </div>
          </aside>

          {/* Main */}
          <main className="dash-main">
            <div className="dash-head">
              <div>
                <h1>Добро пожаловать, Иван! 👋</h1>
                <p>Вот что происходит с вашими отправлениями сегодня</p>
              </div>
              <button className="btn btn-lime" type="button">Создать отправление</button>
            </div>

            <div className="dash-stats-row">
              {[
                { label: 'Отправлений', val: 24,  delta: '+12%', up: true,  icon: 'parcel'      },
                { label: 'В пути',      val: 156, delta: '+8%',  up: true,  icon: 'cargo'       },
                { label: 'Доставлено',  val: 342, delta: '+15%', up: true,  icon: 'fulfillment' },
                { label: 'Возвраты',    val: 12,  delta: '-4%',  up: false, icon: 'returns'     },
              ].map((s) => (
                <div key={s.label} className="dash-stat card">
                  <div className="dash-stat__icon"><ServiceSvgIcon id={s.icon} size={18} /></div>
                  <div>
                    <span className="dash-stat__label">{s.label}</span>
                    <div className="dash-stat__row">
                      <b>{s.val}</b>
                      <span className={`dash-stat__delta${s.up ? ' up' : ' dn'}`}>{s.delta}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="dash-orders card">
              <h3>Последние отправления</h3>
              <table>
                <tbody>
                  {dashOrders.map((o) => (
                    <tr key={o.id}>
                      <td><span className="dash-order-id"><ServiceSvgIcon id="parcel" size={13} />{o.id}</span></td>
                      <td>{o.carrier}</td>
                      <td><span className="dash-status" style={{ color: o.stColor }}>{o.status}</span></td>
                      <td className="dash-route">{o.route}</td>
                      <td className="dash-price">{o.price}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="dash-cta-bar">
              <div>
                <b>Получите индивидуальный тариф для вашего бизнеса</b>
                <span>Наш менеджер подготовит персональное предложение на основе ваших объёмов.</span>
              </div>
              <button className="btn btn-lime" type="button">Запросить тариф</button>
            </div>
          </main>
        </div>
      )}

      {showDraftCart && activeDraft && (
        <CalcDraftCart
          draft={activeDraft}
          onContinue={handleContinueDraft}
          onDismiss={handleDismissDraft}
        />
      )}

      {page !== 'admin' && <ScrollToTop />}
    </div>
  );
}

export default App;
