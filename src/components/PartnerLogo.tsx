import type { ReactElement } from 'react';

type PartnerId =
  | 'novapost'
  | 'dpd'
  | 'gls'
  | 'foxpost'
  | 'fedex'
  | 'inpost'
  | 'packeta';

type Props = {
  id: PartnerId;
  className?: string;
};

function LogoNovaPost() {
  return (
    <svg viewBox="0 0 156 32" fill="none" aria-hidden>
      <g fill="#E30613">
        <path d="M1 1h11v4H6v5H1V1Zm13 0h11v11h-5V6h-6V1ZM1 13h5v5h5v5H1v-10Zm13 5h6v5h-5v-5h-1v-5h0Z" />
      </g>
      <path fill="#fff" d="M6.5 6.5h3v3h-3v-3Z" />
      <text x="30" y="21" fill="#E30613" fontFamily="Arial, Helvetica, sans-serif" fontSize="14" fontWeight="700" letterSpacing="0.01em">Nova Post</text>
    </svg>
  );
}

function LogoDpd() {
  return (
    <svg viewBox="0 0 88 32" fill="none" aria-hidden>
      <path fill="#DC0032" d="M16 3 27 9v14L16 29 5 23V9L16 3Z" />
      <path fill="#fff" stroke="#DC0032" strokeWidth="0.6" d="M16 10 21 13v6l-5 3-5-3v-6l5-3Z" />
      <text x="34" y="22" fill="#414141" fontFamily="Arial, Helvetica, sans-serif" fontSize="18" fontWeight="700">dpd</text>
    </svg>
  );
}

function LogoGls() {
  return (
    <svg viewBox="0 0 74 32" fill="none" aria-hidden>
      <text x="0" y="24" fill="#061AB1" fontFamily="Arial Black, Arial, sans-serif" fontSize="26" fontWeight="900">GLS</text>
      <rect x="58" y="15" width="9" height="9" fill="#FFD100" />
    </svg>
  );
}

function LogoFoxpost() {
  return (
    <svg viewBox="0 0 138 32" fill="none" aria-hidden>
      <rect x="0" y="3" width="26" height="26" rx="2" fill="#C0392B" />
      <path fill="#fff" d="M8 10 10.5 7.5 13 10 10.5 12.5 8 10Z" />
      <path fill="#fff" d="M13.5 12c0 2.5 2 5 4.5 5 1.2 0 2.2-.5 3-1.2-1.3.9-2.8 1.4-4.4 1.4-3.7 0-6.6-2.5-6.6-5.2Z" />
      <circle cx="15.5" cy="15" r="1.1" fill="#111" />
      <circle cx="18.5" cy="15" r="1.1" fill="#111" />
      <path fill="#111" d="M16.5 17.8 17 18.8h1.8l.6-1c-.9.5-1.9.7-2.9.7-.3 0-.7-.1-1-.2Z" />
      <text x="34" y="22" fill="#C0392B" fontFamily="Arial Black, Arial, sans-serif" fontSize="15" fontWeight="800" letterSpacing="0.04em">FOXPOST</text>
    </svg>
  );
}

function LogoFedex() {
  return (
    <svg viewBox="0 0 86 32" fill="none" aria-hidden>
      <text x="0" y="23" fill="#4D148C" fontFamily="Arial Black, Arial, sans-serif" fontSize="22" fontWeight="900">Fed</text>
      <text x="44" y="23" fill="#FF6600" fontFamily="Arial Black, Arial, sans-serif" fontSize="22" fontWeight="900">Ex</text>
    </svg>
  );
}

function LogoInpost() {
  return (
    <svg viewBox="0 0 104 32" fill="none" aria-hidden>
      <path fill="#FFCD00" d="M15 16a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z" />
      <path fill="#FFCD00" d="M1.5 11 0 7 3.8 8.8 1.5 11Zm2.8 5.2L3 20.5 6.8 18.7 4.3 16.2Zm5.6 3.5L7.5 24.5 11.3 22.7 8.8 20.2Z" />
      <text x="30" y="22" fill="#111" fontFamily="Arial, Helvetica, sans-serif" fontSize="18" fontWeight="700">InPost</text>
    </svg>
  );
}

function LogoPacketa() {
  return (
    <svg viewBox="0 0 112 32" fill="none" aria-hidden>
      <circle cx="12" cy="16" r="7" fill="#D71440" />
      <text x="28" y="22" fill="#D71440" fontFamily="Arial, Helvetica, sans-serif" fontSize="18" fontWeight="700">Packeta</text>
    </svg>
  );
}

const LOGOS: Record<PartnerId, () => ReactElement> = {
  novapost: LogoNovaPost,
  dpd: LogoDpd,
  gls: LogoGls,
  foxpost: LogoFoxpost,
  fedex: LogoFedex,
  inpost: LogoInpost,
  packeta: LogoPacketa,
};

const LABELS: Record<PartnerId, string> = {
  novapost: 'Nova Post',
  dpd: 'DPD',
  gls: 'GLS',
  foxpost: 'FOXPOST',
  fedex: 'FedEx',
  inpost: 'InPost',
  packeta: 'Packeta',
};

export function PartnerLogo({ id, className = '' }: Props) {
  const Logo = LOGOS[id];
  return (
    <span className={`partner-logo partner-logo--${id} ${className}`.trim()} aria-label={LABELS[id]}>
      <Logo />
    </span>
  );
}

export type { PartnerId };

export const PARTNER_IDS: PartnerId[] = [
  'novapost',
  'dpd',
  'gls',
  'foxpost',
  'fedex',
  'inpost',
  'packeta',
];
