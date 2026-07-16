import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  fetchAddressSuggestions,
  type AddressSuggestion,
} from '../../api/shipping';

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
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<AddressSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
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
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [value, country, city]);

  const updatePanelPosition = () => {
    const el = inputRef.current ?? wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = rect.width;
    let left = rect.left;
    const maxLeft = window.innerWidth - width - 8;
    if (left > maxLeft) left = Math.max(8, maxLeft);

    const vv = window.visualViewport;
    const viewTop = vv?.offsetTop ?? 0;
    const viewBottom = viewTop + (vv?.height ?? window.innerHeight);
    const gap = 4;
    const preferredMax = Math.min(280, Math.floor((viewBottom - viewTop) * 0.42));
    const spaceBelow = viewBottom - rect.bottom - gap - 8;
    const spaceAbove = rect.top - viewTop - gap - 8;
    const placeAbove = spaceBelow < 120 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(96, Math.min(preferredMax, placeAbove ? spaceAbove : spaceBelow));

    setPanelStyle({
      position: 'fixed',
      left,
      width,
      zIndex: 5000,
      maxHeight,
      ...(placeAbove
        ? { bottom: window.innerHeight - rect.top + gap, top: 'auto' }
        : { top: rect.bottom + gap, bottom: 'auto' }),
    });
  };

  const showPanel = open && (loading || searched || items.length > 0);

  useLayoutEffect(() => {
    if (!showPanel) return;
    updatePanelPosition();
  }, [showPanel, items.length, loading, error]);

  useEffect(() => {
    if (!showPanel) return;
    const onLayout = () => updatePanelPosition();
    window.addEventListener('resize', onLayout);
    window.addEventListener('scroll', onLayout, true);
    window.visualViewport?.addEventListener('resize', onLayout);
    window.visualViewport?.addEventListener('scroll', onLayout);
    return () => {
      window.removeEventListener('resize', onLayout);
      window.removeEventListener('scroll', onLayout, true);
      window.visualViewport?.removeEventListener('resize', onLayout);
      window.visualViewport?.removeEventListener('scroll', onLayout);
    };
  }, [showPanel]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
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

  const showEmpty = searched && !loading && !error && items.length === 0 && value.trim().length >= 3;

  const panel = showPanel ? (
    <div
      ref={panelRef}
      className="calc-address__panel calc-address__panel--floating"
      role="presentation"
      style={panelStyle}
    >
      {loading && <p className="calc-address__status">Ищем адрес…</p>}
      {error && <p className="calc-address__status calc-address__status--error">{error}</p>}
      {showEmpty && (
        <p className="calc-address__status">
          Адрес не найден. Попробуйте «улица 7» или добавьте район / город.
        </p>
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
      )}
    </div>
  ) : null;

  return (
    <div className={`field-block calc-address${open ? ' is-open' : ''}`} ref={wrapRef}>
      <label htmlFor={listId}>{label}</label>
      <div className="calc-address__control">
        <input
          ref={inputRef}
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
            if (items.length || searched || loading || value.trim().length >= 3) setOpen(true);
          }}
          aria-autocomplete="list"
          aria-expanded={showPanel}
          aria-controls={`${listId}-list`}
        />
        {loading && <span className="calc-address__spinner" aria-hidden />}
      </div>
      {hint && !showPanel && <p className="calc-form__hint">{hint}</p>}
      {panel && createPortal(panel, document.body)}
    </div>
  );
}
