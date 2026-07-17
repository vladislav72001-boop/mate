import { useEffect, useState } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import App from './App.tsx';
import { I18nProvider } from './i18n/context.tsx';

type AuthConfig = {
  googleClientId: string;
  googleEnabled: boolean;
};

export function AppBootstrap() {
  const [googleClientId, setGoogleClientId] = useState(
    () => import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
  );

  useEffect(() => {
    if (googleClientId) return;

    let cancelled = false;
    fetch('/api/auth/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AuthConfig | null) => {
        if (!cancelled && data?.googleClientId) {
          setGoogleClientId(data.googleClientId);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [googleClientId]);

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
