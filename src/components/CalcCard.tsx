import { useState } from 'react';
import type { AuthUser } from '../api/auth';
import { useT } from '../i18n/context';
import { CalcForm, TrackShipment } from './ShipmentCalculator';

type Props = {
  user?: AuthUser | null;
  onOrderSuccess?: () => void;
  onStepChange?: (step: number) => void;
  resetToStep1Signal?: number;
};

export function CalcCard({ user, onOrderSuccess, onStepChange, resetToStep1Signal }: Props) {
  const t = useT();
  const [tab, setTab] = useState<'calc' | 'track'>('calc');
  const [formKey, setFormKey] = useState(0);

  const switchTab = (next: 'calc' | 'track') => {
    setTab(next);
    if (next === 'calc') {
      setFormKey((k) => k + 1);
    } else {
      onStepChange?.(1);
    }
  };

  return (
    <aside className="calc-card card">
      <div className="calc-tabs">
        <button className={tab === 'calc' ? 'active' : ''} type="button" onClick={() => switchTab('calc')}>
          {t('calc.tabCalc')}
        </button>
        <button className={tab === 'track' ? 'active' : ''} type="button" onClick={() => switchTab('track')}>
          {t('calc.tabTrack')}
        </button>
      </div>

      <div className="calc-card__body">
        {tab === 'calc' ? (
          <CalcForm
            key={formKey}
            user={user}
            onSuccess={() => {
              onOrderSuccess?.();
            }}
            onDone={() => setFormKey((k) => k + 1)}
            onStepChange={onStepChange}
            resetToStep1Signal={resetToStep1Signal}
          />
        ) : (
          <TrackShipment />
        )}
      </div>

      <div className="calc-meta">
        <span>{t('calc.metaFast')}</span>
        <span>{t('calc.metaClear')}</span>
        <span>{t('calc.metaReliable')}</span>
      </div>
    </aside>
  );
}
