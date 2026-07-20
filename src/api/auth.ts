export type AuthUser = {
  id: string;
  name: string;
  email: string;
  login?: string;
  phone: string;
  type: 'client' | 'corp' | 'admin';
  createdAt: string;
  authProvider?: 'local' | 'google' | 'apple';
  needsPhone?: boolean;
  welcomeDiscountAvailable?: boolean;
};

type AuthResponse = {
  token: string;
  user: AuthUser;
  emailSent: boolean;
  emailPreview: string | null;
};

const TOKEN_KEY = 'mate_token';
const REQUEST_TIMEOUT_MS = 8000;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(path, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 502 || res.status === 503) {
        throw new Error('errors.serverDownDev');
      }
      throw new Error(data.error || 'errors.generic');
    }
    return data as T;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('errors.serverDownDev');
    }
    if (err instanceof TypeError) {
      throw new Error('errors.serverDownDev');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function storeSession(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function registerClient(payload: {
  name: string;
  email: string;
  phone: string;
  password: string;
}) {
  return request<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function loginClient(payload: { email: string; password: string }) {
  return request<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function socialClient(provider: 'apple' | 'google') {
  return request<AuthResponse>('/api/auth/social', {
    method: 'POST',
    body: JSON.stringify({ provider }),
  });
}

export async function googleAuthClient(payload: { credential: string; phone?: string }) {
  return request<AuthResponse>('/api/auth/google', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function appleAuthClient(payload: {
  idToken: string;
  phone?: string;
  name?: string;
  givenName?: string;
  familyName?: string;
}) {
  return request<AuthResponse>('/api/auth/apple', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchAuthConfig() {
  return request<{
    googleClientId: string;
    googleEnabled: boolean;
    appleClientId: string;
    appleRedirectUri: string;
    appleEnabled: boolean;
  }>('/api/auth/config');
}

export async function updateClientProfile(
  payload: { phone?: string; name?: string; email?: string },
  token = getStoredToken(),
) {
  if (!token) throw new Error('errors.noSession');
  return request<{ user: AuthUser }>('/api/client/profile', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

export async function fetchMe(token = getStoredToken()) {
  if (!token) throw new Error('errors.noSession');
  return request<{ user: AuthUser }>('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || '?';
}
