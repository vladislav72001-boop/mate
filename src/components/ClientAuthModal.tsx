import { useEffect, useState } from 'react';
import type { AuthUser } from '../api/auth';
import { loginClient, registerClient, appleAuthClient, googleAuthClient, fetchAuthConfig, updateClientProfile, storeSession } from '../api/auth';
import { signInWithApple } from '../lib/appleSignIn';
import { useI18n } from '../i18n/context';
import { localizeApiError } from '../i18n/localizeApiError';
import { getPasswordStrength } from '../utils/password';
import { ServiceSvgIcon } from './icons';
import { MateLogo } from './MateLogo';
import { SocialAuthButtons } from './SocialAuthButtons';

function ArrowIcon({ size = 14 }: { size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return <svg {...p} aria-hidden><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>;
}

type Mode = 'register' | 'login';

export type ClientOnboardingTarget = 'shipment' | 'address' | 'payments';

type Props = {
  mode: Mode;
  step: number;
  onClose: () => void;
  onSwitchMode: (mode: Mode) => void;
  onStepChange: (step: number) => void;
  onSuccess: (user: AuthUser, token: string) => void;
  onNavigate: (target: ClientOnboardingTarget) => void;
};

function FieldIcon({ id }: { id: string }) {
  const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'user': return <svg {...p}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
    case 'email': return <svg {...p}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>;
    case 'phone': return <svg {...p}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.81.36 1.6.7 2.34a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.74.34 1.53.57 2.34.7A2 2 0 0 1 22 16.92z"/></svg>;
  default: return <svg {...p}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>;
  }
}

