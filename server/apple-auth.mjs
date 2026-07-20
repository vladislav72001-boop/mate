import * as jose from 'jose';

const clientId = () => String(process.env.APPLE_CLIENT_ID || '').trim();
const redirectUri = () => String(
  process.env.APPLE_REDIRECT_URI
  || 'https://www.matedelivery.com/api/auth/apple/callback',
).trim();

const JWKS = jose.createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

/**
 * Verify Apple identity token from Sign in with Apple (web popup / redirect).
 * @param {string} idToken
 * @returns {Promise<{ sub: string, email: string | null, emailVerified: boolean } | null>}
 */
export async function verifyAppleIdToken(idToken) {
  const audience = clientId();
  if (!audience || !idToken) return null;

  try {
    const { payload } = await jose.jwtVerify(idToken, JWKS, {
      issuer: 'https://appleid.apple.com',
      audience,
    });

    const sub = String(payload.sub || '').trim();
    if (!sub) return null;

    const emailRaw = payload.email ? String(payload.email).trim().toLowerCase() : '';
    const verified = payload.email_verified === true
      || payload.email_verified === 'true';

    return {
      sub,
      email: emailRaw || null,
      emailVerified: Boolean(emailRaw) && verified,
    };
  } catch (err) {
    console.error('[apple-auth] verify failed:', err?.message || err);
    return null;
  }
}

export function isAppleAuthConfigured() {
  return Boolean(clientId());
}

export function getAppleAuthPublicConfig() {
  return {
    appleClientId: clientId(),
    appleRedirectUri: redirectUri(),
    appleEnabled: isAppleAuthConfigured(),
  };
}
