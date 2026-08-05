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
  return Boolean(readNovaPostEnv('NOVAPOST_API_KEY'));
}

/** Read env with trim; also matches keys that accidentally have trailing spaces (Railway UI quirk). */
export function readNovaPostEnv(name) {
  const direct = process.env[name];
  if (direct != null && String(direct).trim() !== '') return String(direct).trim();
  const hit = Object.keys(process.env).find((k) => k.trim() === name);
  if (hit != null && process.env[hit] != null) return String(process.env[hit]).trim();
  return '';
}

/** Mate company contract used for B2C quotes/shipments (my.novapost Legal entity). */
export const DEFAULT_NOVAPOST_PAYER_CONTRACT = 'GNPHU-00026481';
export const DEFAULT_NOVAPOST_COMPANY_TIN = '32834374243';
export const DEFAULT_NOVAPOST_COMPANY_NAME = 'Mate Logisztikanetwork korlatolt felelossegu tarsasag';

export function getNovaPostContractConfig() {
  const payerContractNumber = readNovaPostEnv('NOVAPOST_PAYER_CONTRACT_NUMBER')
    || DEFAULT_NOVAPOST_PAYER_CONTRACT;
  const companyTin = (
    readNovaPostEnv('NOVAPOST_COMPANY_TIN')
    || readNovaPostEnv('MATE_COMPANY_TIN')
    || DEFAULT_NOVAPOST_COMPANY_TIN
  ).replace(/\D/g, '');
  const companyName = readNovaPostEnv('NOVAPOST_COMPANY_NAME')
    || DEFAULT_NOVAPOST_COMPANY_NAME;
  return { payerContractNumber, companyTin, companyName };
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
  const timeoutMs = Number(process.env.NOVAPOST_TIMEOUT_MS ?? 15_000);
  const signal = init.signal || AbortSignal.timeout(Math.max(3_000, timeoutMs));
  return fetch(url, { ...init, headers, signal });
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
  const apiKey = readNovaPostEnv('NOVAPOST_API_KEY');
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
