import { useId, useState } from 'react';
import { countryLabel, countryCodeFromDial, PHONE_PREFIXES } from '../../constants/shipping';
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
  const listId = useId();
  const [open, setOpen] = useState(false);
  const known = PHONE_PREFIXES.some((p) => p.dial === dial);
  const selectedDial = known ? dial : PHONE_PREFIXES.find((p) => p.code === defaultCountry)?.dial || '+36';
  const flagCode = countryCodeFromDial(selectedDial) || defaultCountry;

  return (
    <div className="calc-form__phone">
      <CalcOptionPicker
        wrapperClassName="calc-form__dial calc-phone-dial"
        listId={listId}
        ariaLabel="Код страны"
        sheetTitle="Код страны"
        open={open}
        onOpenChange={setOpen}
        scrollable
        minMenuWidth={280}
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
        {PHONE_PREFIXES.map((p) => {
          const active = p.dial === selectedDial;
          return (
            <li key={p.dial} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={active}
                className={`calc-option-list__item${active ? ' is-active' : ''}`}
                onClick={() => {
                  onDialChange(p.dial);
                  setOpen(false);
                }}
              >
                <CountryFlag code={p.code} size={20} />
                <span className="calc-option-list__text calc-phone-dial__option">
                  <b>{p.dial}</b>
                  <em>{countryLabel(p.code)}</em>
                </span>
                {active && <span className="calc-option-list__check" aria-hidden>✓</span>}
              </button>
            </li>
          );
        })}
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
        aria-label="Номер телефона"
      />
    </div>
  );
}
