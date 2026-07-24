import './load-env.mjs';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUser, findByAppleId, findByEmail, findByGoogleId, findById, findByIdentifier, publicUser, updateUser } from './store.mjs';
import { sendWelcomeEmail, sendLoginEmail } from './mail.mjs';
import { verifyGoogleCredential, isGoogleAuthConfigured } from './google-auth.mjs';
import { getAppleAuthPublicConfig, isAppleAuthConfigured, verifyAppleIdToken } from './apple-auth.mjs';
import { createShippingRouter } from './shipping.mjs';
import { createClientRouter } from './client-routes.mjs';
import { createAdminRouter, ensureAdminUser } from './admin-routes.mjs';
import { syncPricingFromJsonIfNeeded } from './pricing-config.mjs';

const app = express();
const PORT = Number(process.env.PORT || 5012);
const JWT_SECRET = process.env.JWT_SECRET || 'mate-dev-secret-change-me';
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN;

app.use(cors({
  origin: CLIENT_ORIGIN || true,
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Brand images for transactional emails (also copied to dist/ via Vite public/)
const emailAssetsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'email');
if (existsSync(emailAssetsDir)) {
  app.use('/email', express.static(emailAssetsDir, { maxAge: '7d', immutable: true }));
}

// Avoid mixed-content warnings on HTTPS (e.g. accidental http:// subresources)
if (String(process.env.APP_URL || '').startsWith('https://')) {
  app.use((_req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Content-Security-Policy', 'upgrade-insecure-requests');
    res.setHeader('Permissions-Policy', 'geolocation=(self)');
    next();
  });
}

function signToken(user) {
  return jwt.sign({ sub: user.id, type: user.type }, JWT_SECRET, { expiresIn: '30d' });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    req.userId = payload.sub;
    req.userType = payload.type;
    next();
  } catch {
    return res.status(401).json({ error: 'Сессия истекла, войдите снова' });
  }
}

function optionalAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), JWT_SECRET);
      req.userId = payload.sub;
      req.userType = payload.type;
    } catch {
      req.userId = null;
    }
  }
  next();
}

async function requireAdmin(req, res, next) {
  try {
    const user = await findById(req.userId);
    if (!user || user.type !== 'admin') {
      return res.status(403).json({ error: 'Доступ только для администратора' });
    }
    req.admin = user;
    next();
  } catch {
    return res.status(403).json({ error: 'Доступ только для администратора' });
  }
}

function validateRegister(body) {
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const password = String(body.password || '');

  if (name.length < 2) return 'Введите имя (минимум 2 символа)';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Введите корректный email';
  if (phone.length < 6) return 'Введите номер телефона';
  if (password.length < 8) return 'Пароль должен быть не короче 8 символов';
  return null;
}

function resolveLoginEmail(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'admin') return 'admin@matedelivery.com';
  return value;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/auth/config', (_req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '',
    googleEnabled: isGoogleAuthConfigured(),
    ...getAppleAuthPublicConfig(),
  });
});

