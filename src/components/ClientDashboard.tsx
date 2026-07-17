import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AuthUser } from '../api/auth';
import { getInitials } from '../api/auth';
import {
  cancelOrder,
  createAddress,
  deleteAddress,
  fetchAddresses,
  fetchLoyalty,
  fetchMyOrders,
  resumeCheckout,
  trackByTtn,
  updateProfile,
  type AddressEntry,
  type ClientLoyalty,
  type ShippingOrder,
} from '../api/shipping';
import { COUNTRIES, countryLabel } from '../constants/shipping';
import { useI18n } from '../i18n/context';
import { localizeApiError } from '../i18n/localizeApiError';
import { FeatureIcon } from './icons';
import { LanguageSelect } from './LanguageSelect';
import { ShipmentDetailModal } from './client-dash/ShipmentDetailModal';
import { OrderCard } from './client-dash/OrderCard';
import { PaymentCard } from './client-dash/PaymentCard';
import { TrackingMap } from './client-dash/TrackingMap';
import { LoyaltyCard, loyaltyTierLabel } from './client-dash/LoyaltyCard';
import { trackingEventLabel } from './client-dash/trackingLabels';

type Tab = 'home' | 'shipments' | 'tracking' | 'address' | 'payments' | 'settings';
export type ClientDashTab = Tab;
type ShipmentFilter = 'all' | 'transit' | 'paid' | 'pending';

type Props = {
  user: AuthUser;
  onExit: () => void;
  onLogout: () => void;
  onCreateShipment: () => void;
  onUserUpdate?: (user: AuthUser) => void;
  ordersRefresh?: number;
  initialTab?: Tab;
  openShipmentOnMount?: boolean;
  onNavigated?: () => void;
};

const NAV_TABS: Tab[] = ['home', 'shipments', 'tracking', 'address', 'payments', 'settings'];

const NAV_LABEL_KEYS: Record<Tab, { full: string; short: string }> = {
  home: { full: 'navHome', short: 'navHomeShort' },
  shipments: { full: 'navShipments', short: 'navShipmentsShort' },
  tracking: { full: 'navTracking', short: 'navTrackingShort' },
  address: { full: 'navAddress', short: 'navAddressShort' },
  payments: { full: 'navPayments', short: 'navPaymentsShort' },
  settings: { full: 'navSettings', short: 'navSettingsShort' },
};

function statusClass(status: string) {
  if (status === 'submitted') return 'transit';
  if (status === 'paid') return 'paid';
  if (status === 'pending_payment') return 'pending';
  if (status === 'cancelled') return 'cancelled';
  return 'default';
}

function formatMoney(amount: number, currency: string) {
  return `${amount.toFixed(2)} ${currency}`;
}

type DashNotification = {
  id: string;
  title: string;
  text: string;
  time: string;
  onClick: () => void;
};

function HelpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 0 1 4.2 1.8c0 1.8-2.7 2.2-2.7 3.7" />
      <circle cx="12" cy="17.2" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="M18 16H6l1.2-1.2A4 4 0 0 0 8 12.5V10a4 4 0 0 1 8 0v2.5a4 4 0 0 0 .8 2.3L18 16z" />
      <path d="M10 18a2 2 0 0 0 4 0" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function NavIcon({ id }: { id: string }) {
  const p = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'home': return <svg {...p}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
    case 'shipments': return <svg {...p}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>;
    case 'tracking': return <svg {...p}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>;
    case 'address': return <svg {...p}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="13" y2="14"/></svg>;
    case 'payments': return <svg {...p}><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>;
    default: return <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;
  }
}

