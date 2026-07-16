import type { ShippingOrder } from '../../api/shipping';
import { countryLabel } from '../../constants/shipping';
import { useT } from '../../i18n/context';
type Props = {
  order: ShippingOrder;
  dateLabel: string;
  amountLabel: string;
  statusLabel: string;
  statusClass: string;
  onOpen: () => void;
  onPay?: () => void;
  paying?: boolean;
};

export function PaymentCard({
  order,
  dateLabel,
  amountLabel,
  statusLabel,
  statusClass,
  onOpen,
  onPay,
  paying = false,
}: Props) {
  const t = useT();
  const description = t('dash.deliveryDesc', {
    from: countryLabel(order.fromCountry || 'HU'),
    to: countryLabel(order.toCountry || ''),
  });
  return (
    <article
      className="client-dash-payment-card"
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      role="button"
      tabIndex={0}
    >
      <div className="client-dash-payment-card__head">
        <div className="client-dash-payment-card__id">
          <span className="client-dash-payment-card__eyebrow">{t('dash.invoice')}</span>          <b className="client-dash-payment-card__number">{order.orderNumber}</b>
          <small>{dateLabel}</small>
        </div>
        <span className={`client-dash__badge client-dash__badge--${statusClass}`}>{statusLabel}</span>
      </div>

      <dl className="client-dash-payment-card__meta">
        <div>
          <dt>{t('dash.description')}</dt>          <dd>{description}</dd>
        </div>
        <div>
          <dt>{t('dash.cardAmount')}</dt>          <dd className="client-dash-payment-card__amount">{amountLabel}</dd>
        </div>
      </dl>

      <div
        className="client-dash-payment-card__actions"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {onPay ? (
          <button type="button" className="btn btn-lime btn-sm" disabled={paying} onClick={onPay}>
            {paying ? '…' : t('dash.pay')}
          </button>
        ) : (
          <button type="button" className="text-link client-dash__link" onClick={() => window.print()}>
            {t('dash.download')}          </button>
        )}
      </div>
    </article>
  );
}
