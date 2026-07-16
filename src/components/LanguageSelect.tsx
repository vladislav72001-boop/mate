import { useEffect, useId, useRef, useState } from 'react';
import { CountryFlag } from './calc/CountryFlag';
import { LOCALE_OPTIONS } from '../i18n/config';
import { useI18n } from '../i18n/context';
import type { Locale } from '../i18n/types';

type Props = {
  variant?: 'header' | 'menu' | 'compact';
};

export function LanguageSelect({ variant = 'header' }: Props) {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = LOCALE_OPTIONS.find((item) => item.code === locale) ?? LOCALE_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (code: Locale) => {
    setLocale(code);
    setOpen(false);
  };

  return (
    <div
      ref={rootRef}
      className={`lang-select lang-select--${variant}${open ? ' is-open' : ''}`}
    >
      <button
        type="button"
        className="lang-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        <CountryFlag code={current.flag} size={20} className="lang-select__flag" />
        <span className="lang-select__label">{t(`lang.${current.code}`)}</span>
        <span className="lang-select__chev" aria-hidden>▾</span>
      </button>

      {open && (
        <ul id={listId} className="lang-select__menu" role="listbox" aria-label={t('lang.label')}>
          {LOCALE_OPTIONS.map((item) => {
            const active = item.code === locale;
            return (
              <li key={item.code} role="option" aria-selected={active}>
                <button
                  type="button"
                  className={`lang-select__option${active ? ' is-active' : ''}`}
                  onClick={() => pick(item.code)}
                >
                  <CountryFlag code={item.flag} size={22} className="lang-select__flag" />
                  <span>{t(`lang.${item.code}`)}</span>
                  {active && <span className="lang-select__check" aria-hidden>✓</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