/** Approximate client location by IP (fallback when browser GPS times out). */
app.get('/api/geo/approx', async (req, res) => {
  try {
    const forwarded = String(req.headers['x-forwarded-for'] || '')
      .split(',')[0]
      .trim();
    const ip = forwarded
      || String(req.headers['x-real-ip'] || '').trim()
      || req.socket?.remoteAddress
      || '';
    const cleanIp = ip.replace(/^::ffff:/, '');
    const isLocal = !cleanIp
      || cleanIp === '127.0.0.1'
      || cleanIp === '::1'
      || cleanIp.startsWith('192.168.')
      || cleanIp.startsWith('10.');

    const url = isLocal
      ? 'https://get.geojs.io/v1/ip/geo.json'
      : `https://get.geojs.io/v1/ip/geo/${encodeURIComponent(cleanIp)}.json`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let upstream;
    try {
      upstream = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }    if (!upstream.ok) {
      return res.status(502).json({ error: 'geo_upstream_failed' });
    }
    const data = await upstream.json();
    const lat = Number(data.latitude ?? data.lat);
    const lng = Number(data.longitude ?? data.lng ?? data.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(502).json({ error: 'geo_invalid' });
    }
    return res.json({
      lat,
      lng,
      latitude: lat,
      longitude: lng,
      city: data.city || data.region || null,
      country_code: data.country_code || data.country || null,
      source: 'ip',
    });
  } catch (err) {
    console.error('[geo/approx]', err);
    return res.status(502).json({ error: 'geo_failed' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const error = validateRegister(req.body);
    if (error) return res.status(400).json({ error });

    const { name, email, phone, password } = req.body;
    const existing = await findByEmail(email);
    if (existing) return res.status(409).json({ error: 'Аккаунт с таким email уже существует' });

    const passwordHash = await bcrypt.hash(password, 10);
    let user;
    try {
      user = await createUser({ name, email, phone, passwordHash, type: 'client' });
    } catch (err) {
      if (err?.code === 'LOGIN_TAKEN') {
        return res.status(409).json({ error: 'Такой логин уже занят' });
      }
      throw err;
    }
    const token = signToken(user);
    const pub = publicUser(user);

    sendWelcomeEmail(pub).catch((mailErr) => {
      console.error('[mail] welcome failed:', mailErr);
    });

    res.status(201).json({
      token,
      user: pub,
      emailSent: true,
      emailPreview: null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось создать аккаунт' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const identifier = String(req.body.email || req.body.login || req.body.username || '').trim();
    const password = String(req.body.password || '');

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Введите логин и пароль' });
    }

    const user = await findByIdentifier(identifier);
    if (!user) return res.status(401).json({ error: 'Неверный логин или пароль' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Неверный логин или пароль' });

    const pub = publicUser(user);
    const token = signToken(user);

    if (user.type !== 'admin') {
      sendLoginEmail(pub, { ip: req.ip }).catch((mailErr) => {
        console.error('[mail] login failed:', mailErr);
      });
    }

    res.json({
      token,
      user: pub,
      emailSent: user.type !== 'admin',
      emailPreview: null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось выполнить вход' });
  }
});

app.post('/api/auth/google', async (req, res) => {
  try {
    if (!isGoogleAuthConfigured()) {
      return res.status(503).json({ error: 'Вход через Google не настроен на сервере' });
    }

    const credential = String(req.body.credential || '').trim();
    if (!credential) {
      return res.status(400).json({ error: 'Не удалось получить данные Google' });
    }

    const profile = await verifyGoogleCredential(credential);
    if (!profile) {
      return res.status(401).json({ error: 'Не удалось подтвердить аккаунт Google' });
    }

    const phone = String(req.body.phone || '').trim();
    let user = await findByGoogleId(profile.sub);
    let isNew = false;

    if (!user) {
      const byEmail = await findByEmail(profile.email);
      if (byEmail) {
        if (byEmail.googleId && byEmail.googleId !== profile.sub) {
          return res.status(409).json({ error: 'Этот email уже привязан к другому Google-аккаунту' });
        }
        user = await updateUser(byEmail.id, {
          googleId: profile.sub,
          authProvider: 'google',
          name: byEmail.name || profile.name,
          ...(phone.length >= 6 ? { phone } : {}),
        });
      } else {
        isNew = true;
        const passwordHash = await bcrypt.hash(randomUUID(), 10);
        try {
          user = await createUser({
            name: profile.name,
            email: profile.email,
            phone: phone.length >= 6 ? phone : '',
            passwordHash,
            type: 'client',
            googleId: profile.sub,
            authProvider: 'google',
          });
        } catch (err) {
          if (err?.code === 'LOGIN_TAKEN') {
            return res.status(409).json({ error: 'Такой логин уже занят' });
          }
          throw err;
        }
      }
    } else if (phone.length >= 6 && String(user.phone || '').trim().length < 6) {
      user = await updateUser(user.id, { phone });
    }

    if (!user) {
      return res.status(500).json({ error: 'Не удалось выполнить вход через Google' });
    }

    const pub = publicUser(user);
    const token = signToken(user);

    if (isNew) {
      sendWelcomeEmail(pub).catch((err) => console.error('[mail] google welcome failed:', err));
    } else {
      sendLoginEmail(pub, { ip: req.ip }).catch((err) => console.error('[mail] google login failed:', err));
    }

    res.json({
      token,
      user: pub,
      emailSent: true,
      emailPreview: null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось выполнить вход через Google' });
  }
});

app.post('/api/auth/apple', async (req, res) => {
  try {
    if (!isAppleAuthConfigured()) {
      return res.status(503).json({ error: 'Вход через Apple не настроен на сервере' });
    }

    const idToken = String(req.body.idToken || req.body.credential || '').trim();
    if (!idToken) {
      return res.status(400).json({ error: 'Не удалось получить данные Apple' });
    }

    const profile = await verifyAppleIdToken(idToken);
    if (!profile) {
      return res.status(401).json({ error: 'Не удалось подтвердить аккаунт Apple' });
    }

    const phone = String(req.body.phone || '').trim();
    const givenName = String(req.body.givenName || req.body.firstName || '').trim();
    const familyName = String(req.body.familyName || req.body.lastName || '').trim();
    const fullName = String(req.body.name || '').trim()
      || [givenName, familyName].filter(Boolean).join(' ');

    let user = await findByAppleId(profile.sub);
    let isNew = false;

    if (!user) {
      const email = profile.email;
      if (!email) {
        return res.status(400).json({
          error: 'Apple не передал email. Разрешите доступ к email при входе или войдите по почте.',
        });
      }

      const byEmail = await findByEmail(email);
      if (byEmail) {
        if (byEmail.appleId && byEmail.appleId !== profile.sub) {
          return res.status(409).json({ error: 'Этот email уже привязан к другому Apple-аккаунту' });
        }
        user = await updateUser(byEmail.id, {
          appleId: profile.sub,
          authProvider: byEmail.authProvider === 'local' ? 'apple' : byEmail.authProvider,
          name: byEmail.name || fullName || byEmail.email.split('@')[0],
          ...(phone.length >= 6 ? { phone } : {}),
        });
      } else {
        isNew = true;
        const passwordHash = await bcrypt.hash(randomUUID(), 10);
        const name = fullName || email.split('@')[0] || 'Apple user';
        try {
          user = await createUser({
            name,
            email,
            phone: phone.length >= 6 ? phone : '',
            passwordHash,
            type: 'client',
            appleId: profile.sub,
            authProvider: 'apple',
          });
        } catch (err) {
          if (err?.code === 'LOGIN_TAKEN') {
            return res.status(409).json({ error: 'Такой логин уже занят' });
          }
          throw err;
        }
      }
    } else {
      const patch = {};
      if (phone.length >= 6 && String(user.phone || '').trim().length < 6) {
        patch.phone = phone;
      }
      if (fullName && (!user.name || user.name === user.email?.split('@')[0])) {
        patch.name = fullName;
      }
      if (Object.keys(patch).length) {
        user = await updateUser(user.id, patch);
      }
    }

    if (!user) {
      return res.status(500).json({ error: 'Не удалось выполнить вход через Apple' });
    }

    const pub = publicUser(user);
    const token = signToken(user);

    if (isNew) {
      sendWelcomeEmail(pub).catch((err) => console.error('[mail] apple welcome failed:', err));
    } else {
      sendLoginEmail(pub, { ip: req.ip }).catch((err) => console.error('[mail] apple login failed:', err));
    }

    res.json({
      token,
      user: pub,
      emailSent: true,
      emailPreview: null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось выполнить вход через Apple' });
  }
});

/** Apple may POST here for non-popup / form_post flows. */
function appleCallbackPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Apple</title></head>
<body><p>Sign in with Apple — you can close this window.</p>
<script>try{window.close();}catch(e){}</script></body></html>`;
}

app.get('/api/auth/apple/callback', (_req, res) => {
  res.type('html').send(appleCallbackPage());
});

app.post('/api/auth/apple/callback', (_req, res) => {
  res.type('html').send(appleCallbackPage());
});

app.post('/api/auth/social', async (req, res) => {
  try {
    const provider = req.body.provider;
    if (provider !== 'google' && provider !== 'apple') {
      return res.status(400).json({ error: 'Неподдерживаемый способ входа' });
    }

    if (provider === 'google') {
      return res.status(400).json({ error: 'Используйте кнопку Google в приложении' });
    }

    if (provider === 'apple') {
      return res.status(400).json({ error: 'Используйте кнопку Apple в приложении' });
    }

    return res.status(400).json({ error: 'Неподдерживаемый способ входа' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось выполнить вход через соцсеть' });
  }
});

app.use('/api/shipping', createShippingRouter({ authMiddleware, optionalAuth }));
app.use('/api/client', createClientRouter({ authMiddleware }));
app.use('/api/admin', createAdminRouter({ authMiddleware, requireAdmin }));

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const user = await findById(req.userId);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось загрузить профиль' });
  }
});

await ensureAdminUser({ createUser, findByEmail });
await syncPricingFromJsonIfNeeded().catch((err) => {
  console.error('[pricing] JSON sync failed:', err);
});

// Production: serve Vite build from the same origin as /api
const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`MATE API running on http://localhost:${PORT}`);
});
