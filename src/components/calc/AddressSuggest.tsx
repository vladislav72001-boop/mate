import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  fetchAddressSuggestions,
  type AddressSuggestion,
} from '../../api/shipping';
import { useMobileSheet } from './useMobileSheet';

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
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const mobile = useMobileSheet();
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
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
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
          setError(e instanceof Error ? e.message : 'Не удалось найти адрес');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 320);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [value, country, city]);

  useEffect(() => {
    if (!open || mobile) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, mobile]);

  useEffect(() => {
    if (!open || !mobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('calc-option-sheet-open');
    return () => {
      document.body.style.overflow = prev;
      document.body.classList.remove('calc-option-sheet-open');
    };
  }, [open, mobile]);

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

  const showPanel = open && (loading || searched || items.length > 0);
  const showEmpty = searched && !loading && !error && items.length === 0 && value.trim().length >= 3;

  const listContent = (
    <>
      {loading && (
        <p className="calc-address__status">Ищем адрес…</p>
      )}
      {error && (
        <p className="calc-address__status calc-address__status--error">{error}</p>
      )}
      {showEmpty && (
        <p className="calc-address__status">Адрес не найден. Проверьте написание или добавьте город.</p>
      )}
      {items.length > 0 && (
        <ul
          id={`${listId}-list`}
          className="calc-address__list"
          role="listbox"
          aria-label="Подсказки адресов"
        >
          {items.map((item) => (
            <li key={item.id} role="option">
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(item)}>
                <b>{item.street || item.label.split(',')[0]}</b>
                <em>{item.label}</em>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  return (
    <div className={`field-block calc-address${open ? ' is-open' : ''}`} ref={wrapRef}>
      <label htmlFor={listId}>{label}</label>
      <div className="calc-address__control">
        <input
          id={listId}
          name={name}
          type="text"
          autoComplete="off"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (items.length || searched || loading) setOpen(true);
          }}
          aria-autocomplete="list"
          aria-expanded={showPanel}
          aria-controls={`${listId}-list`}
        />
        {loading && <span className="calc-address__spinner" aria-hidden />}
        {showPanel && !mobile && (
          <div className="calc-address__panel" role="presentation">
            {listContent}
          </div>
        )}
      </div>
      {hint && !error && !showEmpty && <p className="calc-form__hint">{hint}</p>}

      {showPanel && mobile && createPortal(
        <div className="calc-option-sheet-root" role="presentation">
          <button
            type="button"
            className="calc-option-sheet-backdrop"
            aria-label="Закрыть"
            onClick={() => setOpen(false)}
          />
          <div className="calc-option-sheet calc-address-sheet" role="dialog" aria-modal="true" aria-label={label}>
            <div className="calc-option-sheet__grab" aria-hidden />
            <p className="calc-option-sheet__title">{label}</p>
            <div className="calc-option-sheet__body calc-address-sheet__body">
              {listContent}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
