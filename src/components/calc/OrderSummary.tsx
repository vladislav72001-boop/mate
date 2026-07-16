import { DEFAULT_QUOTE_CURRENCY, countryLabel, formatQuoteMoney } from '../../constants/shipping';
import { useI18n } from '../../i18n/context';
import { CountryFlag } from './CountryFlag';

export type SummaryRow = {
  key: string;
  label: string;
  value: string;
  onEdit?: () => void;
};

type Props = {
  rows: SummaryRow[];
  price: number | null;
  currency?: string;
  deliveryEstimate?: string;
  compact?: boolean;
  pricePending?: boolean;
  welcomeDiscountPercent?: number | null;
};

export function OrderSummary({
  rows,
  price,
  currency = DEFAULT_QUOTE_CURRENCY,
  deliveryEstimate,
  compact = false,
  pricePending = false,
  welcomeDiscountPercent = null,
}: Props) {
  const { t } = useI18n();
  const formatMoney = (n: number) => formatQuoteMoney(n, currency);
  const estimate = deliveryEstimate ?? t('calc.deliveryEstimate');
  const routeRow = rows.find((r) => r.key === 'from');

  return (
    <aside className={`calc-summary${compact ? ' calc-summary--compact' : ''}`}>
      <div className="calc-summary__head">
        <span className="calc-summary__icon" aria-hidden>📋</span>
        <span>{t('calc.summaryTitle')}</span>
        {compact && routeRow && (
          <span className="calc-summary__route-inline">
            <RouteValue from={routeRow.value} />
          </span>
        )}
      </div>

      {!compact && (
        <ul className="calc-summary__rows">
          {rows.map((row) => (
            <li key={row.key}>
              <span className="calc-summary__label">{row.label}</span>
              <span className="calc-summary__value">
                {row.key === 'from' ? <RouteValue from={row.value} /> : row.value}
                {row.onEdit && (
                  <button type="button" className="calc-summary__edit" onClick={row.onEdit} aria-label={t('calc.editRow', { label: row.label })}>
                    ✎
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="calc-summary__price">
        <strong className={pricePending ? 'calc-summary__price--pending' : undefined}>
          {price != null ? formatMoney(price) : pricePending ? t('calc.summaryCalculating') : '—'}
        </strong>
        {welcomeDiscountPercent != null && welcomeDiscountPercent > 0 && (
          <span className="calc-summary__discount">{t('dash.welcomeDiscountTitle', { percent: welcomeDiscountPercent })}</span>
        )}
        <span>{estimate}</span>
      </div>
    </aside>
  );
}

function RouteValue({ from }: { from: string }) {
  const { locale } = useI18n();
  const parts = from.split('→').map((p) => p.trim());
  if (parts.length !== 2) return from;

  const parseSide = (side: string) => {
    const code = side.trim().split(/\s+/)[0];
    if (/^[A-Z]{2}$/.test(code)) {
      return { code, label: countryLabel(code, locale) };
    }
    return { code: '', label: side };
  };

  const left = parseSide(parts[0]);
  const right = parseSide(parts[1]);

  return (
    <span className="calc-summary__route">
      {left.code && <CountryFlag code={left.code} size={16} />}
      <span>{left.label}</span>
      <span className="calc-summary__route-arrow">→</span>
      {right.code && <CountryFlag code={right.code} size={16} />}
      <span>{right.label}</span>
    </span>
  );
}

export function formatRoute(from: string, to: string) {
  return `${from} → ${to}`;
}

export function formatDeliveryType(pickup: string, delivery: string) {
  const labels: Record<string, string> = {
    home: 'Адрес',
    branch: 'Филиал',
    locker: 'Постамат',
  };
  return `${labels[pickup] || pickup} → ${labels[delivery] || delivery}`;
}
