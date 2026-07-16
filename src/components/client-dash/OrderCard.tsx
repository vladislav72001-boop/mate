import type { ShippingOrder } from '../../api/shipping';
import { countryLabel } from '../../constants/shipping';
import { useT } from '../../i18n/context';
type Props = {
  order: ShippingOrder;
  statusLabel: string;
  statusClass: string;
  amountLabel: string;
  onOpen: () => void;
  onPay?: () => void;
  onCancel?: () => void;
  onTrack?: () => void;
  onDetail?: () => void;
  paying?: boolean;
  cancelling?: boolean;
  variant?: 'home' | 'full';
  pickupDate?: string;
};

export function OrderCard({
  order,
  statusLabel,
  statusClass,
  amountLabel,
  onOpen,
  onPay,
  onCancel,
  onTrack,
  onDetail,
  paying = false,
  cancelling = false,
  variant = 'home',
  pickupDate,
}: Props) {
  const t = useT();
  const route = `${countryLabel(order.fromCountry || 'HU')} → ${countryLabel(order.toCountry || '')}`;
  return (
    <article
      className="client-dash-order-card"
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      role="button"
      tabIndex={0}
    >
      <div className="client-dash-order-card__head">
        <div className="client-dash-order-card__id">
          <span className="client-dash-order-card__eyebrow">{t('dash.cardNumber')}</span>
          <b className="client-dash-order-card__number">{order.orderNumber}</b>
          {order.npTtn && (
            <small className={order.npValid === false ? 'client-dash__ttn-warn' : ''}>
              {order.npValid === false ? t('dash.npNotCreated') : t('dash.ttnFmt', { ttn: order.npTtn })}
            </small>
          )}        </div>
        <span className={`client-dash__badge client-dash__badge--${statusClass}`}>{statusLabel}</span>
      </div>

      <dl className="client-dash-order-card__meta">
        <div>
          <dt>{t('dash.cardRoute')}</dt>          <dd>{route}</dd>
        </div>
        {variant === 'full' && (
          <>
            <div>
              <dt>{t('dash.cardSize')}</dt>              <dd>{order.parcelSize || '—'}</dd>
            </div>
            <div>
              <dt>{t('dash.cardPickup')}</dt>              <dd>{pickupDate || '—'}</dd>
            </div>
          </>
        )}
        <div>
          <dt>{t('dash.cardAmount')}</dt>          <dd className="client-dash-order-card__amount">{amountLabel}</dd>
        </div>
      </dl>

      {(onPay || onCancel || onTrack || onDetail) && (
        <div
          className="client-dash-order-card__actions"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {onPay && (
            <button type="button" className="btn btn-lime btn-sm" disabled={paying} onClick={onPay}>
              {paying ? '…' : t('dash.pay')}
            </button>
          )}
          {onCancel && (
            <button type="button" className="btn btn-outline btn-sm" disabled={cancelling} onClick={onCancel}>
              {t('dash.cancel')}
            </button>
          )}
          {onTrack && (
            <button type="button" className="text-link client-dash__link" onClick={onTrack}>
              {t('dash.track')}
            </button>
          )}
          {onDetail && (
            <button type="button" className="text-link client-dash__link" onClick={onDetail}>
              {t('dash.details')}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
