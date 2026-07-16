import { useState } from 'react';
import type { AuthUser } from '../api/auth';
import { loginClient, registerClient, socialClient } from '../api/auth';
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

const registerSteps = [
  'Создаём аккаунт',
  'Настраиваем рабочее пространство',
  'Отправляем письмо на почту',
  'Готово!',
];

const loginSteps = [
  'Подгружаем ваш профиль в MATE',
  'Синхронизируем отправления',
  'Проверяем настройки',
  'Готово!',
];

const clientNextSteps: { icon: string; title: string; desc: string; target: ClientOnboardingTarget }[] = [
  { icon: 'parcel', title: 'Создайте первую отправку', desc: 'Рассчитайте стоимость и отправьте посылку', target: 'shipment' },
  { icon: 'tracking', title: 'Добавьте адрес в книгу', desc: 'Сохраните часто используемые адреса доставки', target: 'address' },
  { icon: 'fulfillment', title: 'Настройте способ оплаты', desc: 'Подключите карту для быстрой оплаты отправлений', target: 'payments' },
];

export function ClientAuthModal({ mode, step, onClose, onSwitchMode, onStepChange, onSuccess, onNavigate }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState('');
  const [emailNotice, setEmailNotice] = useState('');

  const strength = getPasswordStrength(password);
  const progressSteps = mode === 'register' ? registerSteps : loginSteps;

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
      setError('Подтвердите согласие с условиями использования');
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
        mode === 'register'
          ? 'Письмо о создании аккаунта отправлено на вашу почту.'
          : 'Уведомление о входе отправлено на вашу почту.',
        started,
      );
    } catch (err) {
      onStepChange(0);
      setError(err instanceof Error ? err.message : (mode === 'register' ? 'Ошибка регистрации' : 'Ошибка входа'));
    }
  }

  async function handleSocial(provider: 'apple' | 'google') {
    setError('');
    setEmailNotice('');

    if (mode === 'register' && !terms) {
      setError('Подтвердите согласие с условиями использования');
      return;
    }

    onStepChange(1);
    const started = Date.now();

    try {
      const res = await socialClient(provider);
      const providerLabel = provider === 'apple' ? 'Apple' : 'Google';
      await finishAuth(
        res,
        mode === 'register'
          ? `Аккаунт через ${providerLabel} создан. Письмо отправлено на почту.`
          : `Вы вошли через ${providerLabel}. Уведомление отправлено на почту.`,
        started,
      );
    } catch (err) {
      onStepChange(0);
      setError(err instanceof Error ? err.message : 'Не удалось войти через соцсеть');
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
        {step === 0 && (
          <>
            <header className="client-auth__top card">
              <MateLogo />
              <p className="client-auth__switch">
                {mode === 'register' ? (
                  <>Уже есть аккаунт? <button type="button" onClick={() => onSwitchMode('login')}>Войти</button></>
                ) : (
                  <>Нет аккаунта? <button type="button" onClick={() => onSwitchMode('register')}>Создать аккаунт</button></>
                )}
              </p>
            </header>

            <div className="client-auth__card card">
              <button className="reg-close" type="button" onClick={onClose} aria-label="Закрыть">✕</button>

              {mode === 'register' ? (
                <>
                  <div className="client-auth__badge">РЕГИСТРАЦИЯ</div>
                  <h1>Создайте аккаунт <span>за минуту</span></h1>
                  <p className="client-auth__sub">И начните отправлять посылки уже сегодня</p>

                  <form className="client-auth__form" onSubmit={handleSubmit}>
                    <label className="client-field">
                      <span className="client-field__icon"><FieldIcon id="user" /></span>
                      <input
                        name="name"
                        autoComplete="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Имя"
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
                        placeholder="Телефон"
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
                        placeholder="Пароль"
                        type={showPass ? 'text' : 'password'}
                        minLength={8}
                        required
                      />
                      <button className="client-field__eye" type="button" onClick={() => setShowPass((v) => !v)} aria-label="Показать пароль">
                        {showPass ? '🙈' : '👁'}
                      </button>
                    </label>
                    {password && (
                      <div className="client-pass-strength">
                        <div className="client-pass-strength__bar"><span style={{ width: strength.width }} /></div>
                        <small>{strength.label}</small>
                      </div>
                    )}
                    <label className="client-terms">
                      <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
                      <span>Согласен с условиями использования и политикой конфиденциальности</span>
                    </label>
                    {error && <p className="client-auth__error">{error}</p>}
                    <button className="btn btn-lime client-auth__submit" type="submit">
                      Создать аккаунт
                    </button>
                  </form>

                  <SocialAuthButtons
                    onApple={() => handleSocial('apple')}
                    onGoogle={() => handleSocial('google')}
                  />
                </>
              ) : (
                <>
                  <div className="client-auth__badge">ВХОД</div>
                  <h1>Добро пожаловать <span>обратно</span></h1>
                  <p className="client-auth__sub">Войдите в личный кабинет MATE</p>

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
                        placeholder="Пароль"
                        type={showPass ? 'text' : 'password'}
                        required
                      />
                      <button className="client-field__eye" type="button" onClick={() => setShowPass((v) => !v)} aria-label="Показать пароль">
                        {showPass ? '🙈' : '👁'}
                      </button>
                    </label>
                    {error && <p className="client-auth__error">{error}</p>}
                    <button className="btn btn-lime client-auth__submit" type="submit">
                      Войти
                    </button>
                  </form>

                  <SocialAuthButtons
                    onApple={() => handleSocial('apple')}
                    onGoogle={() => handleSocial('google')}
                  />
                </>
              )}
            </div>

            <div className="client-auth__trust">
              <div><b>⚡</b><span>Быстро</span></div>
              <div><b>🛡</b><span>Безопасно</span></div>
              <div><b>✓</b><span>Выгодно</span></div>
            </div>
          </>
        )}

        {step === 1 && (
          <div className="client-auth__loading card">
            <div className="client-auth__loading-logo">
              <MateLogo height={46} />
            </div>
            <h2>
              {mode === 'register' ? (
                <>Создаём ваш<br />аккаунт</>
              ) : (
                <>Подгружаем ваш<br />профиль в MATE</>
              )}
            </h2>
            <p>Это займёт всего несколько секунд</p>
            <ul className="reg-checklist client-checklist">
              {progressSteps.map((label, i) => (
                <li key={label} className={['done', 'anim1', 'anim2', 'anim3'][i] || ''}>
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
                {mode === 'register' ? (
                  <>Добро пожаловать<br />в MATE!</>
                ) : (
                  <>С возвращением<br />в MATE!</>
                )}
              </h2>
              <p>
                {mode === 'register'
                  ? 'Ваш аккаунт успешно создан.'
                  : 'Вы успешно вошли в личный кабинет.'}
              </p>
              {emailNotice && <p className="client-auth__email-note">{emailNotice}</p>}
            </div>

            <section className="client-next">
              <h3 className="client-next__title">Что дальше?</h3>
              <div className="client-next__list">
                {clientNextSteps.map((item, index) => (
                  <button
                    key={item.title}
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
              Перейти в личный кабинет
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
