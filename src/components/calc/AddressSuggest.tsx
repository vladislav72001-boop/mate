import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  fetchAddressSuggestions,
  type AddressSuggestion,
} from '../../api/shipping';
import { useI18n } from '../../i18n/context';
import { CITY_COORDS } from './LockerPicker';

type Props = {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  onSelect: (suggestion: AddressSuggestion) => void;
  country?: string;
  city?: string;
  placeholder?: string;
  name?: string;
  hint?: string;
  disabled?: boolean;
};

function cityFallbackCoords(country?: string, city?: string) {
  const cc = String(country || '').toUpperCase();
  const name = String(city || '').trim();
  const exact = CITY_COORDS.find((c) => c.country === cc && c.city === name);
  if (exact) return exact;
  return CITY_COORDS.find((c) => c.country === cc) || null;
}

function buildApproxSuggestion(
  q: string,
  country: string | undefined,
  city: string | undefined,
  near: AddressSuggestion | null,
): AddressSuggestion {
  const center = cityFallbackCoords(country, city);
  const labelParts = [q.trim(), city || near?.city, country].filter(Boolean);
  return {
    id: `approx:${q.trim().toLowerCase()}:${city || ''}`,
    label: labelParts.join(', '),
    street: q.trim(),
    city: city || near?.city || '',
    postal: near?.postal || '',
    country: String(country || near?.country || '').toUpperCase(),
    lat: near?.lat ?? center?.lat ?? 0,
    lng: near?.lng ?? center?.lng ?? 0,
  };
}

export function AddressSuggest({
  label = 'Адрес',
  value,
  onChange,
  onSelect,
  country,
  city,
  placeholder = 'Улица, номер дома, город',
  name = 'address_suggest',
  hint,
  disabled = false,
}: Props) {
  const { t } = useI18n();
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<AddressSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const skipFetchRef = useRef(false);

  useEffect(() => {
    if (skipFetchRef.current) {
      skipFetchRef.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < 3) {
      setItems([]);
      setLoading(false);
      setError(null);
      setSearched(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setOpen(true);
    const timer = window.setTimeout(async () => {
      setSearched(false);
      try {
        const suggestions = await fetchAddressSuggestions({ q, country, city });
        if (!cancelled) {
          setItems(suggestions);
          setSearched(true);
          setOpen(true);
        }
      } catch (e) {
        if (!cancelled) {
          setItems([]);
          setSearched(true);
          setOpen(true);
          setError(e instanceof Error ? e.message : t('calc.addressSearchFail'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [value, country, city, t]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const pick = (item: AddressSuggestion) => {
    skipFetchRef.current = true;
    onChange(item.label);
    onSelect(item);
    setItems([]);
    setOpen(false);
    setError(null);
    setSearched(false);
  };

  const q = value.trim();
  const canSuggest = q.length >= 3;
  const approx = useMemo(() => {
    if (!canSuggest) return null;
    return buildApproxSuggestion(q, country, city, items[0] || null);
  }, [canSuggest, q, country, city, items]);

  const showPanel = open && canSuggest && (loading || searched || items.length > 0 || Boolean(error));
  const showEmpty = searched && !loading && !error && items.length === 0;

  return (
    <div className={`field-block calc-address${open ? ' is-open' : ''}`} ref={wrapRef}>
      <label htmlFor={listId}>{label}</label>
      <div className="calc-address__control">
        <input
          id={listId}
          name={name}
          type="text"
          autoComplete="off"
          inputMode="text"
          enterKeyHint="search"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (canSuggest) setOpen(true);
          }}
          aria-autocomplete="list"
          aria-expanded={showPanel}
          aria-controls={`${listId}-list`}
        />
        {loading && <span className="calc-address__spinner" aria-hidden />}
      </div>

      {showPanel && (
        <div className="calc-address__panel calc-address__panel--inline" role="presentation">
          {loading && <p className="calc-address__status">{t('calc.addressSearching')}</p>}
          {error && <p className="calc-address__status calc-address__status--error">{error}</p>}
          {showEmpty && (
            <p className="calc-address__status">{t('calc.addressEmpty')}</p>
          )}
          {!loading && searched && items.length > 0 && (
            <p className="calc-address__status calc-address__status--muted">{t('calc.addressPickHint')}</p>
          )}

          <ul
            id={`${listId}-list`}
            className="calc-address__list"
            role="listbox"
            aria-label={t('calc.addressSuggestions')}
          >
            {approx && searched && !loading && (
              <li role="option">
                <button
                  type="button"
                  className="calc-address__approx"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(approx)}
                >
                  <b>{t('calc.addressApprox')}</b>
                  <em>{approx.label}</em>
                </button>
              </li>
            )}
            {items.map((item) => (
              <li key={item.id} role="option">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(item)}
                >
                  <b>{item.street || item.label.split(',')[0]}</b>
                  <em>{item.label}</em>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hint && !showPanel && <p className="calc-form__hint">{hint}</p>}
    </div>
  );
}
