import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AuthUser } from '../../api/auth';
import { fetchMe } from '../../api/auth';
import {
  adminLogin,
  clearAdminToken,
  createAdminUser,
  deleteAdminUser,
  fetchAdminDashboard,
  fetchAdminOrders,
  fetchAdminOrder,
  fetchAdminPricing,
  fetchAdminSettings,
  fetchAdminUser,
  fetchAdminUsers,
  getAdminToken,
  previewAdminPrice,
  saveAdminPricing,
  saveAdminSettings,
  savePricingCell,
  storeAdminToken,
  updateAdminOrder,
  updateAdminUser,
  retryAdminOrderNp,
  fetchAdminPromos,
  createAdminPromo,
  setAdminPromoActive,
  deleteAdminPromo,
  fetchAdminAnalytics,
  type AdminPricing,
  type AdminSettings,
  type AdminPromo,
  type AdminAnalyticsReport,
} from '../../api/admin';

type Tab = 'dashboard' | 'orders' | 'users' | 'pricing' | 'settings' | 'promos' | 'analytics';

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

const NAV_ITEMS: { id: Tab; label: string; short: string }[] = [
  { id: 'dashboard', label: 'Дашборд', short: 'Главная' },
  { id: 'analytics', label: 'Аналитика', short: 'Воронка' },
  { id: 'orders', label: 'Заказы', short: 'Заказы' },
  { id: 'users', label: 'Пользователи', short: 'Люди' },
  { id: 'pricing', label: 'Цены', short: 'Цены' },
  { id: 'settings', label: 'Настройки', short: 'Настр.' },
  { id: 'promos', label: 'Промокоды', short: 'Промо' },
];

const CALC_STEP_LABELS: Record<number, string> = {
  1: 'Страна',
  2: 'Города',
  3: 'Размер',
  4: 'Способ',
  5: 'Отправитель',
  6: 'Получатель',
  7: 'Содержимое',
  8: 'Оплата',
  9: 'Подтверждение',
};
function TabIcon({ id }: { id: Tab }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };
  switch (id) {
    case 'dashboard':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      );
    case 'orders':
      return (
        <svg {...common}>
          <path d="M8 6h13M8 12h13M8 18h13" />
          <circle cx="4" cy="6" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="4" cy="12" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="4" cy="18" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'users':
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3.5 19.5c.8-3.2 2.9-4.8 5.5-4.8s4.7 1.6 5.5 4.8" />
          <circle cx="17" cy="9" r="2.4" />
          <path d="M15.2 14.6c1.6.3 2.9 1.4 3.5 3.4" />
        </svg>
      );
    case 'pricing':
      return (
        <svg {...common}>
          <path d="M12 3v18M16.5 7.5c-.8-1.2-2-1.8-4.5-1.8-2.8 0-4.5 1.3-4.5 3.3S9.5 12 12.2 12.5c2.6.5 4.3 1.4 4.3 3.4 0 2.1-1.9 3.4-4.8 3.4-2.4 0-3.9-.8-4.8-2.1" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3.2" />
          <path d="M12 3.5v2.2M12 18.3v2.2M4.9 6.5l1.6 1.5M17.5 16l1.6 1.5M3.5 12h2.2M18.3 12h2.2M4.9 17.5l1.6-1.5M17.5 8l1.6-1.5" />
        </svg>
      );
    case 'promos':
      return (
        <svg {...common}>
          <path d="M20.6 12.8 12.8 20.6a2 2 0 0 1-2.8 0L3.4 14a2 2 0 0 1 0-2.8l7.8-7.8a2 2 0 0 1 1.4-.6H19a2 2 0 0 1 2 2v6.4a2 2 0 0 1-.6 1.4Z" />
          <circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'analytics':
      return (
        <svg {...common}>
          <path d="M4 19V5" />
          <path d="M4 19h16" />
          <rect x="7" y="11" width="3" height="5" rx="0.5" />
          <rect x="12" y="8" width="3" height="8" rx="0.5" />
          <rect x="17" y="5" width="3" height="11" rx="0.5" />
        </svg>
      );
    default:
      return null;
  }
}

const MODE_LABELS: Record<string, string> = {
  branch: 'В филиал',
  locker: 'В постамат',
  pudo: 'В пункт выдачи',
  address: 'На адрес',
};

const STATUS_LABELS: Record<string, string> = {
  pending_payment: 'Ожидает оплаты',
  paid: 'Оплачено',
  waiting_from_you: 'Жду от Вас посылку',
  submitted: 'В пути',
  delivered: 'Доставлено',
  cancelled: 'Отменён',
};

function formatMoney(amount: number, currency: string) {
  const n = Number(amount) || 0;
  if (currency === 'HUF') return `${Math.round(n).toLocaleString('ru-RU')} ${currency}`;
  return `${n.toFixed(2)} ${currency}`;
}

function formatDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateParts(iso?: string | null) {
  if (!iso) return { day: '—', time: '' };
  const d = new Date(iso);
  return {
    day: d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }),
    time: d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
  };
}

const STATUS_FILTERS: { id: string; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'pending_payment', label: 'Ожидают оплаты' },
  { id: 'waiting_from_you', label: 'Жду посылку' },
  { id: 'paid', label: 'Оплачено' },
  { id: 'submitted', label: 'В пути' },
  { id: 'delivered', label: 'Доставлено' },
  { id: 'cancelled', label: 'Отменены' },
];

type Props = {
  onExit: () => void;
};

