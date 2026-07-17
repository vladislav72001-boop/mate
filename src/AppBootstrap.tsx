import { useEffect, useState } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import App from './App.tsx';
import { I18nProvider } from './i18n/context.tsx';

type AuthConfig = {
  googleClientId: string;
  googleEnabled: boolean;
};

export function AppBootstrap() {
  const [googleClientId, setGoogleClientId] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      const fromBuild = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
      if (fromBuild) {
        if (!cancelled) {
          setGoogleClientId(fromBuild);
          setReady(true);
        }
        return;
      }

      try {
        const res = await fetch('/api/auth/config');
        const data: AuthConfig | null = res.ok ? await res.json() : null;
        if (!cancelled && data?.googleClientId) {
          setGoogleClientId(data.googleClientId);
        }
      } catch {
        // Google sign-in stays unavailable without client id.
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    loadConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return null;
  }

  const content = (
    <I18nProvider>
      <App />
    </I18nProvider>
  );

  if (!googleClientId) {
    return content;
  }

  return (
    <GoogleOAuthProvider clientId={googleClientId}>
      {content}
    </GoogleOAuthProvider>
  );
}
