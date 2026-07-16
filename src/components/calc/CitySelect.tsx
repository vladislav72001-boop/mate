import { useId, useState } from 'react';
import { countryFlag, countryLabel } from '../../constants/shipping';
import { cityLabelForValue, cityOptionsForCountry, type CityOption } from '../../constants/cities';
import { CalcOptionPicker } from './CalcOptionPicker';
import { CountryFlag } from './CountryFlag';

type Props = {
  country: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
};

export function CitySelect({
  country,
  value,
  onChange,
  placeholder = 'Выберите город',
  ariaLabel = 'Город',
}: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const options: CityOption[] = cityOptionsForCountry(country);
  const label = value ? cityLabelForValue(country, value) : placeholder;
  const sheetTitle = `${ariaLabel} · ${countryLabel(country)} ${countryFlag(country)}`;

  if (!options.length) {
    return (
      <input
        className="calc-form__select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    );
  }

  return (
    <CalcOptionPicker
      wrapperClassName="calc-city-select"
      listId={listId}
      ariaLabel={ariaLabel}
      sheetTitle={sheetTitle}
      open={open}
      onOpenChange={setOpen}
      scrollable
      trigger={(
        <button
          type="button"
          className={`calc-option-trigger${open ? ' is-open' : ''}${!value ? ' calc-option-trigger--placeholder' : ''}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((v) => !v)}
        >
          <CountryFlag code={country} size={22} className="calc-city-select__flag" />
          <span className="calc-option-trigger__label">{label}</span>
          <span className="calc-option-trigger__chev" aria-hidden />
        </button>
      )}
    >
      {options.map((c) => {
        const active = c.value === value;
        return (
          <li key={c.value} role="presentation">
            <button
              type="button"
              role="option"
              aria-selected={active}
              className={`calc-option-list__item${active ? ' is-active' : ''}`}
              onClick={() => {
                onChange(c.value);
                setOpen(false);
              }}
            >
              <span className="calc-option-list__text">{c.label}</span>
              {active && <span className="calc-option-list__check" aria-hidden>✓</span>}
            </button>
          </li>
        );
      })}
    </CalcOptionPicker>
  );
}
