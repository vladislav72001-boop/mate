import { useId, useState } from 'react';
import { COUNTRIES, countryLabel } from '../../constants/shipping';
import { useT } from '../../i18n/context';
import { CalcOptionPicker } from './CalcOptionPicker';
import { CountryFlag } from './CountryFlag';

type Props = {
  value: string;
  onChange: (code: string) => void;
  exclude?: string;
};

export function CountrySelect({ value, onChange, exclude }: Props) {
  const t = useT();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const options = COUNTRIES.filter((c) => c.code !== exclude);
  const selected = COUNTRIES.find((c) => c.code === value) ?? options[0];

  return (
    <CalcOptionPicker
      wrapperClassName="calc-country-select"
      listId={listId}
      ariaLabel={t('calc.country')}
      sheetTitle={t('calc.selectCountry')}
      open={open}
      onOpenChange={setOpen}
      trigger={(
        <button
          type="button"
          className={`calc-option-trigger${open ? ' is-open' : ''}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((v) => !v)}
        >
          <CountryFlag code={selected?.code ?? value} size={22} className="calc-country-select__flag" />
          <span className="calc-option-trigger__label">
            {countryLabel(selected?.code ?? value)}
          </span>
          <span className="calc-option-trigger__chev" aria-hidden />
        </button>
      )}
    >
      {options.map((c) => {
        const active = c.code === value;
        return (
          <li key={c.code} role="presentation">
            <button
              type="button"
              role="option"
              aria-selected={active}
              className={`calc-option-list__item${active ? ' is-active' : ''}`}
              onClick={() => {
                onChange(c.code);
                setOpen(false);
              }}
            >
              <CountryFlag code={c.code} size={20} />
              <span className="calc-option-list__text">
                {countryLabel(c.code)}
              </span>
              {active && <span className="calc-option-list__check" aria-hidden>✓</span>}
            </button>
          </li>
        );
      })}
    </CalcOptionPicker>
  );
}
