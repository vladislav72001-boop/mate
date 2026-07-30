import type { ShippingOrder } from '../../api/shipping';
import { openWaybillPdf } from '../../api/shipping';
import { countryLabel } from '../../constants/shipping';
import { useI18n } from '../../i18n/context';
import { TrackingMap } from './TrackingMap';

type Props = {
  order: ShippingOrder;
  onClose: () => void;
  onPay?: (order: ShippingOrder) => void;
  onCancel?: (order: ShippingOrder) => void;
  onTrack?: (order: ShippingOrder) => void;
  paying?: boolean;
  cancelling?: boolean;
  /** When false, hide Pay even if status is pending_payment (sender waiting for recipient). */
  canPayOverride?: boolean;
};

function formatDate(iso: string | null | undefined, locale: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(locale, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMoney(amount: number, currency: string) {
  return `${amount.toFixed(2)} ${currency}`;
}

function statusLabel(
  status: string,
  t: (key: string) => string,
  opts?: { awaitingRecipient?: boolean },
) {
  if (status === 'submitted') return t('dash.statusSubmitted');
  if (status === 'delivered') return t('dash.statusDelivered');
  if (status === 'waiting_from_you') return t('dash.statusWaitingFromYou');
  if (status === 'paid') return t('dash.statusPaid');
  if (status === 'pending_payment') {
    return opts?.awaitingRecipient ? t('dash.statusAwaitingRecipient') : t('dash.statusPending');
  }
  if (status === 'cancelled') return t('dash.statusCancelled');
  return status;
}

function statusClass(status: string) {
  if (status === 'submitted') return 'transit';
  if (status === 'delivered') return 'delivered';
  if (status === 'waiting_from_you') return 'waiting';
  if (status === 'paid') return 'paid';
  if (status === 'pending_payment') return 'pending';
  if (status === 'cancelled') return 'cancelled';
  return 'default';
}

export function ShipmentDetailModal({
  order,
  onClose,
  onPay,
  onCancel,
  onTrack,
  paying = false,
  cancelling = false,
  canPayOverride,
}: Props) {
  const { t, locale, intlLocale } = useI18n();
  const canPay = canPayOverride ?? (order.status === 'pending_payment');
  const canCancel = order.status === 'pending_payment';
  const canTrack = ['submitted', 'waiting_from_you', 'delivered'].includes(order.status) || Boolean(order.npTtn);
  const awaitingRecipient = order.status === 'pending_payment' && !canPay;

  return (
    <div className="ship-detail-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="ship-detail card" onClick={(e) => e.stopPropagation()}>
        <header className="ship-detail__head">
          <div>
            <p className="ship-detail__eyebrow">{t('dash.detailEyebrow')}</p>
            <h2>{order.orderNumber}</h2>
            <span className={`client-dash__badge client-dash__badge--${statusClass(order.status)}`}>
              {statusLabel(order.status, t, { awaitingRecipient })}
            </span>
          </div>
          <button type="button" className="ship-detail__close" onClick={onClose} aria-label={t('dash.close')}>×</button>
        </header>

        {canTrack && (
          <TrackingMap
            fromCountry={order.fromCountry}
            toCountry={order.toCountry}
            fromLine={order.senderLine}
            toLine={order.receiverLine}
            active={order.status === 'submitted' || order.status === 'delivered'}
          />
        )}

        <div className="ship-detail__grid">
          <section>
            <h3>{t('dash.route')}</h3>
            <dl>
              <div><dt>{t('dash.from')}</dt><dd>{countryLabel(order.fromCountry || 'HU', locale)}</dd></div>
              <div><dt>{t('dash.pickupAddress')}</dt><dd>{order.senderLine || '—'}</dd></div>
              <div><dt>{t('dash.to')}</dt><dd>{countryLabel(order.toCountry || '', locale)}</dd></div>
              <div><dt>{t('dash.deliveryAddress')}</dt><dd>{order.receiverLine || '—'}</dd></div>
              <div><dt>{t('dash.pickupDate')}</dt><dd>{order.pickupDate || '—'}{order.pickupTime ? `, ${order.pickupTime}` : ''}</dd></div>
            </dl>
          </section>

          <section>
            <h3>{t('dash.parcel')}</h3>
            <dl>
              <div><dt>{t('dash.size')}</dt><dd>{order.parcelSize || '—'}</dd></div>
              {order.weightKg != null && (
                <div><dt>{t('dash.weight')}</dt><dd>{t('dash.weightKg', { kg: order.weightKg })}</dd></div>
              )}
              <div><dt>{t('dash.fragile')}</dt><dd>{order.fragile ? t('dash.yes') : t('dash.no')}</dd></div>
              <div><dt>{t('dash.insurance')}</dt><dd>{order.insurance ? t('dash.yes') : t('dash.no')}</dd></div>
              <div><dt>{t('dash.amount')}</dt><dd><b>{formatMoney(order.amount, order.currency)}</b></dd></div>
            </dl>
          </section>

          <section>
            <h3>{t('dash.contacts')}</h3>
            <dl>
              <div><dt>{t('dash.sender')}</dt><dd>{order.senderName || '—'}</dd></div>
              {order.senderPhone && <div><dt>{t('dash.phone')}</dt><dd>{order.senderPhone}</dd></div>}
              <div><dt>{t('dash.recipient')}</dt><dd>{order.receiverName || '—'}</dd></div>
              {order.receiverPhone && <div><dt>{t('dash.phone')}</dt><dd>{order.receiverPhone}</dd></div>}
              {order.customerEmail && <div><dt>Email</dt><dd>{order.customerEmail}</dd></div>}
            </dl>
          </section>

          <section>
            <h3>{t('dash.status')}</h3>
            <dl>
              <div><dt>{t('dash.created')}</dt><dd>{formatDate(order.createdAt, intlLocale)}</dd></div>
              {order.paidAt && <div><dt>{t('dash.paidAt')}</dt><dd>{formatDate(order.paidAt, intlLocale)}</dd></div>}
              {order.cancelledAt && <div><dt>{t('dash.cancelledAt')}</dt><dd>{formatDate(order.cancelledAt, intlLocale)}</dd></div>}
              {order.npTtn && <div><dt>{t('dash.ttnLabel')}</dt><dd><b>{order.npTtn}</b></dd></div>}
            </dl>
          </section>
        </div>

        <div className="ship-detail__actions">
          {canPay && onPay && (
            <button className="btn btn-lime" type="button" disabled={paying || cancelling} onClick={() => onPay(order)}>
              {paying ? t('dash.redirecting') : t('dash.pay')}
            </button>
          )}
          {canCancel && onCancel && (
            <button className="btn btn-outline ship-detail__cancel" type="button" disabled={paying || cancelling} onClick={() => onCancel(order)}>
              {cancelling ? t('dash.cancelling') : t('dash.cancelOrder')}
            </button>
          )}
          {canTrack && onTrack && (
            <button className="btn btn-outline" type="button" onClick={() => onTrack(order)}>{t('dash.track')}</button>
          )}
          {order.status !== 'cancelled' && (
            <button className="btn btn-outline" type="button" onClick={() => openWaybillPdf(order.publicToken)}>
              {t('orderSuccess.downloadPdf')}
            </button>
          )}
          <button className="btn btn-outline" type="button" onClick={onClose}>{t('dash.close')}</button>
        </div>
      </div>
    </div>
  );
}
