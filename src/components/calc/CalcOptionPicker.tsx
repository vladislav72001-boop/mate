import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMobileSheet } from './useMobileSheet';

type Props = {
  wrapperClassName: string;
  listId: string;
  ariaLabel: string;
  sheetTitle?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  scrollable?: boolean;
  minMenuWidth?: number;
  /** Optional content above the options (e.g. search field) */
  header?: ReactNode;
  children: ReactNode;
};

export function CalcOptionPicker({
  wrapperClassName,
  listId,
  ariaLabel,
  sheetTitle,
  open,
  onOpenChange,
  trigger,
  scrollable = false,
  minMenuWidth = 0,
  header,
  children,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const mobile = useMobileSheet();
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});

  const updateMenuPosition = () => {
    if (!wrapRef.current || mobile) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const width = Math.max(rect.width, minMenuWidth);
    let left = rect.left;
    const maxLeft = window.innerWidth - width - 8;
    if (left > maxLeft) left = Math.max(8, maxLeft);

    setMenuStyle({
      position: 'fixed',
      top: rect.bottom + 6,
      left,
      width,
      zIndex: 5000,
    });
  };

  useLayoutEffect(() => {
    if (!open || mobile) return;
    updateMenuPosition();
  }, [open, mobile, minMenuWidth]);

  useEffect(() => {
    if (!open || mobile) return;
    const onLayout = () => updateMenuPosition();
    window.addEventListener('resize', onLayout);
    window.addEventListener('scroll', onLayout, true);
    return () => {
      window.removeEventListener('resize', onLayout);
      window.removeEventListener('scroll', onLayout, true);
    };
  }, [open, mobile, minMenuWidth]);

  useEffect(() => {
    if (!open || mobile) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        wrapRef.current?.contains(target)
        || panelRef.current?.contains(target)
        || listRef.current?.contains(target)
      ) {
        return;
      }
      onOpenChange(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, mobile, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

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

  const listClassName = [
    'calc-option-list',
    scrollable ? 'calc-option-list--scroll' : '',
    mobile ? 'calc-option-list--sheet' : 'calc-option-list--floating',
  ].filter(Boolean).join(' ');

  const list = (
    <ul
      ref={listRef}
      className={listClassName}
      id={listId}
      role="listbox"
      aria-label={ariaLabel}
      style={mobile || header ? undefined : menuStyle}
    >
      {children}
    </ul>
  );

  const floatingPanel = header ? (
    <div
      ref={panelRef}
      className="calc-option-panel calc-option-panel--floating"
      style={menuStyle}
      role="presentation"
    >
      <div className="calc-option-panel__header">{header}</div>
      {list}
    </div>
  ) : list;

  return (
    <>
      <div className={`${wrapperClassName}${open ? ' is-open' : ''}`} ref={wrapRef}>
        {trigger}
      </div>

      {open && !mobile && createPortal(floatingPanel, document.body)}

      {open && mobile && createPortal(
        <div className="calc-option-sheet-root" role="presentation">
          <button
            type="button"
            className="calc-option-sheet-backdrop"
            aria-label="Закрыть"
            onClick={() => onOpenChange(false)}
          />
          <div
            className="calc-option-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={sheetTitle ?? ariaLabel}
          >
            <div className="calc-option-sheet__grab" aria-hidden />
            {sheetTitle && <p className="calc-option-sheet__title">{sheetTitle}</p>}
            <div className="calc-option-sheet__body">
              {header && <div className="calc-option-panel__header calc-option-panel__header--sheet">{header}</div>}
              {list}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
