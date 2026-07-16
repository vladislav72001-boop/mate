import mateLogoUrl from '../assets/mate-logo.png';

type Props = {
  className?: string;
  height?: number;
};

export function MateLogo({ className = '', height = 44 }: Props) {
  return (
    <span className={`mate-logo ${className}`} aria-label="MATE">
      <img
        src={mateLogoUrl}
        alt=""
        width={height}
        height={height}
        decoding="async"
        draggable={false}
      />
    </span>
  );
}
