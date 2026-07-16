import { useCallback, useEffect, useMemo, useState } from 'react';
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
  type AdminPricing,
  type AdminSettings,
} from '../../api/admin';

type Tab = 'dashboard' | 'orders' | 'users' | 'pricing' | 'settings';

const NAV_ITEMS: { id: Tab; label: string; short: string }[] = [
  { id: 'dashboard', label: 'Дашборд', short: 'Главная' },
  { id: 'orders', label: 'Заказы', short: 'Заказы' },
  { id: 'users', label: 'Пользователи', short: 'Люди' },
  { id: 'pricing', label: 'Цены', short: 'Цены' },
  { id: 'settings', label: 'Настройки', short: 'Настр.' },
];

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
    default:
      return null;
  }
}

const MODE_LABELS: Record<string, string> = {
  branch: 'В филиал',
  locker: 'В постамат',
  address: 'На адрес',
};

const STATUS_LABELS: Record<string, string> = {
  pending_payment: 'Ожидает оплаты',
  paid: 'Оплачено',
  submitted: 'Отправлено',
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
  { id: 'paid', label: 'Оплачено' },
  { id: 'submitted', label: 'Отправлено' },
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
      <div className="admin-app admin-app--boot">
        <p>Загрузка админки…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="admin-app admin-login">
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
    orders: 'Заказы',
    users: 'Пользователи',
    pricing: 'Цены',
    settings: 'Настройки',
  };

  return (
    <div className={`admin-app${navOpen ? ' admin-app--nav-open' : ''}`}>
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
        {tab === 'orders' && <OrdersTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'pricing' && <PricingTab />}
        {tab === 'settings' && <SettingsTab />}
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
            <span>Страховка (%)</span>
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
    try {
      const res = await savePricingCell({ mode, weightKey, dest, value });
      setPricing(res.pricing);
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
        <p>Матрица = тариф без НДС (как в Excel / как у Nova Post). Клиенту: матрица − скидка уровня + НДС + округление</p>
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
