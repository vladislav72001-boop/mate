import { useI18n } from '../../i18n/context';
import type { CalcDraft } from './calcDraft';
import { calcDraftRouteLine } from './calcDraftSummary';

const TOTAL_STEPS = 9;

type Props = {
  draft: CalcDraft;
  onContinue: () => void;
  onDismiss: () => void;
};

export function CalcDraftCart({ draft, onContinue, onDismiss }: Props) {
  const { t, locale } = useI18n();
  const route = calcDraftRouteLine(draft, locale);

  return (
    <aside className="calc-draft-cart" aria-label={t('calc.draftCartLabel')}>
      <button type="button" className="calc-draft-cart__main" onClick={onContinue}>
        <span className="calc-draft-cart__icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 12.5V8a2 2 0 0 0-1-1.73l-6-3.46a2 2 0 0 0-2 0L5 6.27A2 2 0 0 0 4 8v8a2 2 0 0 0 1 1.73l6 3.46a2 2 0 0 0 1.35.25" />
            <polyline points="4.3 6.9 12 11.3 19.7 6.9" />
            <line x1="12" y1="21.4" x2="12" y2="11.3" />
            <circle cx="18" cy="17" r="4.4" />
            <path d="M18 15.2V17l1.4 1" />
          </svg>
        </span>
        <span className="calc-draft-cart__body">
          <span className="calc-draft-cart__title">{t('calc.draftCartLabel')}</span>
          <span className="calc-draft-cart__route">{route}</span>
          <span className="calc-draft-cart__meta">
            {t('calc.stepOf', { current: draft.step, total: TOTAL_STEPS })}
            {' · '}
            {t('calc.draftCartContinue')}
          </span>
        </span>
        <span className="calc-draft-cart__arrow" aria-hidden="true">→</span>
      </button>
      <button
        type="button"
        className="calc-draft-cart__dismiss"
        onClick={onDismiss}
        aria-label={t('calc.draftCartDismiss')}
      >
        ×
      </button>
    </aside>
  );
}