export function AdminApp({ onExit }: Props) {
  const [boot, setBoot] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [navOpen, setNavOpen] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const goTab = (id: Tab) => {
    setTab(id);
    setNavOpen(false);
  };

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      if (!isEditableTarget(e.target)) return;
      if (blurTimerRef.current) {
        clearTimeout(blurTimerRef.current);
        blurTimerRef.current = null;
      }
      setKeyboardOpen(true);
      const el = e.target as HTMLElement;
      window.setTimeout(() => {
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      }, 120);
    };

    const onFocusOut = () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
      blurTimerRef.current = setTimeout(() => {
        const active = document.activeElement;
        if (!isEditableTarget(active)) setKeyboardOpen(false);
      }, 180);
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || typeof window === 'undefined') return;

    const syncViewport = () => {
      const vv = window.visualViewport;
      if (!vv) {
        shell.style.removeProperty('--admin-vvh');
        shell.style.removeProperty('--admin-vv-offset');
        return;
      }
      shell.style.setProperty('--admin-vvh', `${Math.round(vv.height)}px`);
      shell.style.setProperty('--admin-vv-offset', `${Math.round(vv.offsetTop)}px`);
    };

    syncViewport();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', syncViewport);
    vv?.addEventListener('scroll', syncViewport);
    window.addEventListener('resize', syncViewport);
    return () => {
      vv?.removeEventListener('resize', syncViewport);
      vv?.removeEventListener('scroll', syncViewport);
      window.removeEventListener('resize', syncViewport);
      shell.style.removeProperty('--admin-vvh');
      shell.style.removeProperty('--admin-vv-offset');
    };
  }, [user, boot]);

  useEffect(() => {
    const token = getAdminToken();
    if (!token) {
      setBoot(false);
      return;
    }
    fetchMe(token)
      .then((res) => {
        if (res.user.type !== 'admin') {
          clearAdminToken();
          setUser(null);
        } else {
          setUser(res.user as AuthUser);
        }
      })
      .catch(() => {
        clearAdminToken();
        setUser(null);
      })
      .finally(() => setBoot(false));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const res = await adminLogin(login, password);
      if (res.user.type !== 'admin') {
        throw new Error('Это не аккаунт администратора');
      }
      storeAdminToken(res.token);
      setUser(res.user as AuthUser);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Ошибка входа');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    clearAdminToken();
    setUser(null);
  };

  if (boot) {
    return (
      <div className="admin-app admin-app--boot" ref={shellRef}>
        <p>Загрузка админки…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className={`admin-app admin-login${keyboardOpen ? ' admin-app--keyboard' : ''}`} ref={shellRef}>
        <form className="admin-login__card card" onSubmit={handleLogin}>
          <div className="admin-login__brand">MATE<span>.</span> Admin</div>
          <h1>Вход в админку</h1>
          {authError && <div className="admin-alert">{authError}</div>}
          <label className="admin-field">
            <span>Логин</span>
            <input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" />
          </label>
          <label className="admin-field">
            <span>Пароль</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button className="btn btn-lime" type="submit" disabled={authLoading}>
            {authLoading ? 'Вход…' : 'Войти'}
          </button>
          <button className="btn btn-outline" type="button" onClick={onExit}>
            На сайт
          </button>
        </form>
      </div>
    );
  }

  const tabLabels: Record<Tab, string> = {
    dashboard: 'Дашборд',
    analytics: 'Аналитика',
    orders: 'Заказы',
    users: 'Пользователи',
    pricing: 'Цены',
    settings: 'Настройки',
    promos: 'Промокоды',
  };

  return (
    <div
      ref={shellRef}
      className={`admin-app${navOpen ? ' admin-app--nav-open' : ''}${keyboardOpen ? ' admin-app--keyboard' : ''}`}
    >
      {navOpen && (
        <button
          type="button"
          className="admin-nav-backdrop"
          aria-label="Закрыть меню"
          onClick={() => setNavOpen(false)}
        />
      )}

      <header className="admin-topbar">
        <button
          type="button"
          className="admin-menu-btn"
          aria-label={navOpen ? 'Закрыть меню' : 'Открыть меню'}
          aria-expanded={navOpen}
          onClick={() => setNavOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
        <div className="admin-topbar__center">
          <button type="button" className="admin-topbar__brand" onClick={() => goTab('dashboard')}>
            MATE<span>.</span>
          </button>
          <span className="admin-topbar__tab">{tabLabels[tab]}</span>
        </div>
        <button
          type="button"
          className="admin-topbar__avatar"
          onClick={() => setNavOpen(true)}
          aria-label="Профиль"
        >
          {(user.name || 'A').charAt(0).toUpperCase()}
        </button>
      </header>

      <aside className={`admin-sidebar${navOpen ? ' is-open' : ''}`}>
        <button type="button" className="admin-logo" onClick={() => goTab('dashboard')}>
          MATE<span>.</span>
        </button>
        <p className="admin-sidebar__label">Админ-панель</p>
        <nav className="admin-nav">
          {NAV_ITEMS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`admin-nav__link${tab === id ? ' active' : ''}`}
              onClick={() => goTab(id)}
            >
              <span className="admin-nav__icon"><TabIcon id={id} /></span>
              {label}
            </button>
          ))}
        </nav>
        <div className="admin-sidebar__foot">
          <div className="admin-sidebar__user">
            <span className="admin-sidebar__avatar">{(user.name || 'A').charAt(0).toUpperCase()}</span>
            <div>
              <b>{user.name}</b>
              <small>{user.email}</small>
            </div>
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={handleLogout}>Выйти</button>
          <button type="button" className="text-link" onClick={onExit}>На сайт →</button>
        </div>
      </aside>

      <main className="admin-main" key={tab}>
        {tab === 'dashboard' && <DashboardTab />}
        {tab === 'analytics' && <AnalyticsTab />}
        {tab === 'orders' && <OrdersTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'pricing' && <PricingTab />}
        {tab === 'settings' && <SettingsTab />}
        {tab === 'promos' && <PromosTab />}
      </main>

      <nav className="admin-dock" aria-label="Основная навигация">
        {NAV_ITEMS.map(({ id, short }) => (
          <button
            key={id}
            type="button"
            className={`admin-dock__item${tab === id ? ' is-active' : ''}`}
            onClick={() => goTab(id)}
          >
            <span className="admin-dock__icon"><TabIcon id={id} /></span>
            <span className="admin-dock__label">{short}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function DashboardTab() {
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchAdminDashboard>> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchAdminDashboard()
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="admin-alert">{error}</div>;
  if (!data) return <p className="admin-muted">Загрузка…</p>;

  const { stats, recentOrders, recentUsers } = data;
  const cards = [
    { label: 'Всего заказов', value: stats.totalOrders, tone: 'ink' },
    { label: 'Ожидают оплаты', value: stats.pendingPayment, tone: 'amber' },
    { label: 'Отправлено', value: stats.submitted, tone: 'green' },
    { label: 'Отменено', value: stats.cancelled, tone: 'mute' },
    { label: 'Пользователей', value: stats.users, tone: 'teal' },
    { label: 'Выручка', value: formatMoney(stats.revenue, stats.currency), tone: 'lime', featured: true },
  ];

  return (
    <div className="admin-section admin-section--animate">
      <header className="admin-section__head">
        <h1>Дашборд</h1>
        <p>Сводка по заказам и клиентам</p>
      </header>
      <div className="admin-stats">
        {cards.map((c, i) => (
          <div
            key={c.label}
            className={`admin-stat card admin-stat--${c.tone}${c.featured ? ' admin-stat--featured' : ''}`}
            style={{ '--delay': `${i * 45}ms` } as React.CSSProperties}
          >
            <span>{c.label}</span>
            <b>{c.value}</b>
          </div>
        ))}
      </div>
      <div className="admin-grid-2">
        <section className="card admin-panel admin-panel--rise" style={{ '--delay': '280ms' } as React.CSSProperties}>
          <h2>Последние заказы</h2>
          <div className="admin-table-wrap admin-desktop-only">
            <table className="admin-table">
              <thead>
                <tr><th>Номер</th><th>Клиент</th><th>Статус</th><th>Сумма</th></tr>
              </thead>
              <tbody>
                {recentOrders.map((o) => (
                  <tr key={o.id}>
                    <td><b>{o.orderNumber}</b></td>
                    <td>{o.senderName || o.customerEmail || '—'}</td>
                    <td><span className={`admin-badge admin-badge--${o.status}`}>{STATUS_LABELS[o.status] || o.status}</span></td>
                    <td>{formatMoney(o.amount, o.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="admin-card-list admin-mobile-only">
            {recentOrders.map((o, i) => (
              <article
                key={o.id}
                className="admin-item-card"
                style={{ '--delay': `${320 + i * 40}ms` } as React.CSSProperties}
              >
                <div className="admin-item-card__top">
                  <b className="admin-item-card__id">{o.orderNumber}</b>
                  <span className={`admin-badge admin-badge--${o.status}`}>
                    {STATUS_LABELS[o.status] || o.status}
                  </span>
                </div>
                <div className="admin-item-card__row">
                  <span>Клиент</span>
                  <strong>{o.senderName || o.customerEmail || '—'}</strong>
                </div>
                <div className="admin-item-card__row">
                  <span>Сумма</span>
                  <strong className="admin-item-card__amount">{formatMoney(o.amount, o.currency)}</strong>
                </div>
              </article>
            ))}
            {recentOrders.length === 0 && <p className="admin-muted">Заказов пока нет</p>}
          </div>
        </section>
        <section className="card admin-panel admin-panel--rise" style={{ '--delay': '360ms' } as React.CSSProperties}>
          <h2>Новые пользователи</h2>
          <ul className="admin-user-list">
            {recentUsers.map((u) => (
              <li key={u.id}>
                <div className="admin-user-list__avatar" aria-hidden>
                  {(u.name || '?').charAt(0).toUpperCase()}
                </div>
                <div className="admin-user-list__body">
                  <b>{u.name}</b>
                  <small>{u.email}</small>
                  <small className="admin-user-list__phone">{u.phone || '—'}</small>
                </div>
                <span className="admin-user-list__phone-desk">{u.phone || '—'}</span>
              </li>
            ))}
            {recentUsers.length === 0 && <li className="admin-muted">Пока нет пользователей</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}

function AnalyticsTab() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [data, setData] = useState<AdminAnalyticsReport | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [hoverDay, setHoverDay] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError('');
    fetchAdminAnalytics(days)
      .then(setData)
      .catch((e) => setError(e.message || 'Ошибка загрузки'))
      .finally(() => setLoading(false));
  }, [days]);

  if (error) return <div className="admin-alert">{error}</div>;
  if (loading || !data) {
    return (
      <div className="ax ax--loading">
        <div className="ax-skeleton ax-skeleton--hero" />
        <div className="ax-skeleton-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="ax-skeleton" style={{ '--d': `${i * 40}ms` } as React.CSSProperties} />
          ))}
        </div>
        <p className="admin-muted">Собираем аналитику…</p>
      </div>
    );
  }

  const maxReached = Math.max(1, ...data.funnel.map((f) => f.reached), 1);
  const maxDaily = Math.max(1, ...data.daily.map((d) => d.orders), 1);
  const maxStatus = Math.max(1, ...data.byStatus.map((s) => s.count), 1);
  const maxHour = Math.max(1, ...data.byHour.map((h) => h.count), 1);
  const o = data.orders;
  const hovered = data.daily.find((d) => d.date === hoverDay) || data.peakDay;

  const statusTone = (name: string) => {
    if (name === 'cancelled') return 'danger';
    if (name === 'pending_payment') return 'warn';
    if (name === 'waiting_from_you' || name === 'paid') return 'info';
    if (name === 'submitted' || name === 'delivered') return 'ok';
    return 'neutral';
  };

  const RankList = ({
    title,
    items,
    empty = 'Нет данных',
    accent = 'lime',
  }: {
    title: string;
    items: Array<{ name: string; count: number }>;
    empty?: string;
    accent?: string;
  }) => {
    const max = Math.max(1, ...items.map((i) => i.count));
    return (
      <div className="ax-rank">
        <h3 className="ax-rank__title">{title}</h3>
        <ul className="ax-rank__list">
          {items.map((r, idx) => (
            <li key={r.name} className="ax-rank__item" style={{ '--i': idx } as React.CSSProperties}>
              <div className="ax-rank__head">
                <span className="ax-rank__name">{r.name}</span>
                <b className="ax-rank__count">{r.count}</b>
              </div>
              <div className="ax-rank__track">
                <div
                  className={`ax-rank__fill ax-rank__fill--${accent}`}
                  style={{ width: `${(r.count / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
          {items.length === 0 && <li className="ax-rank__empty">{empty}</li>}
        </ul>
      </div>
    );
  };

  const kpis: Array<{
    label: string;
    value: string | number;
    hint?: string;
    tone: string;
    wide?: boolean;
  }> = [
    { label: 'Выручка', value: formatMoney(o.revenue, o.currency), hint: `${days} дней`, tone: 'lime', wide: true },
    { label: 'Заказы', value: o.total, hint: `конверсия ${o.conversionPct}%`, tone: 'ink' },
    { label: 'В работе', value: o.paidOrSubmitted, hint: 'оплачено и дальше', tone: 'ok' },
    { label: 'Средний чек', value: formatMoney(o.avgCheck, o.currency), hint: `медиана ${formatMoney(o.medianCheck, o.currency)}`, tone: 'ink' },
    { label: 'Ждут оплаты', value: o.pendingPayment, tone: 'warn' },
    { label: 'Отмены', value: o.cancelled, hint: o.total ? `${Math.round((o.cancelled / o.total) * 100)}%` : undefined, tone: 'danger' },
    { label: 'С TTN', value: o.withTtn, hint: 'Nova Post', tone: 'info' },
    { label: 'Гости / аккаунты', value: `${o.guests} / ${o.withUser}`, tone: 'mute' },
    { label: 'Хрупкое · страховка', value: `${o.fragile} · ${o.insurance}`, tone: 'warn' },
    { label: 'Сессии калькулятора', value: data.sessions, hint: data.pageViews ? `${data.pageViews} просмотров` : undefined, tone: 'ink' },
  ];

  return (
    <div className="ax admin-section admin-section--animate admin-section--fluid">
      <header className="ax-head">
        <div className="ax-head__copy">
          <p className="ax-eyebrow">Mate Insights</p>
          <h1>Аналитика</h1>
          <p className="ax-head__sub">Живая картина бизнеса: заказы, маршруты и поведение в калькуляторе</p>
        </div>
        <div className="ax-period" role="tablist" aria-label="Период">
          {([7, 30, 90] as const).map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={days === d}
              className={`ax-period__btn${days === d ? ' is-on' : ''}`}
              onClick={() => setDays(d)}
            >
              {d} дн.
            </button>
          ))}
        </div>
      </header>

      <section className="ax-hero card">
        <div className="ax-hero__glow" aria-hidden />
        <div className="ax-hero__body">
          <span className="ax-hero__label">Ключевые выводы</span>
          <p>{data.insight}</p>
        </div>
        <div className="ax-hero__ring" aria-hidden>
          <div
            className="ax-hero__ring-fill"
            style={{ '--p': `${Math.min(100, o.conversionPct)}` } as React.CSSProperties}
          />
          <div className="ax-hero__ring-core">
            <strong>{o.conversionPct}%</strong>
            <span>оплата</span>
          </div>
        </div>
      </section>

      <div className="ax-kpis">
        {kpis.map((c, i) => (
          <article
            key={c.label}
            className={`ax-kpi ax-kpi--${c.tone}${c.wide ? ' ax-kpi--wide' : ''} card`}
            style={{ '--i': i } as React.CSSProperties}
          >
            <span className="ax-kpi__label">{c.label}</span>
            <b className="ax-kpi__value">{c.value}</b>
            {c.hint && <small className="ax-kpi__hint">{c.hint}</small>}
          </article>
        ))}
      </div>

      <div className="ax-grid-2">
        <section className="ax-panel card">
          <div className="ax-panel__head">
            <div>
              <h2>Заказы по дням</h2>
              <p>Динамика за выбранный период</p>
            </div>
            {hovered && hovered.orders > 0 && (
              <div className="ax-tooltip">
                <b>{hovered.date}</b>
                <span>{hovered.orders} зак. · {formatMoney(hovered.revenue, o.currency)}</span>
              </div>
            )}
          </div>
          <div className="ax-chart">
            {data.daily.map((d, i) => {
              const h = d.orders ? Math.max(8, (d.orders / maxDaily) * 100) : 3;
              const active = hoverDay === d.date || (!hoverDay && data.peakDay?.date === d.date && d.orders > 0);
              return (
                <button
                  key={d.date}
                  type="button"
                  className={`ax-chart__col${d.orders ? ' has-data' : ''}${active ? ' is-active' : ''}`}
                  style={{ '--i': i, '--h': `${h}%` } as React.CSSProperties}
                  onMouseEnter={() => setHoverDay(d.date)}
                  onMouseLeave={() => setHoverDay(null)}
                  onFocus={() => setHoverDay(d.date)}
                  onBlur={() => setHoverDay(null)}
                  aria-label={`${d.date}: ${d.orders} заказов`}
                >
                  <span className="ax-chart__bar" />
                  <span className="ax-chart__label">{d.date.slice(8)}</span>
                </button>
              );
            })}
          </div>
          <div className="ax-mini">
            <div><span>Мин. чек</span><b>{formatMoney(o.minCheck, o.currency)}</b></div>
            <div><span>Макс. чек</span><b>{formatMoney(o.maxCheck, o.currency)}</b></div>
            <div><span>Просмотры</span><b>{data.pageViews}</b></div>
            <div><span>Checkout из кальк.</span><b>{data.calcConversionPct == null ? '—' : `${data.calcConversionPct}%`}</b></div>
          </div>
        </section>

        <section className="ax-panel card">
          <div className="ax-panel__head">
            <div>
              <h2>Статусы заказов</h2>
              <p>Где сейчас находится поток</p>
            </div>
          </div>
          <div className="ax-status">
            {data.byStatus.map((row, i) => (
              <div
                key={row.name}
                className={`ax-status__row ax-status__row--${statusTone(row.name)}`}
                style={{ '--i': i } as React.CSSProperties}
              >
                <div className="ax-status__meta">
                  <b>{STATUS_LABELS[row.name] || row.name}</b>
                  <span>{row.pct}%</span>
                </div>
                <div className="ax-status__track">
                  <div
                    className="ax-status__fill"
                    style={{ width: `${Math.max(4, (row.count / maxStatus) * 100)}%` }}
                  />
                </div>
                <strong className="ax-status__n">{row.count}</strong>
              </div>
            ))}
            {data.byStatus.length === 0 && <p className="admin-muted">Нет заказов за период</p>}
          </div>
        </section>
      </div>

      <div className="ax-grid-3">
        <section className="ax-panel card">
          <RankList title="Топ маршрутов" items={data.topCityRoutes} accent="lime" />
          <RankList title="Страны назначения" items={data.topDestCountries} accent="teal" />
        </section>
        <section className="ax-panel card">
          <RankList title="Размеры посылок" items={data.topOrderSizes} accent="ink" />
          <RankList title="Связки режимов" items={data.topModePairs} accent="teal" />
          <RankList title="Кто платит" items={data.topPayers} accent="lime" />
        </section>
        <section className="ax-panel card">
          <RankList title="Дни недели" items={data.byWeekday} accent="ink" />
          <h3 className="ax-rank__title">Часы активности</h3>
          <div className="ax-hours">
            {data.byHour.map((h, i) => (
              <div
                key={h.name}
                className="ax-hours__col"
                style={{ '--i': i, '--h': `${Math.max(6, (h.count / maxHour) * 100)}%` } as React.CSSProperties}
                title={`${h.name}: ${h.count}`}
              >
                <span className="ax-hours__bar" />
                <span className="ax-hours__label">{h.name.slice(0, 2)}</span>
              </div>
            ))}
            {data.byHour.length === 0 && <p className="admin-muted">Нет данных</p>}
          </div>
        </section>
      </div>

      <div className="ax-grid-2">
        <section className="ax-panel card">
          <div className="ax-panel__head">
            <div>
              <h2>Воронка калькулятора</h2>
              <p>Live · клики «Оплатить» {data.payClicks} · checkout {data.checkouts}</p>
            </div>
          </div>
          <div className="ax-funnel">
            {data.funnel.map((row, i) => (
              <div key={row.step} className="ax-funnel__row" style={{ '--i': i } as React.CSSProperties}>
                <div className="ax-funnel__step">
                  <span className="ax-funnel__num">{row.step}</span>
                  <div>
                    <b>{CALC_STEP_LABELS[row.step] || `Step ${row.step}`}</b>
                    {row.step > 1 && row.dropOffPct > 0 && (
                      <small className="ax-funnel__drop">−{row.dropOffPct}%</small>
                    )}
                  </div>
                </div>
                <div className="ax-funnel__track">
                  <div
                    className="ax-funnel__fill"
                    style={{ width: `${Math.max(data.sessions ? 3 : 0, (row.reached / maxReached) * 100)}%` }}
                  />
                </div>
                <div className="ax-funnel__stats">
                  <strong>{row.reached}</strong>
                  <span>{row.pctOfSessions}%</span>
                </div>
              </div>
            ))}
          </div>
          {data.sessions === 0 && (
            <p className="ax-empty">Пока нет live-сессий — откройте калькулятор на сайте, и воронка оживёт.</p>
          )}
        </section>

        <section className="ax-panel card">
          <RankList title="Интерес в калькуляторе" items={data.topCalcRoutes} empty="Появится после проходов" accent="lime" />
          <RankList title="Размеры в калькуляторе" items={data.topCalcSizes} accent="ink" />
          <RankList title="Страницы сайта" items={data.topPages} accent="teal" />
          <RankList title="Языки интерфейса" items={data.topLocales} accent="ink" />
        </section>
      </div>
    </div>
  );
}

function OrdersTab() {
  const [orders, setOrders] = useState<any[]>([]);
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<any | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetchAdminOrders({ status, q });
      setOrders(res.orders);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    }
  }, [status, q]);

  useEffect(() => { load(); }, [load]);

  const openOrder = async (id: string) => {
    setLoadingDetail(true);
    setError('');
    try {
      const res = await fetchAdminOrder(id);
      setSelected(res.order);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
      setSelected(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const changeStatus = async (id: string, next: string) => {
    setSaving(true);
    try {
      await updateAdminOrder(id, { status: next });
      await load();
      if (selected?.id === id) {
        const detail = await fetchAdminOrder(id);
        setSelected(detail.order);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  const cancelOrder = async (order: { id: string; orderNumber?: string }) => {
    const num = order.orderNumber || order.id;
    if (!window.confirm(`Отменить заказ ${num}?`)) return;
    await changeStatus(order.id, 'cancelled');
  };

  const retryNp = async (order: { id: string; publicToken?: string; orderNumber?: string }) => {
    if (!order.publicToken) {
      setError('Нет publicToken у заказа');
      return;
    }
    if (!window.confirm(`Создать заявку в Nova Post для ${order.orderNumber || order.id}?`)) return;
    setSaving(true);
    setError('');
    try {
      await retryAdminOrderNp(order.publicToken);
      await load();
      const detail = await fetchAdminOrder(order.id);
      setSelected(detail.order);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка Nova Post');
    } finally {
      setSaving(false);
    }
  };

  const priceLog = selected?.priceBreakdown?.log as
    | Array<{ step: number; title: string; detail?: string; value: number }>
    | undefined;
  const deliveryLabel = selected?.deliveryMode
    ? (MODE_LABELS[selected.deliveryMode] || selected.deliveryMode)
    : null;

  return (
    <div className="admin-section admin-section--fluid admin-section--animate">
      <header className="admin-page-head">
        <div>
          <p className="admin-page-kicker">Операции</p>
          <h1>Заказы</h1>
          <p>Все отправления, статусы и контакты — клик по строке открывает карточку</p>
        </div>
        <div className="admin-page-stats">
          <div className="admin-page-stat">
            <span>На экране</span>
            <b>{orders.length}</b>
          </div>
        </div>
      </header>

      {error && <div className="admin-alert">{error}</div>}

      <div className="admin-orders-bar card">
        <label className="admin-search-wrap">
          <span className="admin-search-wrap__icon" aria-hidden>⌕</span>
          <input
            className="admin-search"
            placeholder="Поиск: номер, email, телефон, ФИО…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <div className="admin-status-chips" role="tablist" aria-label="Фильтр статуса">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={status === f.id}
              className={`admin-status-chip${status === f.id ? ' is-active' : ''}`}
              onClick={() => setStatus(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="admin-table-shell card admin-desktop-only">
        <div className="admin-table-wrap admin-table-wrap--flush">
          <table className="admin-table admin-table--orders">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Номер</th>
                <th>Отправитель</th>
                <th>Телефон</th>
                <th>Маршрут</th>
                <th>Статус</th>
                <th>Сумма</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const parts = formatDateParts(o.createdAt);
                return (
                  <tr
                    key={o.id}
                    className={`admin-table__row--clickable${selected?.id === o.id ? ' is-selected' : ''}`}
                    onClick={() => openOrder(o.id)}
                  >
                    <td>
                      <div className="admin-cell-date">
                        <strong>{parts.day}</strong>
                        <span>{parts.time}</span>
                      </div>
                    </td>
                    <td>
                      <div className="admin-cell-order">
                        <b>{o.orderNumber}</b>
                        {o.npTtn && <span className="admin-ttn-chip">ТТН {o.npTtn}</span>}
                      </div>
                    </td>
                    <td>
                      <span className="admin-cell-name">{o.senderName || '—'}</span>
                    </td>
                    <td>
                      <span className="admin-cell-mono">{o.senderPhone || o.receiverPhone || '—'}</span>
                    </td>
                    <td>
                      <span className="admin-route">
                        <span>{o.fromCountry}</span>
                        <span className="admin-route__arrow" aria-hidden>→</span>
                        <span>{o.toCountry}</span>
                      </span>
                    </td>
                    <td>
                      <span className={`admin-badge admin-badge--${o.status}`}>
                        {STATUS_LABELS[o.status] || o.status}
                      </span>
                    </td>
                    <td className="admin-cell-amount">
                      {formatMoney(o.amount, o.currency)}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="admin-row-actions">
                        <button
                          type="button"
                          className="admin-action-btn"
                          onClick={() => openOrder(o.id)}
                        >
                          Открыть
                        </button>
                        {o.status !== 'cancelled' && (
                          <button
                            type="button"
                            className="admin-action-btn admin-action-btn--danger"
                            disabled={saving}
                            onClick={() => cancelOrder(o)}
                          >
                            Отменить
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <div className="admin-empty">
                      <b>Заказов нет</b>
                      <span>Измените фильтр или подождите новые заявки</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="admin-card-list admin-mobile-only">
        {orders.map((o, i) => {
          const parts = formatDateParts(o.createdAt);
          return (
            <article
              key={o.id}
              className={`admin-item-card admin-item-card--tap${selected?.id === o.id ? ' is-selected' : ''}`}
              style={{ '--delay': `${80 + i * 35}ms` } as React.CSSProperties}
              onClick={() => openOrder(o.id)}
            >
              <div className="admin-item-card__top">
                <div className="admin-item-card__meta">
                  <span>{parts.day} · {parts.time}</span>
                  <span className="admin-route admin-route--compact">
                    <span>{o.fromCountry}</span>
                    <span className="admin-route__arrow" aria-hidden>→</span>
                    <span>{o.toCountry}</span>
                  </span>
                </div>
                <span className={`admin-badge admin-badge--${o.status}`}>
                  {STATUS_LABELS[o.status] || o.status}
                </span>
              </div>
              <b className="admin-item-card__id">{o.orderNumber}</b>
              {o.npTtn && <span className="admin-ttn-chip">ТТН {o.npTtn}</span>}
              <div className="admin-item-card__row">
                <span>Отправитель</span>
                <strong>{o.senderName || '—'}</strong>
              </div>
              <div className="admin-item-card__row">
                <span>Телефон</span>
                <strong>{o.senderPhone || o.receiverPhone || '—'}</strong>
              </div>
              <div className="admin-item-card__row">
                <span>Сумма</span>
                <strong className="admin-item-card__amount">{formatMoney(o.amount, o.currency)}</strong>
              </div>
              <div className="admin-item-card__actions" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="admin-action-btn" onClick={() => openOrder(o.id)}>
                  Открыть
                </button>
                {o.status !== 'cancelled' && (
                  <button
                    type="button"
                    className="admin-action-btn admin-action-btn--danger"
                    disabled={saving}
                    onClick={() => cancelOrder(o)}
                  >
                    Отменить
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {orders.length === 0 && (
          <div className="admin-empty card">
            <b>Заказов нет</b>
            <span>Измените фильтр или подождите новые заявки</span>
          </div>
        )}
      </div>

      {(loadingDetail || selected) && (
        <div
          className={`admin-drawer-overlay${selected ? ' is-open' : ''}`}
          onClick={() => setSelected(null)}
        >
          <aside
            className={`admin-drawer card${selected ? ' is-open' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="admin-drawer__grab" aria-hidden />
            {!selected ? (
              <p className="admin-muted">Загрузка заказа…</p>
            ) : (
              <>
                <header className="admin-drawer__head">
                  <div>
                    <p className="admin-eyebrow">Заказ</p>
                    <h2>{selected.orderNumber}</h2>
                  </div>
                  <button type="button" className="admin-close" onClick={() => setSelected(null)}>×</button>
                </header>

                <div className="admin-drawer-hero">
                  <div>
                    <span>Сумма</span>
                    <b>{formatMoney(selected.amount, selected.currency)}</b>
                  </div>
                  <span className={`admin-badge admin-badge--${selected.status}`}>
                    {STATUS_LABELS[selected.status] || selected.status}
                  </span>
                </div>

                <dl className="admin-dl">
                  <div><dt>Email</dt><dd>{selected.customerEmail || '—'}</dd></div>
                  <div><dt>Отправитель</dt><dd>{selected.senderName || '—'} · {selected.senderPhone || '—'}</dd></div>
                  <div><dt>Получатель</dt><dd>{selected.receiverName || '—'} · {selected.receiverPhone || '—'}</dd></div>
                  <div><dt>Маршрут</dt><dd>{selected.fromCountry} → {selected.toCountry}</dd></div>
                  <div><dt>Доставка</dt><dd>{deliveryLabel || '—'}</dd></div>
                  <div><dt>Размер / вес</dt><dd>{selected.parcelSize || '—'} · {selected.weightKg ?? '—'} кг</dd></div>
                  <div><dt>ТТН</dt><dd>{selected.npTtn || '—'}</dd></div>
                  <div><dt>Создан</dt><dd>{formatDate(selected.createdAt)}</dd></div>
                  <div><dt>Оплачен</dt><dd>{formatDate(selected.paidAt)}</dd></div>
                  {selected.npSnapshot?.error && (
                    <div><dt>Ошибка NP</dt><dd className="admin-danger-text">{selected.npSnapshot.error}</dd></div>
                  )}
                </dl>

                <section className="admin-order-price">
                  <h3>Как сложилась стоимость</h3>
                  {selected.priceRecomputed && (
                    <p className="admin-muted">Пересчитано по текущим тарифам (в заказе не было сохранённого лога).</p>
                  )}
                  {priceLog?.length ? (
                    <ol className="admin-price-log">
                      {priceLog.map((row) => (
                        <li key={`${row.step}-${row.title}`}>
                          <div>
                            <b>{row.title}</b>
                            {row.detail && <small>{row.detail}</small>}
                          </div>
                          <span>{row.value} {selected.currency || selected.priceBreakdown?.currency || 'HUF'}</span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="admin-muted">Нет данных о составе цены для этого заказа.</p>
                  )}
                </section>

                <label className="admin-field">
                  <span>Сменить статус</span>
                  <select
                    value={selected.status}
                    disabled={saving}
                    onChange={(e) => changeStatus(selected.id, e.target.value)}
                  >
                    {Object.entries(STATUS_LABELS).map(([id, label]) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </select>
                </label>

                {selected.status !== 'cancelled' ? (
                  <div className="admin-drawer__actions">
                    {(selected.status === 'paid' || (!selected.npTtn && selected.paidAt)) && (
                      <button
                        type="button"
                        className="btn btn-lime"
                        disabled={saving}
                        onClick={() => retryNp(selected)}
                      >
                        Создать в Nova Post
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-outline admin-btn--danger"
                      disabled={saving}
                      onClick={() => cancelOrder(selected)}
                    >
                      Отменить заказ
                    </button>
                  </div>
                ) : (
                  <p className="admin-muted" style={{ marginTop: 12 }}>
                    Заказ отменён{selected.cancelledAt ? ` · ${formatDate(selected.cancelledAt)}` : ''}
                  </p>
                )}
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function emptyUserForm() {
  return { name: '', email: '', phone: '', password: '', login: '', type: 'client' as 'client' | 'admin' };
}

function UsersTab() {
  const [users, setUsers] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ user: any; orders: any[] } | null>(null);
  const [form, setForm] = useState(emptyUserForm());
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState(emptyUserForm());
  const [saving, setSaving] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetchAdminUsers();
      setUsers(res.users);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openUser = async (id: string) => {
    setSelectedId(id);
    setCreating(false);
    setLoadingDetail(true);
    setMsg('');
    setError('');
    try {
      const res = await fetchAdminUser(id);
      setDetail(res);
      setForm({
        name: res.user.name || '',
        email: res.user.email || '',
        phone: res.user.phone || '',
        login: res.user.login || '',
        password: '',
        type: res.user.type === 'admin' ? 'admin' : 'client',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
      setSelectedId(null);
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const closeDrawer = () => {
    setSelectedId(null);
    setDetail(null);
    setCreating(false);
    setForm(emptyUserForm());
    setCreateForm(emptyUserForm());
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((u) =>
      [u.name, u.login, u.email, u.phone].some((v) => String(v || '').toLowerCase().includes(needle)),
    );
  }, [users, q]);

  const saveUser = async () => {
    if (!selectedId) return;
    setSaving(true);
    setMsg('');
    setError('');
    try {
      const payload: {
        name: string;
        email: string;
        phone: string;
        password?: string;
        type: 'client' | 'admin';
        login: string;
      } = {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        type: form.type,
        login: form.login.trim(),
      };
      if (form.password.trim()) payload.password = form.password.trim();
      const res = await updateAdminUser(selectedId, payload);
      setDetail((prev) => (prev ? { ...prev, user: res.user } : prev));
      setForm((f) => ({ ...f, password: '' }));
      setMsg('Данные сохранены');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  const createUser = async () => {
    setSaving(true);
    setMsg('');
    setError('');
    try {
      const res = await createAdminUser({
        name: createForm.name.trim(),
        email: createForm.email.trim(),
        phone: createForm.phone.trim(),
        password: createForm.password.trim(),
        type: createForm.type,
        login: createForm.login.trim() || createForm.email.trim().split('@')[0],
      });
      setMsg('Пользователь создан');
      setCreating(false);
      setCreateForm(emptyUserForm());
      await load();
      await openUser(res.user.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  const removeUser = async (id: string, name: string) => {
    if (!window.confirm(`Удалить пользователя «${name}»? Это действие нельзя отменить.`)) return;
    setSaving(true);
    setMsg('');
    setError('');
    try {
      await deleteAdminUser(id);
      setMsg('Пользователь удалён');
      if (selectedId === id) closeDrawer();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-section admin-section--animate">
      <header className="admin-section__head admin-section__head--row">
        <div>
          <h1>Пользователи</h1>
          <p>ФИО, контакты, активность — нажмите на строку, чтобы открыть карточку</p>
        </div>
        <button
          type="button"
          className="btn btn-lime"
          onClick={() => {
            setCreating(true);
            setSelectedId(null);
            setDetail(null);
            setCreateForm(emptyUserForm());
            setMsg('');
            setError('');
          }}
        >
          + Добавить
        </button>
      </header>
      {error && <div className="admin-alert">{error}</div>}
      {msg && <div className="admin-ok">{msg}</div>}
      <div className="admin-toolbar">
        <input
          className="admin-search"
          placeholder="Поиск: ФИО, email, телефон…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="admin-table-wrap card admin-desktop-only">
        <table className="admin-table">
          <thead>
            <tr>
              <th>ФИО</th>
              <th>Роль</th>
              <th>Логин</th>
              <th>Email</th>
              <th>Телефон</th>
              <th>Заказов</th>
              <th>За 30 дней</th>
              <th>Регистрация</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr
                key={u.id}
                className="admin-table__row--clickable"
                onClick={() => openUser(u.id)}
              >
                <td><b>{u.name}</b></td>
                <td>
                  <span className={`admin-badge admin-badge--role-${u.type === 'admin' ? 'admin' : 'client'}`}>
                    {u.type === 'admin' ? 'Админ' : 'Клиент'}
                  </span>
                </td>
                <td>{u.login || u.email?.split('@')[0] || '—'}</td>
                <td>{u.email}</td>
                <td>{u.phone || '—'}</td>
                <td>{u.ordersCount}</td>
                <td>{u.monthlyShipments}</td>
                <td>{formatDate(u.createdAt)}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="admin-row-actions">
                    <button type="button" className="text-link" onClick={() => openUser(u.id)}>
                      Открыть
                    </button>
                    <button
                      type="button"
                      className="text-link text-link--danger"
                      disabled={saving}
                      onClick={() => removeUser(u.id, u.name)}
                    >
                      Удалить
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="admin-muted">Пользователей нет</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="admin-card-list admin-mobile-only">
        {filtered.map((u, i) => (
          <article
            key={u.id}
            className="admin-item-card admin-item-card--tap"
            style={{ '--delay': `${60 + i * 35}ms` } as React.CSSProperties}
            onClick={() => openUser(u.id)}
          >
            <div className="admin-item-card__top">
              <b className="admin-item-card__name">{u.name}</b>
              <span className={`admin-badge admin-badge--role-${u.type === 'admin' ? 'admin' : 'client'}`}>
                {u.type === 'admin' ? 'Админ' : 'Клиент'}
              </span>
            </div>
            <div className="admin-item-card__row">
              <span>Логин</span>
              <strong>{u.login || u.email?.split('@')[0] || '—'}</strong>
            </div>
            <div className="admin-item-card__row">
              <span>Email</span>
              <strong className="admin-item-card__break">{u.email}</strong>
            </div>
            <div className="admin-item-card__row">
              <span>Телефон</span>
              <strong>{u.phone || '—'}</strong>
            </div>
            <div className="admin-item-card__stats">
              <div>
                <span>Заказов</span>
                <b>{u.ordersCount}</b>
              </div>
              <div>
                <span>За 30 дней</span>
                <b>{u.monthlyShipments}</b>
              </div>
              <div>
                <span>Регистрация</span>
                <b>{formatDate(u.createdAt)}</b>
              </div>
            </div>
            <div className="admin-item-card__actions" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="admin-action-btn" onClick={() => openUser(u.id)}>
                Открыть
              </button>
              <button
                type="button"
                className="admin-action-btn admin-action-btn--danger"
                disabled={saving}
                onClick={() => removeUser(u.id, u.name)}
              >
                Удалить
              </button>
            </div>
          </article>
        ))}
        {filtered.length === 0 && (
          <div className="admin-empty card">
            <b>Пользователей нет</b>
          </div>
        )}
      </div>

      {(creating || selectedId) && (
        <div className="admin-drawer-overlay" onClick={closeDrawer}>
          <aside className="admin-drawer card" onClick={(e) => e.stopPropagation()}>
            <div className="admin-drawer__grab" aria-hidden />
            {error && <div className="admin-alert">{error}</div>}
            {msg && <div className="admin-ok">{msg}</div>}
            {creating ? (
              <>
                <header className="admin-drawer__head">
                  <div>
                    <p className="admin-eyebrow">Новый пользователь</p>
                    <h2>Создание</h2>
                  </div>
                  <button type="button" className="admin-close" onClick={closeDrawer}>×</button>
                </header>
                <div className="admin-user-form">
                  <label className="admin-field">
                    <span>Тип аккаунта</span>
                    <select
                      value={createForm.type}
                      onChange={(e) => setCreateForm({
                        ...createForm,
                        type: e.target.value === 'admin' ? 'admin' : 'client',
                      })}
                    >
                      <option value="client">Обычный пользователь</option>
                      <option value="admin">Админ</option>
                    </select>
                  </label>
                  <label className="admin-field">
                    <span>ФИО</span>
                    <input
                      value={createForm.name}
                      onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                      placeholder="Имя Фамилия"
                    />
                  </label>
                  <label className="admin-field">
                    <span>Логин</span>
                    <input
                      value={createForm.login}
                      onChange={(e) => setCreateForm({ ...createForm, login: e.target.value })}
                      placeholder="Например admin1"
                      autoComplete="off"
                    />
                  </label>
                  <label className="admin-field">
                    <span>Email</span>
                    <input
                      type="email"
                      value={createForm.email}
                      onChange={(e) => {
                        const email = e.target.value;
                        const next = { ...createForm, email };
                        if (!createForm.login.trim()) {
                          next.login = email.includes('@') ? email.split('@')[0] : email;
                        }
                        setCreateForm(next);
                      }}
                      placeholder="user@email.com"
                    />
                  </label>
                  <label className="admin-field">
                    <span>Телефон</span>
                    <input
                      value={createForm.phone}
                      onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })}
                      placeholder="+36 …"
                    />
                  </label>
                  <label className="admin-field">
                    <span>Пароль</span>
                    <input
                      type="password"
                      value={createForm.password}
                      onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                      placeholder="Минимум 8 символов"
                    />
                  </label>
                  <div className="admin-drawer__actions">
                    <button type="button" className="btn btn-lime" disabled={saving} onClick={createUser}>
                      {saving ? 'Создание…' : 'Создать'}
                    </button>
                    <button type="button" className="btn btn-outline" onClick={closeDrawer}>Отмена</button>
                  </div>
                </div>
              </>
            ) : loadingDetail || !detail ? (
              <p className="admin-muted">Загрузка…</p>
            ) : (
              <>
                <header className="admin-drawer__head">
                  <div>
                    <p className="admin-eyebrow">Карточка пользователя</p>
                    <h2>{detail.user.name}</h2>
                  </div>
                  <button type="button" className="admin-close" onClick={closeDrawer}>×</button>
                </header>

                <dl className="admin-dl">
                  <div>
                    <dt>Роль</dt>
                    <dd>{detail.user.type === 'admin' ? 'Админ' : 'Клиент'}</dd>
                  </div>
                  <div>
                    <dt>Регистрация</dt>
                    <dd>{formatDate(detail.user.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Заказов</dt>
                    <dd>{detail.orders.length}</dd>
                  </div>
                </dl>

                <div className="admin-user-form">
                  <h3 className="admin-drawer__subtitle">Редактирование</h3>
                  <label className="admin-field">
                    <span>Тип аккаунта</span>
                    <select
                      value={form.type}
                      onChange={(e) => setForm({
                        ...form,
                        type: e.target.value === 'admin' ? 'admin' : 'client',
                      })}
                    >
                      <option value="client">Обычный пользователь</option>
                      <option value="admin">Админ</option>
                    </select>
                  </label>
                  <label className="admin-field">
                    <span>ФИО</span>
                    <input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </label>
                  <label className="admin-field">
                    <span>Логин</span>
                    <input
                      value={form.login}
                      onChange={(e) => setForm({ ...form, login: e.target.value })}
                      autoComplete="off"
                    />
                  </label>
                  <label className="admin-field">
                    <span>Email</span>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                  </label>
                  <label className="admin-field">
                    <span>Телефон</span>
                    <input
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    />
                  </label>
                  <label className="admin-field">
                    <span>Новый пароль</span>
                    <input
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      placeholder="Оставьте пустым, чтобы не менять"
                    />
                  </label>
                  <div className="admin-drawer__actions">
                    <button type="button" className="btn btn-lime" disabled={saving} onClick={saveUser}>
                      {saving ? 'Сохранение…' : 'Сохранить'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline admin-btn--danger"
                      disabled={saving}
                      onClick={() => removeUser(detail.user.id, detail.user.name)}
                    >
                      Удалить
                    </button>
                  </div>
                </div>

                <div className="admin-user-orders">
                  <h3 className="admin-drawer__subtitle">Заказы</h3>
                  {detail.orders.length === 0 ? (
                    <p className="admin-muted">Заказов пока нет</p>
                  ) : (
                    <ul className="admin-user-order-list">
                      {detail.orders.slice(0, 12).map((o) => (
                        <li key={o.id}>
                          <b>{o.orderNumber}</b>
                          <span>{formatDate(o.createdAt)}</span>
                          <span className={`admin-badge admin-badge--${o.status}`}>
                            {STATUS_LABELS[o.status] || o.status}
                          </span>
                          <span>{formatMoney(o.amount, o.currency)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function SettingsTab() {
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchAdminSettings()
      .then((r) => setSettings(r.settings))
      .catch((e) => setError(e.message));
  }, []);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setMsg('');
    setError('');
    try {
      const res = await saveAdminSettings(settings);
      setSettings(res.settings);
      setMsg('Настройки сохранены');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return <p className="admin-muted">{error || 'Загрузка…'}</p>;

  return (
    <div className="admin-section admin-section--animate">
      <header className="admin-section__head">
        <h1>Настройки</h1>
        <p>НДС, округление, валюта и курсы</p>
      </header>
      {error && <div className="admin-alert">{error}</div>}
      {msg && <div className="admin-ok">{msg}</div>}

      <section className="card admin-panel admin-settings">
        <h2>НДС</h2>
        <label className="admin-switch">
          <input
            type="checkbox"
            checked={settings.vatEnabled}
            onChange={(e) => setSettings({ ...settings, vatEnabled: e.target.checked })}
          />
          <span>Включить НДС в цене для клиента</span>
        </label>
        <div className="admin-fields-row">
          <label className="admin-field admin-field--sm">
            <span>Процент НДС</span>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={settings.vatPercent}
              disabled={!settings.vatEnabled}
              onChange={(e) => setSettings({ ...settings, vatPercent: Number(e.target.value) })}
            />
          </label>
        </div>
      </section>

      <section className="card admin-panel admin-settings">
        <h2>Округление суммы</h2>
        <label className="admin-switch">
          <input
            type="checkbox"
            checked={settings.roundingEnabled}
            onChange={(e) => setSettings({ ...settings, roundingEnabled: e.target.checked })}
          />
          <span>Округлять итоговую цену</span>
        </label>
        <div className="admin-fields-row">
          <label className="admin-field admin-field--md">
            <span>Шаг округления</span>
            <select
              value={settings.roundingStep}
              disabled={!settings.roundingEnabled}
              onChange={(e) => setSettings({ ...settings, roundingStep: Number(e.target.value) as 10 | 100 | 1000 })}
            >
              <option value={10}>до 10 HUF</option>
              <option value={100}>до 100 HUF</option>
              <option value={1000}>до 1000 HUF</option>
            </select>
          </label>
        </div>
      </section>

      <section className="card admin-panel admin-settings">
        <h2>Валюта</h2>
        <div className="admin-fields-row">
          <label className="admin-field admin-field--md">
            <span>Валюта прайса и оплаты</span>
            <select
              value={settings.currency}
              onChange={(e) => setSettings({ ...settings, currency: e.target.value })}
            >
              <option value="HUF">HUF — форинт</option>
              <option value="EUR">EUR — евро</option>
              <option value="PLN">PLN — злотый</option>
              <option value="CZK">CZK — крона</option>
              <option value="RON">RON — лей</option>
            </select>
          </label>
        </div>
        <div className="admin-fx-grid">
          {Object.entries(settings.fxFromEur || {}).map(([code, rate]) => (
            <label key={code} className="admin-field admin-field--sm">
              <span>EUR → {code}</span>
              <input
                type="number"
                step="0.01"
                value={Number(rate)}
                onChange={(e) => setSettings({
                  ...settings,
                  fxFromEur: { ...settings.fxFromEur, [code]: Number(e.target.value) },
                })}
              />
            </label>
          ))}
        </div>
      </section>

      <section className="card admin-panel admin-settings">
        <h2>Доп. услуги</h2>
        <div className="admin-fields-row">
          <label className="admin-field admin-field--sm">
            <span>Хрупкое (EUR)</span>
            <input
              type="number"
              step="0.01"
              value={settings.fragileFeeEur}
              onChange={(e) => setSettings({ ...settings, fragileFeeEur: Number(e.target.value) })}
            />
          </label>
          <label className="admin-field admin-field--sm">
            <span>Страховка (% от тарифа доставки)</span>
            <input
              type="number"
              step="0.1"
              value={settings.insurancePercent}
              onChange={(e) => setSettings({ ...settings, insurancePercent: Number(e.target.value) })}
            />
          </label>
        </div>
      </section>

      <button className="btn btn-lime" type="button" disabled={saving} onClick={save}>
        {saving ? 'Сохраняем…' : 'Сохранить настройки'}
      </button>
    </div>
  );
}

function PromosTab() {
  const [promos, setPromos] = useState<AdminPromo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    code: '',
    type: 'percent' as 'percent' | 'fixed',
    value: '',
    maxUses: '',
    expiresAt: '',
    note: '',
    active: true,
  });

  const reload = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchAdminPromos();
      setPromos(res.promos || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const create = async () => {
    setSaving(true);
    setMsg('');
    setError('');
    try {
      await createAdminPromo({
        code: form.code,
        type: form.type,
        value: Number(form.value),
        active: form.active,
        maxUses: form.maxUses.trim() ? Number(form.maxUses) : null,
        expiresAt: form.expiresAt.trim() || null,
        note: form.note,
      });
      setForm({
        code: '',
        type: 'percent',
        value: '',
        maxUses: '',
        expiresAt: '',
        note: '',
        active: true,
      });
      setMsg('Промокод создан');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (promo: AdminPromo) => {
    setError('');
    try {
      await setAdminPromoActive(promo.id, !promo.active);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось обновить');
    }
  };

  const remove = async (promo: AdminPromo) => {
    if (!window.confirm(`Удалить промокод ${promo.code}?`)) return;
    setError('');
    try {
      await deleteAdminPromo(promo.id);
      setMsg(`Удалён ${promo.code}`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось удалить');
    }
  };

  const formatPromoValue = (p: AdminPromo) => (
    p.type === 'fixed'
      ? `−${Math.round(Number(p.value)).toLocaleString('ru-RU')} HUF`
      : `−${Number(p.value)}%`
  );

  return (
    <div className="admin-section admin-section--animate">
      <header className="admin-section__head">
        <h1>Промокоды</h1>
        <p>Скидка процентом или фиксированной суммой на шаге оплаты</p>
      </header>
      {error && <div className="admin-alert">{error}</div>}
      {msg && <div className="admin-ok">{msg}</div>}

      <section className="card admin-panel admin-settings">
        <h2>Новый промокод</h2>
        <div className="admin-fields-row">
          <label className="admin-field admin-field--md">
            <span>Код</span>
            <input
              value={form.code}
              placeholder="MATE20"
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            />
          </label>
          <label className="admin-field admin-field--sm">
            <span>Тип</span>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as 'percent' | 'fixed' })}
            >
              <option value="percent">Процент %</option>
              <option value="fixed">Сумма (HUF)</option>
            </select>
          </label>
          <label className="admin-field admin-field--sm">
            <span>{form.type === 'fixed' ? 'Сумма' : 'Процент'}</span>
            <input
              type="number"
              min={0}
              step={form.type === 'fixed' ? 10 : 1}
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
            />
          </label>
        </div>
        <div className="admin-fields-row">
          <label className="admin-field admin-field--sm">
            <span>Макс. использований</span>
            <input
              type="number"
              min={1}
              placeholder="∞"
              value={form.maxUses}
              onChange={(e) => setForm({ ...form, maxUses: e.target.value })}
            />
          </label>
          <label className="admin-field admin-field--md">
            <span>Действует до</span>
            <input
              type="datetime-local"
              value={form.expiresAt}
              onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
            />
          </label>
          <label className="admin-field admin-field--md">
            <span>Заметка</span>
            <input
              value={form.note}
              placeholder="Для Instagram"
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </label>
        </div>
        <label className="admin-switch">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
          />
          <span>Активен сразу после создания</span>
        </label>
        <button className="btn btn-lime" type="button" disabled={saving} onClick={create}>
          {saving ? 'Создаём…' : 'Добавить промокод'}
        </button>
      </section>

      <section className="card admin-panel">
        <h2>Список</h2>
        {loading ? (
          <p className="admin-muted">Загрузка…</p>
        ) : promos.length === 0 ? (
          <p className="admin-muted">Пока нет промокодов</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Код</th>
                  <th>Скидка</th>
                  <th>Использовано</th>
                  <th>До</th>
                  <th>Статус</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {promos.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <b>{p.code}</b>
                      {p.note ? <><br /><small>{p.note}</small></> : null}
                    </td>
                    <td>{formatPromoValue(p)}</td>
                    <td>
                      {p.usedCount}
                      {p.maxUses != null ? ` / ${p.maxUses}` : ''}
                    </td>
                    <td>{p.expiresAt ? formatDate(p.expiresAt) : '—'}</td>
                    <td>
                      <span className={`admin-status${p.active ? ' admin-status--ok' : ''}`}>
                        {p.active ? 'Активен' : 'Выключен'}
                      </span>
                    </td>
                    <td className="admin-table__actions">
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => toggle(p)}>
                        {p.active ? 'Выкл.' : 'Вкл.'}
                      </button>
                      {' '}
                      <button type="button" className="btn admin-btn--danger btn-sm" onClick={() => remove(p)}>
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function PricingTab() {
  const [pricing, setPricing] = useState<AdminPricing | null>(null);
  const [mode, setMode] = useState('locker');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewCountry, setPreviewCountry] = useState('DE');
  const [previewWeight, setPreviewWeight] = useState('20');
  const [previewShipments, setPreviewShipments] = useState('1');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewLog, setPreviewLog] = useState<Array<{ step: number; title: string; detail?: string; value: number }> | null>(null);
  const [previewTotal, setPreviewTotal] = useState<number | null>(null);
  const [previewCurrency, setPreviewCurrency] = useState('HUF');

  useEffect(() => {
    fetchAdminPricing()
      .then((r) => setPricing(r.pricing))
      .catch((e) => setError(e.message));
  }, []);

  const destinations = pricing?.destinations || [];
  const weightRows = pricing?.weightRows || [];

  const onCellBlur = async (weightKey: string, dest: string, raw: string) => {
    const value = Number(String(raw).replace(/\s/g, ''));
    if (!Number.isFinite(value) || value < 0) return;
    const prev = pricing?.costPrices?.[mode]?.[weightKey]?.[dest];
    if (prev != null && Math.round(Number(prev)) === Math.round(value)) return;
    try {
      setError('');
      const res = await savePricingCell({ mode, weightKey, dest, value });
      setPricing(res.pricing);
      setMsg(`Ячейка ${mode} / ${weightKey} / ${dest} сохранена`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  const saveMarkupsAndTiers = async () => {
    if (!pricing) return;
    setSaving(true);
    setMsg('');
    try {
      const res = await saveAdminPricing({
        weightMarkups: pricing.weightMarkups,
        tiers: pricing.tiers,
      });
      setPricing(res.pricing);
      setMsg('Наценки и уровни сохранены');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  const runPreview = async () => {
    setPreviewLoading(true);
    setError('');
    try {
      const res = await previewAdminPrice({
        toCountry: previewCountry,
        weightKg: Number(previewWeight) || 2,
        deliveryMode: mode,
        monthlyShipments: Number(previewShipments) || 1,
      });
      setPreviewTotal(res.amount);
      setPreviewCurrency(res.currency || 'HUF');
      setPreviewLog(res.breakdown?.log || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка превью');
    } finally {
      setPreviewLoading(false);
    }
  };

  const matrix = useMemo(() => pricing?.costPrices?.[mode] || {}, [pricing, mode]);

  if (!pricing) return <p className="admin-muted">{error || 'Загрузка…'}</p>;

  return (
    <div className="admin-section admin-section--animate">
      <header className="admin-section__head">
        <h1>Цены на доставку</h1>
        <p>Матрица = тариф без НДС. Клиенту: матрица × наценка − скидка уровня + НДС + округление. Правки в админке пишутся в БД и не затираются при рестарте.</p>
      </header>
      {error && <div className="admin-alert">{error}</div>}
      {msg && <div className="admin-ok">{msg}</div>}

      <section className="card admin-panel" style={{ marginBottom: 16 }}>
        <h2>Лог расчёта (превью)</h2>
        <div className="admin-fields-row">
          <label className="admin-field admin-field--sm">
            <span>Страна</span>
            <select value={previewCountry} onChange={(e) => setPreviewCountry(e.target.value)}>
              {destinations.filter((d) => d !== 'DOM').map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>
          <label className="admin-field admin-field--sm">
            <span>Вес, кг</span>
            <input value={previewWeight} onChange={(e) => setPreviewWeight(e.target.value)} />
          </label>
          <label className="admin-field admin-field--sm">
            <span>Отправок/мес</span>
            <input value={previewShipments} onChange={(e) => setPreviewShipments(e.target.value)} />
          </label>
          <button type="button" className="btn btn-outline" disabled={previewLoading} onClick={runPreview}>
            {previewLoading ? 'Считаем…' : 'Показать лог'}
          </button>
        </div>
        {previewTotal != null && (
          <p className="admin-ok" style={{ marginTop: 10 }}>
            Итого: <b>{previewTotal} {previewCurrency}</b> · режим «{MODE_LABELS[mode] || mode}»
          </p>
        )}
        {previewLog && (
          <ol className="admin-price-log">
            {previewLog.map((row) => (
              <li key={row.step}>
                <div>
                  <b>{row.title}</b>
                  {row.detail && <small>{row.detail}</small>}
                </div>
                <span>{row.value} {previewCurrency}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="admin-toolbar">
        <div className="admin-mode-tabs">
          {Object.entries(MODE_LABELS).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`admin-chip${mode === id ? ' active' : ''}`}
              onClick={() => setMode(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="admin-matrix-wrap card">
        <table className="admin-matrix">
          <thead>
            <tr>
              <th>Вес</th>
              {destinations.map((d) => <th key={d}>{d === 'DOM' ? 'DOM' : `HU-${d}`}</th>)}
            </tr>
          </thead>
          <tbody>
            {weightRows.map((row) => (
              <tr key={row.key}>
                <td className="admin-matrix__sticky">
                  <b>{row.label}</b>
                  <small>≤ {row.maxKg} кг</small>
                </td>
                {destinations.map((dest) => (
                  <td key={dest}>
                    <input
                      className="admin-matrix__input"
                      defaultValue={matrix[row.key]?.[dest] ?? ''}
                      key={`${mode}-${row.key}-${dest}-${matrix[row.key]?.[dest]}`}
                      onBlur={(e) => onCellBlur(row.key, dest, e.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="admin-grid-2">
        <section className="card admin-panel">
          <h2>Наценка по весу (уровень «Старт»)</h2>
          <div className="admin-markup-list">
            {pricing.weightMarkups.map((row, idx) => (
              <div key={idx} className="admin-markup-row">
                <label className="admin-field">
                  <span>До кг</span>
                  <input
                    type="number"
                    value={row.upToKg}
                    onChange={(e) => {
                      const next = [...pricing.weightMarkups];
                      next[idx] = { ...row, upToKg: Number(e.target.value) };
                      setPricing({ ...pricing, weightMarkups: next });
                    }}
                  />
                </label>
                <label className="admin-field">
                  <span>Наценка %</span>
                  <input
                    type="number"
                    value={row.percent}
                    onChange={(e) => {
                      const next = [...pricing.weightMarkups];
                      next[idx] = { ...row, percent: Number(e.target.value) };
                      setPricing({ ...pricing, weightMarkups: next });
                    }}
                  />
                </label>
              </div>
            ))}
          </div>
        </section>

        <section className="card admin-panel">
          <h2>Уровни клиентов</h2>
          <div className="admin-markup-list">
            {pricing.tiers.map((tier, idx) => (
              <div key={tier.id} className="admin-tier-row">
                <b>{tier.label}</b>
                <span>{tier.minShipments}–{tier.maxShipments ?? '∞'} / мес</span>
                <label className="admin-field">
                  <span>Скидка %</span>
                  <input
                    type="number"
                    value={tier.discountPercent ?? ''}
                    placeholder="по запросу"
                    onChange={(e) => {
                      const next = [...pricing.tiers];
                      const val = e.target.value === '' ? null : Number(e.target.value);
                      next[idx] = { ...tier, discountPercent: val };
                      setPricing({ ...pricing, tiers: next });
                    }}
                  />
                </label>
              </div>
            ))}
          </div>
        </section>
      </div>

      <button className="btn btn-lime" type="button" disabled={saving} onClick={saveMarkupsAndTiers}>
        {saving ? 'Сохраняем…' : 'Сохранить наценки и уровни'}
      </button>
    </div>
  );
}
