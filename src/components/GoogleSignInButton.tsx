import { useRef } from 'react';
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google';

type Props = {
  onSuccess: (credential: string) => void;
  onError: () => void;
  disabled?: boolean;
  label: string;
  icon: React.ReactNode;
};

export function GoogleSignInButton({ onSuccess, onError, disabled, label, icon }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  function triggerGoogle() {
    if (disabled) return;
    const btn = wrapperRef.current?.querySelector('div[role="button"]') as HTMLElement | null;
    btn?.click();
  }

  return (
    <>
      <button type="button" className="client-social-btn" onClick={triggerGoogle} disabled={disabled}>
        <span className="client-social-btn__icon client-social-btn__icon--google">{icon}</span>
        <span>{label}</span>
      </button>
      <div ref={wrapperRef} className="client-auth__google-hidden" aria-hidden>
        <GoogleLogin
          onSuccess={(res: CredentialResponse) => {
            if (res.credential) onSuccess(res.credential);
            else onError();
          }}
          onError={onError}
          useOneTap={false}
          type="standard"
          theme="outline"
          size="large"
          text="continue_with"
          shape="rectangular"
        />
      </div>
    </>
  );
}
