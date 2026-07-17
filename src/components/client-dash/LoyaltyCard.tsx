import type { ClientLoyalty } from '../../api/shipping';
import { useI18n } from '../../i18n/context';

type Props = {
  loyalty: ClientLoyalty | null;
  loading?: boolean;
};

const TIER_KEYS: Record<string, string> = {
  start: 'dash.tierStart',
  active: 'dash.tierActive',
  pro: 'dash.tierPro',
  maximum: 'dash.tierMaximum',
  individual: 'dash.tierIndividual',
};

export function loyaltyTierLabel(
  id: string,
  fallback: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
) {
  const key = TIER_KEYS[id];
  if (!key) return fallback;
  const translated = t(key);
  return translated === key ? fallback : translated;
}

function localizeTier(
  tier: { id: string; label: string },
  t: (key: string, vars?: Record<string, string | number>) => string,
) {
  return loyaltyTierLabel(tier.id, tier.label, t);
}

function formatPeriodLabel(startIso: string, locale: string) {
  const d = new Date(startIso);
  if (!Number.isFinite(d.getTime())) return '';
  const loc =
    locale === 'hu' ? 'hu-HU'
    : locale === 'uk' ? 'uk-UA'
    : locale === 'en' ? 'en-GB'
    : 'ru-RU';
  return d.toLocaleDateString(loc, { month: 'long', year: 'numeric' });
}

export function LoyaltyCard({ loyalty, loading }: Props) {
  const { t, locale } = useI18n();

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

  const tierName = localizeTier(tier, t);
  const nextName = nextTier ? localizeTier(nextTier, t) : '';
  const periodLabel = formatPeriodLabel(period.start, locale) || period.label;

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
            {t('dash.loyaltyLevel', { label: tierName })}
          </h2>
        </div>
        <span className={`client-dash__loyalty-badge client-dash__loyalty-badge--${tier.id}`}>
          {tierName}
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
            <span>{t('dash.toNextRemaining', { label: nextName })}</span>
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
            aria-label={t('dash.progressAria', { label: nextName })}
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
        {t('dash.loyaltyNote', { period: periodLabel })}
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
