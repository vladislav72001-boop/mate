import type { ClientLoyalty } from '../../api/shipping';
import { useI18n } from '../../i18n/context';

type Props = {
  loyalty: ClientLoyalty | null;
  loading?: boolean;
};

export function LoyaltyCard({ loyalty, loading }: Props) {
  const { t } = useI18n();

  if (loading && !loyalty) {
    return (
      <section className="client-dash__loyalty card" aria-busy="true">
        <p className="client-dash__loyalty-loading">{t('dash.loyaltyLoading')}</p>
      </section>
    );
  }

  if (!loyalty) return null;

  const {
    tier,
    nextTier,
    monthlyShipments,
    remainingToNext,
    progressPercent,
    period,
    welcomeDiscount,
  } = loyalty;

  const discount =
    tier.discountPercent == null
      ? t('dash.priceCustom')
      : tier.discountPercent > 0
        ? t('dash.priceDiscount', { percent: tier.discountPercent })
        : t('dash.priceBase');

  return (
    <section className="client-dash__loyalty card">
      <div className="client-dash__loyalty-top">
        <div>
          <span className="client-dash__loyalty-eyebrow">{t('dash.loyaltyEyebrow')}</span>
          <h2 className="client-dash__loyalty-level">
            {t('dash.loyaltyLevel', { label: tier.label })}
          </h2>
        </div>
        <span className={`client-dash__loyalty-badge client-dash__loyalty-badge--${tier.id}`}>
          {tier.label}
        </span>
      </div>

      <ul className="client-dash__loyalty-stats">
        {welcomeDiscount?.available && (
          <li className="client-dash__loyalty-welcome">
            <span>{t('dash.welcomeDiscountLabel')}</span>
            <b>{t('dash.welcomeDiscountTitle', { percent: welcomeDiscount.percent })}</b>
          </li>
        )}
        <li>
          <span>{t('dash.sentThisMonth')}</span>
          <b>{monthlyShipments} {pluralShipments(monthlyShipments, t)}</b>
        </li>
        {nextTier && remainingToNext != null ? (
          <li>
            <span>{t('dash.toNextRemaining', { label: nextTier.label })}</span>
            <b>{remainingToNext}</b>
          </li>
        ) : (
          <li>
            <span>{t('dash.status')}</span>
            <b>{t('dash.maxLevel')}</b>
          </li>
        )}
        <li>
          <span>{t('dash.yourPrice')}</span>
          <b>{discount}</b>
        </li>
      </ul>

      {nextTier && (
        <div className="client-dash__loyalty-bar-wrap">
          <div
            className="client-dash__loyalty-bar"
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('dash.progressAria', { label: nextTier.label })}
          >
            <i style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="client-dash__loyalty-bar-meta">
            <span>{progressPercent}%</span>
            <span>
              {monthlyShipments} / {nextTier.minShipments}
            </span>
          </div>
        </div>
      )}

      <p className="client-dash__loyalty-note">
        {t('dash.loyaltyNote', { period: period.label })}
      </p>
    </section>
  );
}

function pluralShipments(n: number, t: (key: string) => string) {
  if (n === 1) return t('dash.shipment1');
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return t('dash.shipment2');
  return t('dash.shipment5');
}
