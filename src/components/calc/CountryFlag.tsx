type Props = {
  code: string;
  size?: number;
  className?: string;
};

export function CountryFlag({ code, size = 20, className }: Props) {
  const cc = String(code || '').trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(cc)) return null;

  const height = Math.max(12, Math.round(size * 0.72));

  return (
    <img
      src={`https://flagcdn.com/w40/${cc}.png`}
      srcSet={`https://flagcdn.com/w80/${cc}.png 2x`}
      width={size}
      height={height}
      alt=""
      className={className ? `country-flag ${className}` : 'country-flag'}
      loading="lazy"
      decoding="async"
    />
  );
}
