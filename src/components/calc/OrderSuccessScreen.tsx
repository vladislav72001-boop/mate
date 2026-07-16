import { useState, type ReactNode } from 'react';
import type { ShippingOrder } from '../../api/client-types';
import { useI18n } from '../../i18n/context';
import { CountryFlag } from './CountryFlag';
import {
  carrierLabel,
  deliveryServiceLabel,
  estimateDeliveryWindow,
  formatOrderMoney,
  orderStatusHeadline,
  parseAddressLine,
  routeCityLine,
  trackingNumber,
} from './orderSuccessHelpers';

type Props = {
  order: ShippingOrder;
  onTrack: () => void;
  onCreateAnother: () => void;
  onOpenDashboard?: () => void;
};

function SuccessMapArt() {
  return (
    <div className="order-success__map" aria-hidden>
      <svg viewBox="0 0 600 220" fill="none">
        <defs>
          <pattern id="order-success-dots" x="0" y="0" width="12" height="12" patternUnits="userSpaceOnUse">
            <circle cx="6" cy="6" r="1.4" fill="#122023" fillOpacity="0.14" />
          </pattern>
        </defs>
        <rect width="600" height="220" fill="url(#order-success-dots)" rx="18" />
        {([[118, 58], [248, 34], [392, 48], [468, 118], [356, 168], [168, 154], [52, 108]] as [number, number][]).map(([x, y], i) => (
          <line key={`l${i}`} x1="228" y1="98" x2={x} y2={y} stroke="#E1FF01" strokeWidth="1.2" strokeOpacity="0.55" />
        ))}
        {([[118, 58], [248, 34], [392, 48], [468, 118], [356, 168], [168, 154], [52, 108]] as [number, number][]).map(([x, y], i) => (
          <circle key={`c${i}`} cx={x} cy={y} r="3.6" fill="#E1FF01" fillOpacity="0.88" />
        ))}
        <circle cx="228" cy="98" r="6" fill="#E1FF01" />
        <circle cx="228" cy="98" r="12" stroke="#E1FF01" strokeWidth="1.2" strokeOpacity="0.28" />
        <circle cx="228" cy="98" r="20" stroke="#E1FF01" strokeWidth="0.8" strokeOpacity="0.14" />
      </svg>
    </div>
  );
}

function DetailCell({
  icon,
  label,
  title,
  hint,
  flag,
}: {
  icon?: React.ReactNode;
  label: string;
  title: ReactNode;
  hint?: ReactNode;
  flag?: string;
}) {
  return (
    <div className="order-success__cell">
      <div className="order-success__cell-top">
        {flag ? <CountryFlag code={flag} size={18} /> : <span className="order-success__cell-icon">{icon}</span>}
        <span className="order-success__cell-label">{label}</span>
      </div>
      <strong className="order-success__cell-title">{title}</strong>
      {hint && <p className="order-success__cell-hint">{hint}</p>}
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function OrderSuccessScreen({ order, onTrack, onCreateAnother, onOpenDashboard }: Props) {
  const { locale } = useI18n();
  const [copied, setCopied] = useState(false);
  const trackNo = trackingNumber(order);
  const status = orderStatusHeadline(order);
  const carrier = carrierLabel(order);
  const service = deliveryServiceLabel(order.deliveryMode);
  const delivery = estimateDeliveryWindow(order);
  const fromCity = routeCityLine(order.fromCountry, order.senderLine, locale);
  const toCity = routeCityLine(order.toCountry, order.receiverLine, locale);
  const fromAddress = parseAddressLine(order.senderLine);
  const toAddress = parseAddressLine(order.receiverLine);

  const copyTrack = async () => {
    try {
      await navigator.clipboard.writeText(trackNo);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="order-success-overlay" role="dialog" aria-modal="true" aria-labelledby="order-success-title">
      <div className="order-success">
        <div className="order-success__hero">
          <div className="order-success__badge" aria-hidden>
            <span>✓</span>
          </div>
          <SuccessMapArt />
        </div>

        <header className="order-success__head">
          <h1 id="order-success-title">
            Посылка <span className="order-success__accent">успешно</span> оформлена!
          </h1>
          <p>
            Спасибо! Ваша посылка принята. Мы уже передали заказ перевозчику и начинаем обработку.
          </p>
        </header>

        <div className="order-success__track card-lite">
          <div className="order-success__track-row">
            <div>
              <span className="order-success__meta-label">Трек-номер</span>
              <strong className="order-success__track-no">{trackNo}</strong>
            </div>
            <button type="button" className="order-success__copy" onClick={copyTrack}>
              <CopyIcon />
              {copied ? 'Скопировано' : 'Скопировать'}
            </button>
          </div>
        </div>

        <div className="order-success__status card-lite">
          <div className="order-success__status-row">
            <div>
              <span className="order-success__meta-label">Статус</span>
              <p className="order-success__status-label">
                <span className="order-success__status-dot" aria-hidden />
                {status.label}
              </p>
            </div>
            <span className="order-success__status-clock" aria-hidden>◷</span>
          </div>
          <p className="order-success__status-hint">{status.hint}</p>
        </div>

        <div className="order-success__grid">
          <DetailCell
            flag={order.fromCountry || 'HU'}
            label="Откуда"
            title={fromCity}
            hint={fromAddress.streetLine}
          />
          <DetailCell
            flag={order.toCountry}
            label="Куда"
            title={toCity}
            hint={toAddress.streetLine}
          />
          <DetailCell
            icon="🚚"
            label="Перевозчик"
            title={carrier.name}
            hint={carrier.hint}
          />
          <DetailCell
            icon="◆"
            label="Стоимость"
            title={formatOrderMoney(order)}
            hint={<><span className="order-success__paid">Оплачено картой</span> ✓</>}
          />
          <DetailCell
            icon="📅"
            label="Ориентировочная доставка"
            title={delivery.range}
            hint={delivery.hint}
          />
          <DetailCell
            icon="⚡"
            label="Услуга"
            title={service.title}
            hint={service.hint}
          />
        </div>

        <div className="order-success__actions">
          <button type="button" className="btn btn-lime order-success__track-btn" onClick={onTrack}>
            <span aria-hidden>📍</span>
            Отследить посылку
          </button>
          <div className="order-success__secondary">
            <button type="button" className="btn btn-outline order-success__secondary-btn" onClick={onCreateAnother}>
              <span aria-hidden>＋</span>
              Создать ещё одну отправку
            </button>
            <button
              type="button"
              className="btn btn-outline order-success__secondary-btn"
              onClick={onOpenDashboard}
              disabled={!onOpenDashboard}
            >
              <span aria-hidden>⎙</span>
              Скачать накладную PDF
            </button>
          </div>
        </div>

        <aside className="order-success__thanks card-lite">
          <span className="order-success__thanks-icon" aria-hidden>♥</span>
          <p>
            Спасибо, что выбрали Mate. Мы автоматически подбираем лучшего перевозчика по цене,
            скорости и качеству доставки, чтобы вам не приходилось сравнивать десятки служб самостоятельно.
          </p>
        </aside>
      </div>
    </div>
  );
}
