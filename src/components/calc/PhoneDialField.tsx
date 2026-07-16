import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { countryLabel, countryCodeFromDial, PHONE_PREFIXES } from '../../constants/shipping';
import { useI18n } from '../../i18n/context';
import { CalcOptionPicker } from './CalcOptionPicker';
import { CountryFlag } from './CountryFlag';

type Props = {
  dial: string;
  onDialChange: (value: string) => void;
  phone: string;
  onPhoneChange: (value: string) => void;
  placeholder?: string;
  defaultCountry?: string;
  autoComplete?: string;
  name?: string;
};

function fold(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function PhoneDialField({
  dial,
  onDialChange,
  phone,
  onPhoneChange,
  placeholder = '301234567',
  defaultCountry = 'HU',
  autoComplete = 'tel-national',
  name = 'phone',
}: Props) {
  const { locale, t } = useI18n();
  const listId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const known = PHONE_PREFIXES.some((p) => p.dial === dial);
  const selectedDial = known ? dial : PHONE_PREFIXES.find((p) => p.code === defaultCountry)?.dial || '+36';
  const flagCode = countryCodeFromDial(selectedDial) || defaultCountry;

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const timer = window.setTimeout(() => searchRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, [open]);

  const filtered = useMemo(() => {
    const q = fold(query);
    if (!q) return PHONE_PREFIXES;
    return PHONE_PREFIXES.filter((p) => {
      const label = fold(countryLabel(p.code, locale));
      const dialDigits = p.dial.replace(/\D/g, '');
      const qDigits = q.replace(/\D/g, '');
      return (
        fold(p.dial).includes(q)
        || fold(p.code).includes(q)
        || label.includes(q)
        || (qDigits.length > 0 && dialDigits.includes(qDigits))
      );
    });
  }, [query, locale]);

  const pick = (nextDial: string) => {
    onDialChange(nextDial);
    setOpen(false);
    setQuery('');
  };

  const searchHeader = (
    <input
      ref={searchRef}
      type="search"
      className="calc-option-search"
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder={t('calc.dialSearch')}
      aria-label={t('calc.dialSearch')}
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (filtered[0]) pick(filtered[0].dial);
        }
      }}
    />
  );

  return (
    <div className="calc-form__phone">
      <CalcOptionPicker
        wrapperClassName="calc-form__dial calc-phone-dial"
        listId={listId}
        ariaLabel={t('calc.dialCode')}
        sheetTitle={t('calc.dialCode')}
        open={open}
        onOpenChange={setOpen}
        scrollable
        minMenuWidth={300}
        header={searchHeader}
        trigger={(
          <button
            type="button"
            className={`calc-phone-dial__trigger${open ? ' is-open' : ''}`}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((v) => !v)}
          >
            <CountryFlag code={flagCode} size={20} className="calc-phone-dial__flag" />
            <span className="calc-phone-dial__code">{selectedDial}</span>
            <span className="calc-phone-dial__chev" aria-hidden />
          </button>
        )}
      >
        {filtered.length === 0 ? (
          <li role="presentation" className="calc-option-list__empty">
            {t('calc.dialSearchEmpty')}
          </li>
        ) : (
          filtered.map((p) => {
            const active = p.dial === selectedDial;
            return (
              <li key={p.dial} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`calc-option-list__item${active ? ' is-active' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(p.dial)}
                >
                  <CountryFlag code={p.code} size={20} />
                  <span className="calc-option-list__text calc-phone-dial__option">
                    <b>{p.dial}</b>
                    <em>{countryLabel(p.code, locale)}</em>
                  </span>
                  {active && <span className="calc-option-list__check" aria-hidden>✓</span>}
                </button>
              </li>
            );
          })
        )}
      </CalcOptionPicker>
      <input
        className="calc-form__phone-input"
        name={name}
        value={phone}
        onChange={(e) => onPhoneChange(e.target.value)}
        placeholder={placeholder}
        inputMode="tel"
        type="tel"
        autoComplete={autoComplete}
        aria-label={t('calc.phone')}
      />
    </div>
  );
}
