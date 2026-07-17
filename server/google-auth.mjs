import { OAuth2Client } from 'google-auth-library';

const clientId = process.env.GOOGLE_CLIENT_ID;

let client = null;

function getClient() {
  if (!clientId) return null;
  if (!client) {
    client = new OAuth2Client(clientId);
  }
  return client;
}

/**
 * Verify Google ID token from GIS / @react-oauth/google.
 * @param {string} credential
 * @returns {Promise<{ sub: string, email: string, name: string, picture?: string } | null>}
 */
export async function verifyGoogleCredential(credential) {
  const oauth = getClient();
  if (!oauth || !credential) return null;

  try {
    const ticket = await oauth.verifyIdToken({
      idToken: credential,
      audience: clientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) return null;

    const email = String(payload.email).trim().toLowerCase();
    if (!payload.email_verified) return null;

    const given = String(payload.given_name || '').trim();
    const family = String(payload.family_name || '').trim();
    const name = String(payload.name || '').trim()
      || [given, family].filter(Boolean).join(' ')
      || email.split('@')[0];

    return {
      sub: payload.sub,
      email,
      name,
      picture: payload.picture || undefined,
    };
  } catch (err) {
    console.error('[google-auth] verify failed:', err?.message || err);
    return null;
  }
}

export function isGoogleAuthConfigured() {
  return Boolean(clientId);
}