export function ClientAuthModal({ mode, step, onClose, onSwitchMode, onStepChange, onSuccess, onNavigate }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState('');
  const [emailNotice, setEmailNotice] = useState('');
  const [phonePrompt, setPhonePrompt] = useState(false);
  const [pendingToken, setPendingToken] = useState('');
  const [pendingUser, setPendingUser] = useState<AuthUser | null>(null);
  const [pendingProvider, setPendingProvider] = useState<'google' | 'apple'>('google');
  const [appleClientId, setAppleClientId] = useState('');
  const [appleRedirectUri, setAppleRedirectUri] = useState('https://www.matedelivery.com/api/auth/apple/callback');

  useEffect(() => {
    let cancelled = false;
    fetchAuthConfig()
      .then((cfg) => {
        if (cancelled) return;
        if (cfg.appleClientId) setAppleClientId(cfg.appleClientId);
        if (cfg.appleRedirectUri) setAppleRedirectUri(cfg.appleRedirectUri);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const strength = getPasswordStrength(password);
  const strengthLabel =
    strength.level === 'weak' ? t('auth.passWeak')
    : strength.level === 'medium' ? t('auth.passMedium')
    : strength.level === 'strong' ? t('auth.passStrong')
    : '';

  const progressSteps = mode === 'register'
    ? [t('auth.regStep1'), t('auth.regStep2'), t('auth.regStep3'), t('auth.regStep4')]
    : [t('auth.loginStep1'), t('auth.loginStep2'), t('auth.loginStep3'), t('auth.loginStep4')];

  const nextSteps: { icon: string; title: string; desc: string; target: ClientOnboardingTarget }[] = [
    { icon: 'parcel', title: t('auth.nextShipmentTitle'), desc: t('auth.nextShipmentDesc'), target: 'shipment' },
    { icon: 'tracking', title: t('auth.nextAddressTitle'), desc: t('auth.nextAddressDesc'), target: 'address' },
    { icon: 'fulfillment', title: t('auth.nextPayTitle'), desc: t('auth.nextPayDesc'), target: 'payments' },
  ];

  async function finishAuth(
    res: Awaited<ReturnType<typeof registerClient>>,
    notice: string,
    started: number,
  ) {
    onSuccess(res.user, res.token);
    setEmailNotice(notice);
    const wait = Math.max(0, 1400 - (Date.now() - started));
    setTimeout(() => onStepChange(2), wait);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setEmailNotice('');

    if (mode === 'register' && !terms) {
      setError(t('auth.termsRequired'));
      return;
    }

    onStepChange(1);
    const started = Date.now();

    try {
      const res = mode === 'register'
        ? await registerClient({ name, email, phone, password })
        : await loginClient({ email, password });

      await finishAuth(
        res,
        mode === 'register' ? t('auth.emailRegisterNotice') : t('auth.emailLoginNotice'),
        started,
      );
    } catch (err) {
      onStepChange(0);
      setError(localizeApiError(
        err instanceof Error ? err.message : undefined,
        t,
        mode === 'register' ? 'auth.registerError' : 'auth.loginError',
      ));
    }
  }

  async function handleGoogleCredential(credential: string) {
    setError('');
    setEmailNotice('');

    if (mode === 'register' && !terms) {
      setError(t('auth.termsRequired'));
      return;
    }

    onStepChange(1);
    const started = Date.now();

    try {
      const res = await googleAuthClient({ credential });
      const notice = mode === 'register'
        ? t('auth.emailSocialRegisterNotice', { provider: 'Google' })
        : t('auth.emailSocialLoginNotice', { provider: 'Google' });

      if (res.user.needsPhone) {
        storeSession(res.token);
        setPendingToken(res.token);
        setPendingUser(res.user);
        setPendingProvider('google');
        onStepChange(0);
        setPhonePrompt(true);
        return;
      }

      await finishAuth(res, notice, started);
    } catch (err) {
      onStepChange(0);
      setPhonePrompt(false);
      setError(localizeApiError(
        err instanceof Error ? err.message : undefined,
        t,
        'auth.socialError',
      ));
    }
  }

  async function handleGooglePhoneSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (phone.trim().length < 6) {
      setError(t('auth.phoneRequired'));
      return;
    }

    onStepChange(1);
    const started = Date.now();

    try {
      const updated = await updateClientProfile({ phone: phone.trim() }, pendingToken);
      const user = updated.user;
      const providerLabel = pendingProvider === 'apple' ? 'Apple' : 'Google';
      const notice = mode === 'register'
        ? t('auth.emailSocialRegisterNotice', { provider: providerLabel })
        : t('auth.emailSocialLoginNotice', { provider: providerLabel });

      setPhonePrompt(false);
      setPendingToken('');
      setPendingUser(null);
      await finishAuth(
        { token: pendingToken, user, emailSent: true, emailPreview: null },
        notice,
        started,
      );
    } catch (err) {
      onStepChange(0);
      setError(localizeApiError(
        err instanceof Error ? err.message : undefined,
        t,
        'auth.socialError',
      ));
    }
  }

  async function handleSocial(provider: 'apple') {
    setError('');
    setEmailNotice('');

    if (mode === 'register' && !terms) {
      setError(t('auth.termsRequired'));
      return;
    }

    if (!appleClientId) {
      setError(t('auth.socialError'));
      return;
    }

    onStepChange(1);
    const started = Date.now();

    try {
      const apple = await signInWithApple({
        clientId: appleClientId,
        redirectUri: appleRedirectUri,
      });
      const res = await appleAuthClient({
        idToken: apple.idToken,
        name: apple.name,
        givenName: apple.givenName,
        familyName: apple.familyName,
      });
      const providerLabel = 'Apple';
      const notice = mode === 'register'
        ? t('auth.emailSocialRegisterNotice', { provider: providerLabel })
        : t('auth.emailSocialLoginNotice', { provider: providerLabel });

      if (res.user.needsPhone) {
        storeSession(res.token);
        setPendingToken(res.token);
        setPendingUser(res.user);
        setPendingProvider('apple');
        onStepChange(0);
        setPhonePrompt(true);
        return;
      }

      await finishAuth(res, notice, started);
    } catch (err) {
      onStepChange(0);
      setError(localizeApiError(
        err instanceof Error ? err.message : undefined,
        t,
        'auth.socialError',
      ));
    }
  }

  return (
    <div
      className="client-auth-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`client-auth client-auth--${mode} client-auth--step${step}`}>
        {step === 0 && phonePrompt && pendingUser && (
          <>
            <header className="client-auth__top card">
              <MateLogo />
            </header>
            <div className="client-auth__card card">
              <button className="reg-close" type="button" onClick={onClose} aria-label={t('auth.close')}>✕</button>
              <div className="client-auth__badge">{t('auth.badgeLogin')}</div>
              <h1>{t('auth.googlePhoneTitle')} <span>{pendingUser.name}</span></h1>
              <p className="client-auth__sub">{t('auth.googlePhoneSub')}</p>
              <form className="client-auth__form" onSubmit={handleGooglePhoneSubmit}>
                <label className="client-field">
                  <span className="client-field__icon"><FieldIcon id="phone" /></span>
                  <input
                    name="tel"
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder={t('auth.placeholderPhone')}
                    type="tel"
                    required
                  />
                </label>
                {error && <p className="client-auth__error">{error}</p>}
                <button className="btn btn-lime client-auth__submit" type="submit">
                  {t('auth.googlePhoneSubmit')}
                </button>
              </form>
            </div>
          </>
        )}

        {step === 0 && !phonePrompt && (
          <>
            <header className="client-auth__top card">
              <MateLogo />
              <p className="client-auth__switch">
                {mode === 'register' ? (
                  <>{t('auth.hasAccount')} <button type="button" onClick={() => onSwitchMode('login')}>{t('auth.loginLink')}</button></>
                ) : (
                  <>{t('auth.noAccount')} <button type="button" onClick={() => onSwitchMode('register')}>{t('auth.registerLink')}</button></>
                )}
              </p>
            </header>

            <div className="client-auth__card card">
              <button className="reg-close" type="button" onClick={onClose} aria-label={t('auth.close')}>✕</button>

              {mode === 'register' ? (
                <>
                  <div className="client-auth__badge">{t('auth.badgeRegister')}</div>
                  <h1>{t('auth.registerTitle')} <span>{t('auth.registerTitleAccent')}</span></h1>
                  <p className="client-auth__sub">{t('auth.registerSub')}</p>

                  <form className="client-auth__form" onSubmit={handleSubmit}>
                    <label className="client-field">
                      <span className="client-field__icon"><FieldIcon id="user" /></span>
                      <input
                        name="name"
                        autoComplete="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t('auth.placeholderName')}
                        required
                      />
                    </label>
                    <label className="client-field">
                      <span className="client-field__icon"><FieldIcon id="email" /></span>
                      <input
                        name="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Email"
                        type="email"
                        required
                      />
                    </label>
                    <label className="client-field">
                      <span className="client-field__icon"><FieldIcon id="phone" /></span>
                      <input
                        name="tel"
                        autoComplete="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder={t('auth.placeholderPhone')}
                        type="tel"
                        required
                      />
                    </label>
                    <label className="client-field client-field--pass">
                      <span className="client-field__icon"><FieldIcon id="lock" /></span>
                      <input
                        name="new-password"
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={t('auth.placeholderPassword')}
                        type={showPass ? 'text' : 'password'}
                        minLength={8}
                        required
                      />
                      <button className="client-field__eye" type="button" onClick={() => setShowPass((v) => !v)} aria-label={t('auth.showPassword')}>
                        {showPass ? '🙈' : '👁'}
                      </button>
                    </label>
                    {password && (
                      <div className="client-pass-strength">
                        <div className="client-pass-strength__bar"><span style={{ width: strength.width }} /></div>
                        <small>{strengthLabel}</small>
                      </div>
                    )}
                    <label className="client-terms">
                      <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
                      <span>{t('auth.terms')}</span>
                    </label>
                    {error && <p className="client-auth__error">{error}</p>}
                    <button className="btn btn-lime client-auth__submit" type="submit">
                      {t('auth.submitRegister')}
                    </button>
                  </form>

                  <SocialAuthButtons
                    onApple={() => handleSocial('apple')}
                    onGoogleCredential={handleGoogleCredential}
                    onGoogleError={() => setError(t('auth.socialError'))}
                    onGoogleDisabledClick={() => setError(t('auth.termsRequired'))}
                    googleDisabled={mode === 'register' && !terms}
                    orLabel={t('auth.or')}
                    appleLabel={t('auth.continueApple')}
                    googleLabel={t('auth.continueGoogle')}
                  />
                </>
              ) : (
                <>
                  <div className="client-auth__badge">{t('auth.badgeLogin')}</div>
                  <h1>{t('auth.loginTitle')} <span>{t('auth.loginTitleAccent')}</span></h1>
                  <p className="client-auth__sub">{t('auth.loginSub')}</p>

                  <form className="client-auth__form" onSubmit={handleSubmit}>
                    <label className="client-field">
                      <span className="client-field__icon"><FieldIcon id="email" /></span>
                      <input
                        name="email"
                        autoComplete="username"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Email"
                        type="email"
                        required
                      />
                    </label>
                    <label className="client-field client-field--pass">
                      <span className="client-field__icon"><FieldIcon id="lock" /></span>
                      <input
                        name="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={t('auth.placeholderPassword')}
                        type={showPass ? 'text' : 'password'}
                        required
                      />
                      <button className="client-field__eye" type="button" onClick={() => setShowPass((v) => !v)} aria-label={t('auth.showPassword')}>
                        {showPass ? '🙈' : '👁'}
                      </button>
                    </label>
                    {error && <p className="client-auth__error">{error}</p>}
                    <button className="btn btn-lime client-auth__submit" type="submit">
                      {t('auth.submitLogin')}
                    </button>
                  </form>

                  <SocialAuthButtons
                    onApple={() => handleSocial('apple')}
                    onGoogleCredential={handleGoogleCredential}
                    onGoogleError={() => setError(t('auth.socialError'))}
                    orLabel={t('auth.or')}
                    appleLabel={t('auth.continueApple')}
                    googleLabel={t('auth.continueGoogle')}
                  />
                </>
              )}
            </div>

            <div className="client-auth__trust">
              <div><b>⚡</b><span>{t('auth.trustFast')}</span></div>
              <div><b>🛡</b><span>{t('auth.trustSafe')}</span></div>
              <div><b>✓</b><span>{t('auth.trustValue')}</span></div>
            </div>
          </>
        )}

        {step === 1 && (
          <div className="client-auth__loading card">
            <div className="client-auth__loading-logo">
              <MateLogo height={46} />
            </div>
            <h2>
              {mode === 'register' ? t('auth.loadingRegisterTitle') : t('auth.loadingLoginTitle')}
            </h2>
            <p>{t('auth.loadingSub')}</p>
            <ul className="reg-checklist client-checklist">
              {progressSteps.map((label, i) => (
                <li key={`${mode}-${i}`} className={['done', 'anim1', 'anim2', 'anim3'][i] || ''}>
                  <span className={i < 2 ? 'reg-check-circle' : i === 2 ? 'reg-check-spinner' : 'reg-check-empty'}>
                    {i < 2 ? '✓' : i === 2 ? '' : '○'}
                  </span>
                  {label}
                </li>
              ))}
            </ul>
            <div className="client-auth__illus" aria-hidden>
              <span className="client-auth__hub">m</span>
              <span className="client-auth__orb client-auth__orb--1">📦</span>
              <span className="client-auth__orb client-auth__orb--2">🚚</span>
              <span className="client-auth__orb client-auth__orb--3">🌍</span>
              <span className="client-auth__orb client-auth__orb--4">🏬</span>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="client-auth__success card">
            <div className="client-auth__success-head">
              <MateLogo height={46} className="client-auth__success-logo" />
              <div className="reg-success-icon">✓</div>
              <h2>
                {mode === 'register' ? t('auth.welcomeNew') : t('auth.welcomeBack')}
              </h2>
              <p>
                {mode === 'register' ? t('auth.accountCreated') : t('auth.loggedIn')}
              </p>
              {emailNotice && <p className="client-auth__email-note">{emailNotice}</p>}
            </div>

            <section className="client-next">
              <h3 className="client-next__title">{t('auth.nextTitle')}</h3>
              <div className="client-next__list">
                {nextSteps.map((item, index) => (
                  <button
                    key={item.target}
                    type="button"
                    className="client-next__card"
                    onClick={() => onNavigate(item.target)}
                  >
                    <span className="client-next__num">{index + 1}</span>
                    <div className="client-next__icon">
                      <ServiceSvgIcon id={item.icon} size={20} />
                    </div>
                    <div className="client-next__text">
                      <b>{item.title}</b>
                      <span>{item.desc}</span>
                    </div>
                    <span className="client-next__arrow" aria-hidden>
                      <ArrowIcon size={13} />
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <button className="btn btn-lime client-auth__success-btn" type="button" onClick={onClose}>
              {t('auth.goDashboard')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
