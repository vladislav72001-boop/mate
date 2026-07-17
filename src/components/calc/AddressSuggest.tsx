import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  fetchAddressSuggestions,
  type AddressSuggestion,
} from '../../api/shipping';
import type { AddressEntry } from '../../api/client-types';
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
  /** Saved address-book entries to show first in suggestions */
  bookAddresses?: AddressEntry[];
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
  const labelParts = [q.trim(), city || near?.city].filter(Boolean);
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

function bookToSuggestion(entry: AddressEntry): AddressSuggestion {
  const center = cityFallbackCoords(entry.country, entry.city);
  const labelParts = [entry.street, entry.city, entry.postal].filter(Boolean);
  return {
    id: `book:${entry.id}`,
    label: labelParts.join(', '),
    street: entry.street,
    city: entry.city,
    postal: entry.postal,
    country: String(entry.country || '').toUpperCase(),
    lat: center?.lat ?? 0,
    lng: center?.lng ?? 0,
  };
}

function matchesQuery(entry: AddressEntry, q: string) {
  if (!q) return true;
  const hay = `${entry.label} ${entry.street} ${entry.city} ${entry.postal} ${entry.name}`.toLowerCase();
  return hay.includes(q.toLowerCase());
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
  bookAddresses = [],
}: Props) {
  const { t, locale } = useI18n();
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<AddressSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const skipFetchRef = useRef(false);

  const savedMatches = useMemo(() => {
    const cc = String(country || '').toUpperCase();
    const q = value.trim();
    return bookAddresses
      .filter((a) => !cc || String(a.country || '').toUpperCase() === cc)
      .filter((a) => matchesQuery(a, q))
      .map(bookToSuggestion);
  }, [bookAddresses, country, value]);

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
        const suggestions = await fetchAddressSuggestions({
          q,
          country,
          city,
          lang: locale,
        });
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
  }, [value, country, city, t, locale]);

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
  const hasSaved = savedMatches.length > 0;
  const approx = useMemo(() => {
    if (!canSuggest || items.length > 0) return null;
    return buildApproxSuggestion(q, country, city, null);
  }, [canSuggest, q, country, city, items.length]);

  const showPanel =
    open
    && (hasSaved || canSuggest)
    && (loading || searched || items.length > 0 || hasSaved || Boolean(error));
  const showEmpty = searched && !loading && !error && items.length === 0 && !hasSaved && !approx;

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
            if (canSuggest || hasSaved) setOpen(true);
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
          {!loading && searched && items.length > 0 && !hasSaved && (
            <p className="calc-address__status calc-address__status--muted">{t('calc.addressPickHint')}</p>
          )}

          <ul
            id={`${listId}-list`}
            className="calc-address__list"
            role="listbox"
            aria-label={t('calc.addressSuggestions')}
          >
            {hasSaved && (
              <>
                <li className="calc-address__group" role="presentation">
                  {t('calc.addressFromBook')}
                </li>
                {savedMatches.map((item) => (
                  <li key={item.id} role="option">
                    <button
                      type="button"
                      className="calc-address__saved"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(item)}
                    >
                      <b>{item.street || item.label}</b>
                      <em>{[item.city, item.postal].filter(Boolean).join(', ')}</em>
                    </button>
                  </li>
                ))}
              </>
            )}
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
                  <em>{[item.city, item.postal].filter(Boolean).join(', ') || item.label}</em>
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
