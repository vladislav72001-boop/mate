import { useMemo } from 'react';
import { useI18n } from '../../i18n/context';

export type DraftHintItem = {
  id: string;
  label: string;
  value: string;
  onApply: () => void;
};

type Props = {
  items: DraftHintItem[];
};

export function CalcDraftHints({ items }: Props) {
  const { t } = useI18n();
  const visible = useMemo(() => items.filter((item) => item.value.trim()), [items]);
  if (!visible.length) return null;

  return (
    <div className="calc-draft-hints" role="region" aria-label={t('calc.draftHintsTitle')}>
      <span className="calc-draft-hints__label">{t('calc.draftHintsTitle')}</span>
      <div className="calc-draft-hints__chips">
        {visible.map((item) => (
          <button
            key={item.id}
            type="button"
            className="calc-draft-hints__chip"
            title={t('calc.draftHintApply')}
            onClick={item.onApply}
          >
            <span className="calc-draft-hints__chip-label">{item.label}</span>
            <span className="calc-draft-hints__chip-value">{item.value}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
