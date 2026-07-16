import type { ShippingOrder } from '../../api/shipping';
import { countryLabel } from '../../constants/shipping';
import { TrackingMap } from './TrackingMap';

type Props = {
  order: ShippingOrder;
  onClose: () => void;
  onPay?: (order: ShippingOrder) => void;
  onCancel?: (order: ShippingOrder) => void;
  onTrack?: (order: ShippingOrder) => void;
  paying?: boolean;
  cancelling?: boolean;
};

function formatDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', {
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

function statusLabel(status: string) {
  switch (status) {
    case 'submitted': return 'В пути';
    case 'paid': return 'Оплачено';
    case 'pending_payment': return 'Ожидает оплаты';
    case 'cancelled': return 'Отменён';
    default: return status;
  }
}

function statusClass(status: string) {
  if (status === 'submitted') return 'transit';
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
}: Props) {
  const canPay = order.status === 'pending_payment';
  const canCancel = order.status === 'pending_payment';
  const canTrack = order.status === 'submitted' || Boolean(order.npTtn);

  return (
    <div className="ship-detail-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="ship-detail card" onClick={(e) => e.stopPropagation()}>
        <header className="ship-detail__head">
          <div>
            <p className="ship-detail__eyebrow">Детали отправления</p>
            <h2>{order.orderNumber}</h2>
            <span className={`client-dash__badge client-dash__badge--${statusClass(order.status)}`}>
              {statusLabel(order.status)}
            </span>
          </div>
          <button type="button" className="ship-detail__close" onClick={onClose} aria-label="Закрыть">×</button>
        </header>

        {canTrack && (
          <TrackingMap
            fromCountry={order.fromCountry}
            toCountry={order.toCountry}
            fromLine={order.senderLine}
            toLine={order.receiverLine}
            active={order.status === 'submitted'}
          />
        )}

        <div className="ship-detail__grid">
          <section>
            <h3>Маршрут</h3>
            <dl>
              <div><dt>Откуда</dt><dd>{countryLabel(order.fromCountry || 'HU')}</dd></div>
              <div><dt>Адрес забора</dt><dd>{order.senderLine || '—'}</dd></div>
              <div><dt>Куда</dt><dd>{countryLabel(order.toCountry || '')}</dd></div>
              <div><dt>Адрес доставки</dt><dd>{order.receiverLine || '—'}</dd></div>
              <div><dt>Дата забора</dt><dd>{order.pickupDate || '—'}{order.pickupTime ? `, ${order.pickupTime}` : ''}</dd></div>
            </dl>
          </section>

          <section>
            <h3>Посылка</h3>
            <dl>
              <div><dt>Размер</dt><dd>{order.parcelSize || '—'}</dd></div>
              {order.weightKg != null && <div><dt>Вес</dt><dd>{order.weightKg} кг</dd></div>}
              <div><dt>Хрупкое</dt><dd>{order.fragile ? 'Да' : 'Нет'}</dd></div>
              <div><dt>Страховка</dt><dd>{order.insurance ? 'Да' : 'Нет'}</dd></div>
              <div><dt>Сумма</dt><dd><b>{formatMoney(order.amount, order.currency)}</b></dd></div>
            </dl>
          </section>

          <section>
            <h3>Контакты</h3>
            <dl>
              <div><dt>Отправитель</dt><dd>{order.senderName || '—'}</dd></div>
              {order.senderPhone && <div><dt>Телефон</dt><dd>{order.senderPhone}</dd></div>}
              <div><dt>Получатель</dt><dd>{order.receiverName || '—'}</dd></div>
              {order.receiverPhone && <div><dt>Телефон</dt><dd>{order.receiverPhone}</dd></div>}
              {order.customerEmail && <div><dt>Email</dt><dd>{order.customerEmail}</dd></div>}
            </dl>
          </section>

          <section>
            <h3>Статус</h3>
            <dl>
              <div><dt>Создан</dt><dd>{formatDate(order.createdAt)}</dd></div>
              {order.paidAt && <div><dt>Оплачен</dt><dd>{formatDate(order.paidAt)}</dd></div>}
              {order.cancelledAt && <div><dt>Отменён</dt><dd>{formatDate(order.cancelledAt)}</dd></div>}
              {order.npTtn && <div><dt>ТТН</dt><dd><b>{order.npTtn}</b></dd></div>}
            </dl>
          </section>
        </div>

        <div className="ship-detail__actions">
          {canPay && onPay && (
            <button className="btn btn-lime" type="button" disabled={paying || cancelling} onClick={() => onPay(order)}>
              {paying ? 'Переход…' : 'Оплатить'}
            </button>
          )}
          {canCancel && onCancel && (
            <button className="btn btn-outline ship-detail__cancel" type="button" disabled={paying || cancelling} onClick={() => onCancel(order)}>
              {cancelling ? 'Отменяем…' : 'Отменить заказ'}
            </button>
          )}
          {canTrack && onTrack && (
            <button className="btn btn-outline" type="button" onClick={() => onTrack(order)}>Отследить</button>
          )}
          <button className="btn btn-outline" type="button" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}