export function ClientDashboard({
  user,
  onExit,
  onLogout,
  onCreateShipment,
  onUserUpdate,
  ordersRefresh = 0,
  initialTab,
  openShipmentOnMount,
  onNavigated,
}: Props) {
  const { t, intlLocale, locale } = useI18n();
  const firstName = user.name.split(' ')[0] || user.name;

  const statusLabel = useCallback((status: string) => {
    switch (status) {
      case 'submitted': return t('dash.statusSubmitted');
      case 'paid': return t('dash.statusPaid');
      case 'pending_payment': return t('dash.statusPending');
      case 'cancelled': return t('dash.statusCancelled');
      default: return status;
    }
  }, [t]);

  const formatDate = useCallback((iso?: string | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(intlLocale, { day: '2-digit', month: 'short', year: 'numeric' });
  }, [intlLocale]);

  const [tab, setTab] = useState<Tab>('home');
  const [shipFilter, setShipFilter] = useState<ShipmentFilter>('all');
  const [orders, setOrders] = useState<ShippingOrder[]>([]);
  const [addresses, setAddresses] = useState<AddressEntry[]>([]);
  const [loyalty, setLoyalty] = useState<ClientLoyalty | null>(null);
  const [loyaltyLoading, setLoyaltyLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [trackQuery, setTrackQuery] = useState('');
  const [trackOrder, setTrackOrder] = useState<ShippingOrder | null>(null);
  const [trackLoading, setTrackLoading] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const [addrForm, setAddrForm] = useState({ label: '', name: user.name, phone: user.phone, country: 'HU', city: '', street: '', postal: '' });
  const [addrSaving, setAddrSaving] = useState(false);

  const [settingsForm, setSettingsForm] = useState({ name: user.name, email: user.email, phone: user.phone, password: '' });
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const [detailOrder, setDetailOrder] = useState<ShippingOrder | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [readNotifIds, setReadNotifIds] = useState<Set<string>>(() => new Set());

  const notifRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const dashRootRef = useRef<HTMLDivElement>(null);

  const syncDropdownPosition = useCallback(() => {
    const root = dashRootRef.current;
    if (!root) return;
    const ref = notifOpen ? notifRef : profileOpen ? profileRef : null;
    if (!ref?.current) {
      root.style.removeProperty('--dash-dropdown-top');
      return;
    }
    const trigger = ref.current.querySelector('button');
    if (!trigger) return;
    const top = trigger.getBoundingClientRect().bottom + 8;
    root.style.setProperty('--dash-dropdown-top', `${top}px`);
  }, [notifOpen, profileOpen]);

  useEffect(() => {
    if (!notifOpen && !profileOpen) {
      dashRootRef.current?.style.removeProperty('--dash-dropdown-top');
      return;
    }
    syncDropdownPosition();
    window.addEventListener('resize', syncDropdownPosition);
    window.addEventListener('scroll', syncDropdownPosition, true);
    return () => {
      window.removeEventListener('resize', syncDropdownPosition);
      window.removeEventListener('scroll', syncDropdownPosition, true);
    };
  }, [notifOpen, profileOpen, syncDropdownPosition]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoyaltyLoading(true);
    setError(null);
    try {
      const [o, a, loy] = await Promise.all([
        fetchMyOrders(),
        fetchAddresses(),
        fetchLoyalty().catch(() => null),
      ]);
      setOrders(o);
      setAddresses(a);
      setLoyalty(loy);
      if (!selectedOrderId && o[0]) setSelectedOrderId(o[0].id);
    } catch (err) {
      setError(localizeApiError(err instanceof Error ? err.message : undefined, t, 'dash.loadError'));
    } finally {
      setLoading(false);
      setLoyaltyLoading(false);
    }
  }, [selectedOrderId, t]);

  useEffect(() => { loadData(); }, [ordersRefresh, user.id, loadData]);
  useEffect(() => { setSettingsForm({ name: user.name, email: user.email, phone: user.phone, password: '' }); }, [user]);
  useEffect(() => {
    setAddrForm((f) => ({ ...f, label: f.label || t('dash.addrHome') }));
  }, [t]);

  useEffect(() => {
    if (!initialTab && !openShipmentOnMount) return;
    if (initialTab) setTab(initialTab);
    if (openShipmentOnMount) onCreateShipment();
    onNavigated?.();
  }, [initialTab, openShipmentOnMount, onCreateShipment, onNavigated]);

  const stats = useMemo(() => ({
    total: orders.filter((o) => o.status !== 'cancelled').length,
    transit: orders.filter((o) => o.status === 'submitted').length,
    paid: orders.filter((o) => o.status === 'paid' || o.paidAt).length,
    pending: orders.filter((o) => o.status === 'pending_payment').length,
  }), [orders]);

  const selectedOrder = orders.find((o) => o.id === selectedOrderId) || orders[0] || trackOrder;
  const paidOrders = orders.filter((o) => o.paidAt || o.status === 'submitted' || o.status === 'paid');

  const filteredOrders = useMemo(() => {
    switch (shipFilter) {
      case 'transit': return orders.filter((o) => o.status === 'submitted');
      case 'paid': return orders.filter((o) => o.paidAt || o.status === 'paid');
      case 'pending': return orders.filter((o) => o.status === 'pending_payment');
      default: return orders;
    }
  }, [orders, shipFilter]);

  const switchTab = (next: Tab) => {
    setError(null);
    setTab(next);
  };

  const handleTrack = async (q = trackQuery) => {
    if (!q.trim()) return;
    setTrackLoading(true);
    setError(null);
    try {
      const found = await trackByTtn(q.trim());
      setTrackOrder(found);
      setSelectedOrderId(found.id);
      switchTab('tracking');
    } catch (err) {
      setError(localizeApiError(err instanceof Error ? err.message : undefined, t, 'dash.notFound'));
      setTrackOrder(null);
    } finally {
      setTrackLoading(false);
    }
  };

  const handleAddAddress = async () => {
    if (!addrForm.city || !addrForm.street) return;
    setAddrSaving(true);
    try {
      await createAddress({ ...addrForm, isDefault: addresses.length === 0 });
      setAddrForm((f) => ({ ...f, city: '', street: '', postal: '' }));
      const a = await fetchAddresses();
      setAddresses(a);
    } catch (err) {
      setError(localizeApiError(err instanceof Error ? err.message : undefined, t, 'dash.saveError'));
    } finally {
      setAddrSaving(false);
    }
  };

  const handleDeleteAddress = async (id: string) => {
    await deleteAddress(id);
    setAddresses(await fetchAddresses());
  };

  const handleSaveSettings = async () => {
    setSettingsSaving(true);
    setSettingsMsg(null);
    try {
      const updated = await updateProfile(settingsForm);
      onUserUpdate?.(updated);
      setSettingsMsg(t('dash.profileSaved'));
      setSettingsForm((f) => ({ ...f, password: '' }));
    } catch (err) {
      setSettingsMsg(localizeApiError(err instanceof Error ? err.message : undefined, t, 'dash.saveProfileError'));
    } finally {
      setSettingsSaving(false);
    }
  };

  const handlePayOrder = async (order: ShippingOrder) => {
    setError(null);
    setPayingId(order.id);
    try {
      const result = await resumeCheckout(order.publicToken);
      window.location.assign(result.checkoutUrl);
    } catch (err) {
      setError(localizeApiError(err instanceof Error ? err.message : undefined, t, 'dash.payError'));
      setPayingId(null);
    }
  };

  const handleCancelOrder = async (order: ShippingOrder) => {
    if (!window.confirm(t('dash.cancelConfirm'))) return;
    setError(null);
    setCancellingId(order.id);
    try {
      const updated = await cancelOrder(order.publicToken);
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
      setDetailOrder((cur) => (cur?.id === updated.id ? updated : cur));
    } catch (err) {
      setError(localizeApiError(err instanceof Error ? err.message : undefined, t, 'dash.cancelError'));
    } finally {
      setCancellingId(null);
    }
  };

  const openDetail = (order: ShippingOrder) => setDetailOrder(order);

  const openTracking = (order: ShippingOrder) => {
    setDetailOrder(null);
    setSelectedOrderId(order.id);
    setTrackOrder(order);
    if (order.npTtn) setTrackQuery(order.npTtn);
    switchTab('tracking');
  };

  const orderCardProps = (o: ShippingOrder, mode: 'home' | 'full') => {
    const base = {
      order: o,
      statusLabel: statusLabel(o.status),
      statusClass: statusClass(o.status),
      amountLabel: formatMoney(o.amount, o.currency),
      onOpen: () => openDetail(o),
      paying: payingId === o.id,
      cancelling: cancellingId === o.id,
      variant: mode,
      pickupDate: formatDate(o.pickupDate),
    };
    if (o.status === 'pending_payment') {
      return { ...base, onPay: () => handlePayOrder(o), onCancel: () => handleCancelOrder(o) };
    }
    if (o.status !== 'cancelled') {
      return { ...base, onTrack: () => openTracking(o) };
    }
    if (mode === 'full') {
      return { ...base, onDetail: () => openDetail(o) };
    }
    return base;
  };

  const notifications = useMemo<DashNotification[]>(() => {
    const items: DashNotification[] = [];
    orders
      .filter((o) => o.status === 'pending_payment')
      .slice(0, 5)
      .forEach((o) => {
        items.push({
          id: `pay-${o.id}`,
          title: t('dash.notifPending'),
          text: `${o.orderNumber} · ${formatMoney(o.amount, o.currency)}`,
          time: formatDate(o.createdAt),
          onClick: () => {
            setReadNotifIds((prev) => new Set(prev).add(`pay-${o.id}`));
            setNotifOpen(false);
            openDetail(o);
          },
        });
      });
    orders
      .filter((o) => o.status === 'submitted')
      .slice(0, 5)
      .forEach((o) => {
        items.push({
          id: `track-${o.id}`,
          title: t('dash.notifInTransit'),
          text: o.npTtn ? t('dash.ttnFmt', { ttn: o.npTtn }) : o.orderNumber,
          time: formatDate(o.paidAt || o.createdAt),
          onClick: () => {
            setReadNotifIds((prev) => new Set(prev).add(`track-${o.id}`));
            setNotifOpen(false);
            openTracking(o);
          },
        });
      });
    return items;
  }, [orders, t, formatDate]);

  const unreadCount = notifications.filter((n) => !readNotifIds.has(n.id)).length;
  const hasCompletedOrders = orders.some(
    (o) => o.status === 'submitted' || o.status === 'paid' || Boolean(o.paidAt),
  );
  const welcomeDiscountAvailable = !hasCompletedOrders && (
    loyalty
      ? (loyalty.welcomeDiscount?.available ?? false)
      : (user.welcomeDiscountAvailable ?? false)
  );
  const welcomeDiscountPercent = loyalty?.welcomeDiscount?.percent ?? 35;

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const markAllRead = () => {
    setReadNotifIds(new Set(notifications.map((n) => n.id)));
  };

  return (
    <div className="client-dash" ref={dashRootRef}>
      <aside className="client-dash__sidebar">
        <div className="client-dash__sidebar-head">
          <button className="client-dash__logo" type="button" onClick={onExit}>MATE<span>.</span></button>
          <button className="btn btn-lime client-dash__create client-dash__create--sidebar" type="button" onClick={onCreateShipment}>+ {t('dash.create')}</button>
        </div>
        <nav className="client-dash__nav" aria-label={t('dash.navAria')}>
          {NAV_TABS.map((id) => (
            <button key={id} type="button" className={`client-dash__nav-link${tab === id ? ' active' : ''}`} onClick={() => switchTab(id)}>
              <NavIcon id={id} />
              <span className="client-dash__nav-text client-dash__nav-text--full">{t(`dash.${NAV_LABEL_KEYS[id].full}`)}</span>
              <span className="client-dash__nav-text client-dash__nav-text--short">{t(`dash.${NAV_LABEL_KEYS[id].short}`)}</span>
            </button>
          ))}
        </nav>
        <div className="client-dash__promo card">
          {welcomeDiscountAvailable ? (
            <>
              <b>{t('dash.welcomeDiscountTitle', { percent: welcomeDiscountPercent })}</b>
              <span>{t('dash.welcomeDiscountSidebarDesc')}</span>
              <button className="btn btn-lime client-dash__promo-btn" type="button" onClick={onCreateShipment}>
                {t('dash.useDiscount')}
              </button>
            </>
          ) : loyalty ? (
            <>
              <b>{t('dash.promoLoyaltyLevel', { label: loyaltyTierLabel(loyalty.tier.id, loyalty.tier.label, t) })}</b>
              <span>
                {t('dash.promoShipmentsMonth', { count: loyalty.monthlyShipments })}
                {loyalty.nextTier && loyalty.remainingToNext != null
                  ? t('dash.promoToNext', {
                      label: loyaltyTierLabel(loyalty.nextTier.id, loyalty.nextTier.label, t),
                      count: loyalty.remainingToNext,
                    })
                  : ''}
              </span>
            </>
          ) : (
            <>
              <b>{t('dash.promoLoyalty')}</b>
              <span>{t('dash.promoLoyaltyHint')}</span>
            </>
          )}
        </div>
        <div className="client-dash__user-mini">
          <span className="client-dash__avatar">{getInitials(user.name)}</span>
          <div><b>{user.name}</b><small>{user.email}</small></div>
        </div>
      </aside>

      <div className="client-dash__body">
        <header className="client-dash__header">
          <button
            type="button"
            className="client-dash__help"
            onClick={() => window.open('mailto:Info@matedelivery.com?subject=Поддержка%20MATE', '_blank')}
          >
            <HelpIcon />
            <span>{t('dash.help')}</span>
          </button>
          <div className="client-dash__header-actions">
            <LanguageSelect variant="compact" />
            <div className="client-dash__dropdown" ref={notifRef}>
              <button
                type="button"
                className={`client-dash__bell${notifOpen ? ' active' : ''}`}
                aria-label={t('dash.notifications')}
                aria-expanded={notifOpen}
                onClick={() => {
                  setNotifOpen((v) => !v);
                  setProfileOpen(false);
                }}
              >
                <BellIcon />
                {unreadCount > 0 && <span className="client-dash__bell-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
              </button>
              {notifOpen && (
                <div className="client-dash__dropdown-panel client-dash__notif-panel">
                  <div className="client-dash__dropdown-head">
                    <b>{t('dash.notifications')}</b>
                    {unreadCount > 0 && (
                      <button type="button" className="client-dash__dropdown-link" onClick={markAllRead}>
                        {t('dash.markAllRead')}
                      </button>
                    )}
                  </div>
                  {notifications.length === 0 ? (
                    <p className="client-dash__dropdown-empty">{t('dash.notificationsEmpty')}</p>
                  ) : (
                    <ul className="client-dash__notif-list">
                      {notifications.map((n) => (
                        <li key={n.id}>
                          <button
                            type="button"
                            className={`client-dash__notif-item${readNotifIds.has(n.id) ? ' read' : ''}`}
                            onClick={n.onClick}
                          >
                            <span className="client-dash__notif-dot" aria-hidden />
                            <span>
                              <b>{n.title}</b>
                              <small>{n.text}</small>
                              <em>{n.time}</em>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div
              className={`client-dash__dropdown client-dash__profile-wrap${profileOpen ? ' open' : ''}`}
              ref={profileRef}
              onMouseEnter={() => setProfileOpen(true)}
              onMouseLeave={() => setProfileOpen(false)}
            >
              <button
                type="button"
                className="client-dash__profile"
                aria-expanded={profileOpen}
                onClick={() => setProfileOpen((v) => !v)}
              >
                <span className="client-dash__avatar">{getInitials(user.name)}</span>
                <span className="client-dash__profile-name">{firstName}</span>
                <ChevronIcon />
              </button>
              {profileOpen && (
                <div className="client-dash__dropdown-panel client-dash__profile-menu">
                  <div className="client-dash__profile-menu-head">
                    <b>{user.name}</b>
                    <small>{user.email}</small>
                  </div>
                  <button type="button" onClick={() => { setProfileOpen(false); switchTab('settings'); }}>
                    {t('dash.profileSettings')}
                  </button>
                  <button type="button" onClick={() => { setProfileOpen(false); onExit(); }}>
                    {t('dash.backToSite')}
                  </button>
                  <button type="button" className="client-dash__menu-logout" onClick={() => { setProfileOpen(false); onLogout(); }}>
                    {t('dash.logout')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="client-dash__main">
          {error && <div className="client-dash__alert">{error}</div>}

          {tab === 'home' && (
            <>
              <section className="client-dash__head-row">
                <div>
                  <h1>{t('dash.welcomeTitle', { name: firstName })}</h1>
                  <p>{t('dash.welcomeLead')}</p>
                </div>
                <button className="btn btn-lime" type="button" onClick={onCreateShipment}>{t('dash.createShipment')}</button>
              </section>

              {welcomeDiscountAvailable && (
                <section className="client-dash__welcome-discount card">
                  <div>
                    <span className="client-dash__welcome-discount-badge">{t('dash.welcomeDiscountBadge')}</span>
                    <h2>{t('dash.welcomeDiscountTitle', { percent: welcomeDiscountPercent })}</h2>
                    <p>{t('dash.welcomeDiscountDesc')}</p>
                  </div>
                  <button className="btn btn-lime" type="button" onClick={onCreateShipment}>{t('dash.createShipment')}</button>
                </section>
              )}

              <LoyaltyCard loyalty={loyalty} loading={loyaltyLoading} />

              <div className="client-dash__stats">
                {[
                  { label: t('dash.statTotal'), val: stats.total, delta: stats.total ? '+100%' : '0%', up: true },
                  { label: t('dash.statTransit'), val: stats.transit, delta: stats.transit ? t('dash.statActive') : '—', up: true },
                  { label: t('dash.statPaid'), val: stats.paid, delta: stats.paid ? 'ok' : '—', up: true },
                  { label: t('dash.statPending'), val: stats.pending, delta: stats.pending ? '!' : '—', up: false },
                ].map((s) => (
                  <div key={s.label} className="client-dash__stat card">
                    <span>{s.label}</span>
                    <div><b>{s.val}</b><em className={s.up ? 'up' : 'dn'}>{s.delta}</em></div>
                  </div>
                ))}
              </div>

              <section className="client-dash__panel card">
                <div className="client-dash__panel-head">
                  <h2>{t('dash.recentShipments')}</h2>
                  <button type="button" className="text-link" onClick={() => switchTab('shipments')}>{t('dash.allLink')}</button>
                </div>
                {loading ? <p className="client-dash__empty">{t('dash.loading')}</p> : orders.length === 0 ? (
                  <div className="client-dash__empty-block">
                    <p>{t('dash.noShipments')}</p>
                    <button className="btn btn-lime" type="button" onClick={onCreateShipment}>{t('dash.createFirst')}</button>
                  </div>
                ) : (
                  <>
                    <div className="client-dash__orders-cards">
                      {orders.slice(0, 5).map((o) => (
                        <OrderCard key={o.id} {...orderCardProps(o, 'home')} />
                      ))}
                    </div>
                    <div className="client-dash__orders-table">
                      <div className="client-dash__table-wrap">
                        <table className="client-dash__table client-dash__table--home">
                          <colgroup>
                            <col className="client-dash__col-id" />
                            <col className="client-dash__col-route" />
                            <col className="client-dash__col-status" />
                            <col className="client-dash__col-amount" />
                            <col className="client-dash__col-actions" />
                          </colgroup>
                          <thead>
                            <tr><th>{t('dash.thNumber')}</th><th>{t('dash.thRoute')}</th><th>{t('dash.thStatus')}</th><th className="client-dash__th-amount">{t('dash.thAmount')}</th><th>{t('dash.thActions')}</th></tr>
                          </thead>
                          <tbody>
                            {orders.slice(0, 5).map((o) => (
                              <tr key={o.id} className="client-dash__row-click" onClick={() => openDetail(o)}>
                                <td><b>{o.orderNumber}</b>{o.npTtn && (
                                  <small className={o.npValid === false ? 'client-dash__ttn-warn' : ''}>
                                    {o.npValid === false ? t('dash.npNotCreated') : t('dash.ttnFmt', { ttn: o.npTtn })}
                                  </small>
                                )}</td>
                                <td className="client-dash__route">{countryLabel(o.fromCountry || 'HU', locale)} → {countryLabel(o.toCountry || '', locale)}</td>
                                <td><span className={`client-dash__badge client-dash__badge--${statusClass(o.status)}`}>{statusLabel(o.status)}</span></td>
                                <td className="client-dash__amount">{formatMoney(o.amount, o.currency)}</td>
                                <td className="client-dash__cell-actions" onClick={(e) => e.stopPropagation()}>
                                  <div className="client-dash__row-actions">
                                    {o.status === 'pending_payment' ? (
                                      <>
                                        <button type="button" className="btn btn-lime btn-sm" disabled={payingId === o.id} onClick={() => handlePayOrder(o)}>{payingId === o.id ? '…' : t('dash.pay')}</button>
                                        <button type="button" className="btn btn-outline btn-sm" disabled={cancellingId === o.id} onClick={() => handleCancelOrder(o)}>{t('dash.cancel')}</button>
                                      </>
                                    ) : o.status !== 'cancelled' ? (
                                      <button type="button" className="text-link client-dash__link" onClick={() => openTracking(o)}>{t('dash.track')}</button>
                                    ) : null}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </section>
            </>
          )}

          {tab === 'shipments' && (
            <section className="client-dash__panel card">
              <div className="client-dash__panel-head">
                <h2>{t('dash.myShipments')}</h2>
                <button type="button" className="btn btn-lime btn-sm" onClick={onCreateShipment}>{t('dash.createNew')}</button>
              </div>
              <div className="client-dash__toolbar">
                <div className="client-dash__filters">
                  {([
                    ['all', t('dash.filterAll'), stats.total],
                    ['transit', t('dash.statTransit'), stats.transit],
                    ['paid', t('dash.statPaid'), stats.paid],
                    ['pending', t('dash.statPending'), stats.pending],
                  ] as [ShipmentFilter, string, number][]).map(([id, label, count]) => (
                    <button key={id} type="button" className={`client-dash__filter${shipFilter === id ? ' active' : ''}`} onClick={() => setShipFilter(id)}>
                      {label} <em>{count}</em>
                    </button>
                  ))}
                </div>
              </div>
              {loading ? <p className="client-dash__empty">{t('dash.loading')}</p> : filteredOrders.length === 0 ? (
                <p className="client-dash__empty">{t('dash.noShipmentsCategory', { email: user.email })}</p>
              ) : (
                <>
                  <div className="client-dash__orders-cards">
                    {filteredOrders.map((o) => (
                      <OrderCard key={o.id} {...orderCardProps(o, 'full')} />
                    ))}
                  </div>
                  <div className="client-dash__orders-table">
                    <div className="client-dash__table-wrap">
                      <table className="client-dash__table client-dash__table--full">
                        <colgroup>
                          <col className="client-dash__col-id" />
                          <col className="client-dash__col-route" />
                          <col className="client-dash__col-size" />
                          <col className="client-dash__col-date" />
                          <col className="client-dash__col-status" />
                          <col className="client-dash__col-amount" />
                          <col className="client-dash__col-actions" />
                        </colgroup>
                        <thead>
                          <tr><th>{t('dash.thNumber')}</th><th>{t('dash.thRoute')}</th><th>{t('dash.thSize')}</th><th>{t('dash.thPickup')}</th><th>{t('dash.thStatus')}</th><th className="client-dash__th-amount">{t('dash.thAmount')}</th><th>{t('dash.thActions')}</th></tr>
                        </thead>
                        <tbody>
                          {filteredOrders.map((o) => (
                            <tr key={o.id} className="client-dash__row-click" onClick={() => openDetail(o)}>
                              <td><b>{o.orderNumber}</b>{o.npTtn && (
                                <small className={o.npValid === false ? 'client-dash__ttn-warn' : ''}>
                                  {o.npValid === false ? t('dash.npNotCreated') : t('dash.ttnFmt', { ttn: o.npTtn })}
                                </small>
                              )}</td>
                              <td className="client-dash__route">{countryLabel(o.fromCountry || 'HU', locale)} → {countryLabel(o.toCountry || '', locale)}</td>
                              <td>{o.parcelSize || '—'}</td>
                              <td>{formatDate(o.pickupDate)}</td>
                              <td><span className={`client-dash__badge client-dash__badge--${statusClass(o.status)}`}>{statusLabel(o.status)}</span></td>
                              <td className="client-dash__amount">{formatMoney(o.amount, o.currency)}</td>
                              <td className="client-dash__cell-actions" onClick={(e) => e.stopPropagation()}>
                                <div className="client-dash__row-actions">
                                  {o.status === 'pending_payment' ? (
                                    <>
                                      <button type="button" className="btn btn-lime btn-sm" disabled={payingId === o.id} onClick={() => handlePayOrder(o)}>{payingId === o.id ? '…' : t('dash.pay')}</button>
                                      <button type="button" className="btn btn-outline btn-sm" disabled={cancellingId === o.id} onClick={() => handleCancelOrder(o)}>{t('dash.cancel')}</button>
                                    </>
                                  ) : o.status !== 'cancelled' ? (
                                    <button type="button" className="text-link client-dash__link" onClick={() => openTracking(o)}>{t('dash.track')}</button>
                                  ) : (
                                    <button type="button" className="text-link client-dash__link" onClick={() => openDetail(o)}>{t('dash.details')}</button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </section>
          )}

          {tab === 'tracking' && (
            <section className="client-dash__track-grid">
              <div className="client-dash__panel card">
                <h2>{t('dash.tracking')}</h2>
                <div className="client-dash__track-search">
                  <input value={trackQuery} onChange={(e) => setTrackQuery(e.target.value)} placeholder={t('dash.trackPlaceholder')} onKeyDown={(e) => e.key === 'Enter' && handleTrack()} />
                  <button className="btn btn-lime" type="button" disabled={trackLoading} onClick={() => handleTrack()}>{trackLoading ? '…' : t('dash.find')}</button>
                </div>
                {orders.length > 0 && (
                  <div className="client-dash__track-list">
                    <p className="client-dash__label">{t('dash.yourShipments')}</p>
                    {orders.filter((o) => o.npTtn || o.status === 'submitted').map((o) => (
                      <button key={o.id} type="button" className={`client-dash__track-item${selectedOrder?.id === o.id ? ' active' : ''}`} onClick={() => { setSelectedOrderId(o.id); setTrackOrder(o); if (o.npTtn) setTrackQuery(o.npTtn); }}>
                        <b>{o.orderNumber}</b>
                        <span>{countryLabel(o.fromCountry || 'HU', locale)} → {countryLabel(o.toCountry || '', locale)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="client-dash__panel card client-dash__track-detail">
                {selectedOrder ? (
                  <>
                    <TrackingMap
                      fromCountry={selectedOrder.fromCountry}
                      toCountry={selectedOrder.toCountry}
                      fromLine={selectedOrder.senderLine}
                      toLine={selectedOrder.receiverLine}
                      active={selectedOrder.status === 'submitted'}
                    />
                    <div className="client-dash__track-meta">
                      <div><span>{t('dash.orderLabel')}</span><b>{selectedOrder.orderNumber}</b></div>
                      {selectedOrder.npTtn && <div><span>{t('dash.ttnLabel')}</span><b>{selectedOrder.npTtn}</b></div>}
                      <div><span>{t('dash.status')}</span><b>{statusLabel(selectedOrder.status)}</b></div>
                    </div>
                    <ul className="client-dash__timeline">
                      {(selectedOrder.tracking || []).map((ev) => (
                        <li key={ev.id} className={`client-dash__timeline-item${ev.done ? ' done' : ''}${ev.current ? ' current' : ''}`}>
                          <span className="client-dash__timeline-dot" />
                          <div>
                            <b>{trackingEventLabel(ev, t)}</b>
                            {ev.at && <small>{formatDate(ev.at)}</small>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="client-dash__empty">{t('dash.selectOrEnterTtn')}</p>
                )}
              </div>
            </section>
          )}

          {tab === 'address' && (
            <section className="client-dash__panel card">
              <h2>{t('dash.addressBook')}</h2>
              <div className="client-dash__addr-grid">
                <div className="client-dash__addr-form">
                  <h3>{t('dash.addAddress')}</h3>
                  <div className="field-block"><label>{t('dash.labelName')}</label><input value={addrForm.label} onChange={(e) => setAddrForm({ ...addrForm, label: e.target.value })} /></div>
                  <div className="field-block"><label>{t('dash.name')}</label><input value={addrForm.name} onChange={(e) => setAddrForm({ ...addrForm, name: e.target.value })} /></div>
                  <div className="field-block"><label>{t('dash.phone')}</label><input value={addrForm.phone} onChange={(e) => setAddrForm({ ...addrForm, phone: e.target.value })} /></div>
                  <div className="field-block"><label>{t('dash.country')}</label>
                    <select value={addrForm.country} onChange={(e) => setAddrForm({ ...addrForm, country: e.target.value })}>
                      {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.flag} {countryLabel(c.code, locale)}</option>)}
                    </select>
                  </div>
                  <div className="field-block"><label>{t('dash.city')}</label><input value={addrForm.city} onChange={(e) => setAddrForm({ ...addrForm, city: e.target.value })} /></div>
                  <div className="field-block"><label>{t('dash.street')}</label><input value={addrForm.street} onChange={(e) => setAddrForm({ ...addrForm, street: e.target.value })} /></div>
                  <div className="field-block"><label>{t('dash.postal')}</label><input value={addrForm.postal} onChange={(e) => setAddrForm({ ...addrForm, postal: e.target.value })} /></div>
                  <button className="btn btn-lime" type="button" disabled={addrSaving} onClick={handleAddAddress}>{addrSaving ? t('dash.savingAddress') : t('dash.saveAddress')}</button>
                </div>
                <div className="client-dash__addr-list">
                  {addresses.length === 0 ? <p className="client-dash__empty">{t('dash.saveAddressesHint')}</p> : addresses.map((a) => (
                    <article key={a.id} className="client-dash__addr-card">
                      <div><b>{a.label}{a.isDefault && <em>{t('dash.defaultTag')}</em>}</b><span>{a.name} · {a.phone}</span><span>{a.street}, {a.city} {a.postal}, {countryLabel(a.country, locale)}</span></div>
                      <button type="button" className="client-dash__addr-del" onClick={() => handleDeleteAddress(a.id)}>{t('dash.delete')}</button>
                    </article>
                  ))}
                </div>
              </div>
            </section>
          )}

          {tab === 'payments' && (
            <section className="client-dash__panel card">
              <h2>{t('dash.payments')}</h2>
              <div className="client-dash__stats client-dash__stats--inline client-dash__stats--payments">
                <div className="client-dash__stat card"><span>{t('dash.paidTotal')}</span><div><b>{formatMoney(paidOrders.reduce((s, o) => s + o.amount, 0), paidOrders[0]?.currency || 'EUR')}</b></div></div>
                <div className="client-dash__stat card"><span>{t('dash.transactions')}</span><div><b>{paidOrders.length}</b></div></div>
                <div className="client-dash__stat card"><span>{t('dash.statPending')}</span><div><b>{stats.pending}</b></div></div>
              </div>
              {orders.length === 0 ? <p className="client-dash__empty">{t('dash.noBills')}</p> : (
                <>
                  <div className="client-dash__orders-cards">
                    {orders.map((o) => (
                      <PaymentCard
                        key={o.id}
                        order={o}
                        dateLabel={formatDate(o.paidAt || o.createdAt)}
                        amountLabel={formatMoney(o.amount, o.currency)}
                        statusLabel={o.status === 'pending_payment' ? t('dash.statusPending') : t('dash.statusPaid')}
                        statusClass={statusClass(o.status)}
                        onOpen={() => openDetail(o)}
                        onPay={o.status === 'pending_payment' ? () => handlePayOrder(o) : undefined}
                        paying={payingId === o.id}
                      />
                    ))}
                  </div>
                  <div className="client-dash__orders-table">
                    <div className="client-dash__table-wrap">
                      <table className="client-dash__table client-dash__table--payments">
                        <colgroup>
                          <col style={{ width: '12%' }} />
                          <col style={{ width: '18%' }} />
                          <col style={{ width: '28%' }} />
                          <col className="client-dash__col-amount" />
                          <col className="client-dash__col-status" />
                          <col className="client-dash__col-actions" />
                        </colgroup>
                        <thead><tr><th>{t('dash.thDate')}</th><th>{t('dash.thInvoice')}</th><th>{t('dash.thDescription')}</th><th className="client-dash__th-amount">{t('dash.thAmount')}</th><th>{t('dash.thStatus')}</th><th>{t('dash.thActions')}</th></tr></thead>
                        <tbody>
                          {orders.map((o) => (
                            <tr key={o.id} className="client-dash__row-click" onClick={() => openDetail(o)}>
                              <td>{formatDate(o.paidAt || o.createdAt)}</td>
                              <td><b>{o.orderNumber}</b></td>
                              <td className="client-dash__route">{t('dash.deliveryDesc', { from: countryLabel(o.fromCountry || 'HU', locale), to: countryLabel(o.toCountry || '', locale) })}</td>
                              <td className="client-dash__amount">{formatMoney(o.amount, o.currency)}</td>
                              <td>
                                <span className={`client-dash__badge client-dash__badge--${statusClass(o.status)}`}>
                                  {o.status === 'pending_payment' ? t('dash.statusPending') : t('dash.statusPaid')}
                                </span>
                              </td>
                              <td className="client-dash__cell-actions" onClick={(e) => e.stopPropagation()}>
                                <div className="client-dash__row-actions">
                                  {o.status === 'pending_payment' ? (
                                    <button type="button" className="btn btn-lime btn-sm" disabled={payingId === o.id} onClick={() => handlePayOrder(o)}>{payingId === o.id ? '…' : t('dash.pay')}</button>
                                  ) : (
                                    <button type="button" className="text-link client-dash__link" onClick={() => window.print()}>{t('dash.download')}</button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </section>
          )}

          {tab === 'settings' && (
            <section className="client-dash__panel card client-dash__settings">
              <h2>{t('dash.profileSettingsTitle')}</h2>
              {settingsMsg && <p className={settingsMsg === t('dash.profileSaved') ? 'client-dash__ok' : 'client-dash__alert'}>{settingsMsg}</p>}
              <div className="client-dash__settings-grid">
                <div className="field-block"><label>{t('dash.name')}</label><input value={settingsForm.name} onChange={(e) => setSettingsForm({ ...settingsForm, name: e.target.value })} /></div>
                <div className="field-block"><label>Email</label><input type="email" value={settingsForm.email} onChange={(e) => setSettingsForm({ ...settingsForm, email: e.target.value })} /></div>
                <div className="field-block"><label>{t('dash.phone')}</label><input value={settingsForm.phone} onChange={(e) => setSettingsForm({ ...settingsForm, phone: e.target.value })} /></div>
                <div className="field-block"><label>{t('dash.newPassword')}</label><input type="password" value={settingsForm.password} onChange={(e) => setSettingsForm({ ...settingsForm, password: e.target.value })} placeholder={t('dash.passwordPlaceholder')} /></div>
              </div>
              <button className="btn btn-lime" type="button" disabled={settingsSaving} onClick={handleSaveSettings}>{settingsSaving ? t('dash.savingProfile') : t('dash.saveChanges')}</button>

              <div className="client-dash__advantages-mini">
                <h3>{t('dash.benefitsTitle')}</h3>
                <div className="features">
                  {[
                    { id: 'ai', title: t('dash.benefitFast'), desc: t('dash.benefitFastDesc') },
                    { id: 'track', title: t('dash.benefitTrack'), desc: t('dash.benefitTrackDesc') },
                    { id: 'price', title: t('dash.benefitPrice'), desc: t('dash.benefitPriceDesc') },
                    { id: 'platform', title: t('dash.benefitSupport'), desc: t('dash.benefitSupportDesc') },
                  ].map((item) => (
                    <article key={item.id} className="feature-card">
                      <div className={`feature-icon feature-icon--${item.id}`}><FeatureIcon id={item.id} /></div>
                      <h4>{item.title}</h4>
                      <p>{item.desc}</p>
                    </article>
                  ))}
                </div>
              </div>
            </section>
          )}
        </main>
      </div>

      {detailOrder && (
        <ShipmentDetailModal
          order={detailOrder}
          onClose={() => setDetailOrder(null)}
          onPay={handlePayOrder}
          onCancel={handleCancelOrder}
          onTrack={(o) => { openTracking(o); }}
          paying={payingId === detailOrder.id}
          cancelling={cancellingId === detailOrder.id}
        />
      )}
    </div>
  );
}
