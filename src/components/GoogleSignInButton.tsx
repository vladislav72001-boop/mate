import { useEffect, useRef, useState } from 'react';
import { GoogleLogin, useGoogleOAuth, type CredentialResponse } from '@react-oauth/google';

type Props = {
  onSuccess: (credential: string) => void;
  onError: () => void;
  onDisabledClick?: () => void;
  disabled?: boolean;
  label: string;
  icon: React.ReactNode;
};

export function GoogleSignInButton({
  onSuccess,
  onError,
  onDisabledClick,
  disabled,
  label,
  icon,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [btnWidth, setBtnWidth] = useState(280);
  const { scriptLoadedSuccessfully } = useGoogleOAuth();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const updateWidth = () => {
      const width = Math.floor(el.getBoundingClientRect().width);
      if (width > 0) setBtnWidth(width);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className="client-social-btn-wrap">
      <div className="client-social-btn client-social-btn--visual" aria-hidden>
        <span className="client-social-btn__icon client-social-btn__icon--google">{icon}</span>
        <span>{label}</span>
      </div>

      {disabled ? (
        <button
          type="button"
          className="client-social-btn__overlay client-social-btn__overlay--disabled"
          onClick={onDisabledClick}
          aria-label={label}
        />
      ) : scriptLoadedSuccessfully ? (
        <div className="client-social-btn__overlay" aria-hidden>
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
            width={btnWidth}
          />
        </div>
      ) : (
        <button
          type="button"
          className="client-social-btn__overlay client-social-btn__overlay--disabled"
          disabled
          aria-label={label}
        />
      )}
    </div>
  );
}
