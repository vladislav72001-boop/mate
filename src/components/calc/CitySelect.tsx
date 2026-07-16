import { useId, useState } from 'react';
import { countryFlag, countryLabel } from '../../constants/shipping';
import { cityLabelForValue, cityOptionsForDisplay, type CityOption } from '../../constants/cities';
import { useI18n } from '../../i18n/context';
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
  placeholder,
  ariaLabel,
}: Props) {
  const { locale, t } = useI18n();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const resolvedPlaceholder = placeholder || t('calc.cityPlaceholder');
  const resolvedAria = ariaLabel || t('calc.city');
  const options: CityOption[] = cityOptionsForDisplay(country, locale);
  const label = value ? cityLabelForValue(country, value, locale) : resolvedPlaceholder;
  const sheetTitle = `${resolvedAria} · ${countryLabel(country, locale)} ${countryFlag(country)}`;

  if (!options.length) {
    return (
      <input
        className="calc-form__select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={resolvedPlaceholder}
      />
    );
  }

  return (
    <CalcOptionPicker
      wrapperClassName="calc-city-select"
      listId={listId}
      ariaLabel={resolvedAria}
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
