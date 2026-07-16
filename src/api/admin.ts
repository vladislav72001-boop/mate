import { getStoredToken } from './auth';

const ADMIN_TOKEN_KEY = 'mate_admin_token';

export function getAdminToken() {
  return localStorage.getItem(ADMIN_TOKEN_KEY) || getStoredToken();
}

export function storeAdminToken(token: string) {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminToken() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

async function adminRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAdminToken();
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data as T;
}

export type AdminSettings = {
  vatEnabled: boolean;
  vatPercent: number;
  roundingEnabled: boolean;
  roundingStep: 10 | 100 | 1000;
  currency: string;
  fxFromEur: Record<string, number>;
  fragileFeeEur: number;
  insurancePercent: number;
  updatedAt?: string;
};

export type AdminPricing = {
  costPrices: Record<string, Record<string, Record<string, number>>>;
  weightMarkups: Array<{ upToKg: number; percent: number }>;
  tiers: Array<{
    id: string;
    label: string;
    minShipments: number;
    maxShipments: number | null;
    discountPercent: number | null;
  }>;
  destinations: string[];
  weightRows: Array<{ key: string; label: string; maxKg: number; avgKg: number }>;
  updatedAt?: string;
};

export async function adminLogin(login: string, password: string) {
  const identifier = String(login || '').trim();
  return adminRequest<{ token: string; user: { id: string; name: string; email: string; type: string } }>(
    '/api/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({
        login: identifier,
        email: identifier === 'admin' ? 'admin@matedelivery.com' : identifier,
        password,
      }),
    },
  );
}

export async function fetchAdminDashboard() {
  return adminRequest<{
    stats: {
      totalOrders: number;
      pendingPayment: number;
      submitted: number;
      paid: number;
      cancelled: number;
      users: number;
      revenue: number;
      currency: string;
    };
    recentOrders: any[];
    recentUsers: any[];
  }>('/api/admin/dashboard');
}

export async function fetchAdminOrders(params: { status?: string; q?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.q) qs.set('q', params.q);
  const suffix = qs.toString() ? `?${qs}` : '';
  return adminRequest<{ orders: any[] }>(`/api/admin/orders${suffix}`);
}

export async function fetchAdminOrder(id: string) {
  return adminRequest<{ order: any }>(`/api/admin/orders/${id}`);
}

export async function updateAdminOrder(id: string, patch: Record<string, unknown>) {
  return adminRequest<{ order: any }>(`/api/admin/orders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function fetchAdminUsers() {
  return adminRequest<{ users: any[] }>('/api/admin/users');
}

export async function fetchAdminUser(id: string) {
  return adminRequest<{ user: any; orders: any[] }>(`/api/admin/users/${id}`);
}

export async function createAdminUser(payload: {
  name: string;
  email: string;
  phone: string;
  password: string;
  type?: 'client' | 'admin';
  login?: string;
}) {
  return adminRequest<{ user: any }>('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateAdminUser(
  id: string,
  payload: {
    name: string;
    email: string;
    phone: string;
    password?: string;
    type?: 'client' | 'admin';
    login?: string;
  },
) {
  return adminRequest<{ user: any }>(`/api/admin/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteAdminUser(id: string) {
  return adminRequest<{ ok: boolean; user: any }>(`/api/admin/users/${id}`, {
    method: 'DELETE',
  });
}

export async function fetchAdminSettings() {
  return adminRequest<{ settings: AdminSettings }>('/api/admin/settings');
}

export async function saveAdminSettings(patch: Partial<AdminSettings>) {
  return adminRequest<{ settings: AdminSettings }>('/api/admin/settings', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export async function fetchAdminPricing() {
  return adminRequest<{
    pricing: AdminPricing;
    meta: { modes: string[]; destinations: string[]; weightRows: AdminPricing['weightRows'] };
  }>('/api/admin/pricing');
}

export async function saveAdminPricing(patch: Partial<AdminPricing>) {
  return adminRequest<{ pricing: AdminPricing }>('/api/admin/pricing', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export async function savePricingCell(payload: {
  mode: string;
  weightKey: string;
  dest: string;
  value: number;
}) {
  return adminRequest<{ pricing: AdminPricing }>('/api/admin/pricing/cell', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function previewAdminPrice(payload: {
  toCountry: string;
  weightKg: number;
  deliveryMode: string;
  monthlyShipments?: number;
}) {
  return adminRequest<{
    amount: number | null;
    currency: string;
    breakdown: {
      log?: Array<{ step: number; title: string; detail?: string; value: number }>;
      cost?: number;
      total?: number;
      source?: string;
      [key: string]: unknown;
    } | null;
  }>('/api/admin/pricing/preview', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
