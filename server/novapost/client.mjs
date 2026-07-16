import { novaPostRequestViaPowerShell, shouldUseNovaPostPowerShellBridge } from './powershell.mjs';

const DEFAULT_BASE_URL = 'https://api.novapost.com/v.1.0';
const JWT_TTL_MS = 50 * 60 * 1000;

const NOVAPOST_DEFAULT_HEADERS = {
  Accept: 'application/json',
  'Accept-Language': 'en',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Origin: 'https://my.novapost.com',
  Referer: 'https://my.novapost.com/',
};

/** Nova Post API expects the raw JWT in Authorization (not Bearer). */
export function novaPostAuthHeader(jwt) {
  const token = String(jwt || '').trim();
  if (!token) return {};
  const raw = token.startsWith('Bearer ') ? token.slice(7).trim() : token;
  return { Authorization: raw };
}

let cachedJwt = null;
let inFlightJwt = null;
const divisionIdCache = new Map();

export function isNovaPostConfigured() {
  return Boolean(process.env.NOVAPOST_API_KEY?.trim());
}

let npCircuitOpenUntil = 0;

export function markNovaPostUnavailable() {
  const coolMs = Number(process.env.NOVAPOST_CIRCUIT_MS ?? 60_000);
  npCircuitOpenUntil = Date.now() + Math.max(5_000, coolMs);
}

export function isNovaPostMock() {
  if (process.env.NOVAPOST_MOCK === 'true') return true;
  if (Date.now() < npCircuitOpenUntil) return true;
  return !isNovaPostConfigured();
}

function getBaseUrl() {
  return (process.env.NOVAPOST_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

async function fetchWithNode(url, init = {}) {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(NOVAPOST_DEFAULT_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return fetch(url, { ...init, headers });
}

async function requestJson(method, path, extraHeaders = {}, body) {
  const url = `${getBaseUrl()}${path}`;

  if (shouldUseNovaPostPowerShellBridge()) {
    return novaPostRequestViaPowerShell(method, url, { ...NOVAPOST_DEFAULT_HEADERS, ...extraHeaders }, body);
  }

  const init = {
    method,
    headers: { ...NOVAPOST_DEFAULT_HEADERS, ...extraHeaders },
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetchWithNode(url, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (process.platform === 'win32' && !shouldUseNovaPostPowerShellBridge()) {
      process.env.NOVAPOST_USE_POWERSHELL = 'true';
      return novaPostRequestViaPowerShell(method, url, { ...NOVAPOST_DEFAULT_HEADERS, ...extraHeaders }, body);
    }
    throw new Error(`Nova Post transport error: ${message}`);
  }

  const text = await response.text();
  if (!response.ok) {
    if (process.platform === 'win32' && response.status === 403 && process.env.NOVAPOST_USE_POWERSHELL !== 'false') {
      return novaPostRequestViaPowerShell(method, url, { ...NOVAPOST_DEFAULT_HEADERS, ...extraHeaders }, body);
    }
    throw new Error(`Nova Post request failed (${response.status}): ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : {};
}

export async function getNovaPostJwt() {
  const apiKey = process.env.NOVAPOST_API_KEY?.trim();
  if (!apiKey) throw new Error('NOVAPOST_API_KEY is not configured');

  if (cachedJwt && cachedJwt.expiresAt > Date.now()) return cachedJwt.token;

  if (!inFlightJwt) {
    inFlightJwt = (async () => {
      try {
        const path = `/clients/authorization?apiKey=${encodeURIComponent(apiKey)}`;
        const json = await requestJson('GET', path);
        if (!json.jwt) throw new Error('Failed to get Nova Post JWT token');
        cachedJwt = { token: json.jwt, expiresAt: Date.now() + JWT_TTL_MS };
        return json.jwt;
      } finally {
        inFlightJwt = null;
      }
    })();
  }
  return inFlightJwt;
}

export async function novaPostFetchJson(path, init = {}) {
  const method = (init.method || 'GET').toUpperCase();
  const extraHeaders = {};
  if (init.headers) Object.assign(extraHeaders, init.headers);
  return requestJson(method, path, extraHeaders, init.body);
}

export async function getNovaPostDivisionId(jwt, countryCode) {
  const key = countryCode.toUpperCase();
  const cached = divisionIdCache.get(key);
  if (cached != null) return cached;

  const response = await novaPostFetchJson(
    `/divisions?countryCodes[]=${encodeURIComponent(countryCode)}&limit=1`,
    { method: 'GET', headers: novaPostAuthHeader(jwt) },
  );

  const id = response.items?.[0]?.id;
  if (!id) throw new Error(`No Nova Post divisions found for country ${countryCode}`);
  divisionIdCache.set(key, id);
  return id;
}
