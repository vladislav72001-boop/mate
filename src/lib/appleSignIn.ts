type AppleName = {
  firstName?: string;
  lastName?: string;
};

type AppleSignInSuccess = {
  idToken: string;
  givenName?: string;
  familyName?: string;
  name?: string;
};

type AppleAuthConfig = {
  clientId: string;
  redirectUri: string;
};

declare global {
  interface Window {
    AppleID?: {
      auth: {
        init: (config: {
          clientId: string;
          scope: string;
          redirectURI: string;
          usePopup: boolean;
        }) => void;
        signIn: () => Promise<{
          authorization: { id_token: string; code?: string; state?: string };
          user?: { email?: string; name?: AppleName };
        }>;
      };
    };
  }
}

const SCRIPT_SRC = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

let scriptPromise: Promise<void> | null = null;
let lastInitKey = '';

function loadAppleScript(): Promise<void> {
  if (window.AppleID?.auth) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('apple_script_failed')), { once: true });
      if (window.AppleID?.auth) resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('apple_script_failed'));
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export async function signInWithApple(config: AppleAuthConfig): Promise<AppleSignInSuccess> {
  const clientId = String(config.clientId || '').trim();
  const redirectUri = String(config.redirectUri || '').trim();
  if (!clientId || !redirectUri) {
    throw new Error('Apple sign-in is not configured');
  }

  await loadAppleScript();
  if (!window.AppleID?.auth) {
    throw new Error('Apple sign-in is unavailable');
  }

  const initKey = `${clientId}|${redirectUri}`;
  if (lastInitKey !== initKey) {
    window.AppleID.auth.init({
      clientId,
      scope: 'name email',
      redirectURI: redirectUri,
      usePopup: true,
    });
    lastInitKey = initKey;
  }

  const result = await window.AppleID.auth.signIn();
  const idToken = String(result?.authorization?.id_token || '').trim();
  if (!idToken) {
    throw new Error('Apple did not return an identity token');
  }

  const first = String(result?.user?.name?.firstName || '').trim();
  const last = String(result?.user?.name?.lastName || '').trim();
  const name = [first, last].filter(Boolean).join(' ');

  return {
    idToken,
    givenName: first || undefined,
    familyName: last || undefined,
    name: name || undefined,
  };
}
