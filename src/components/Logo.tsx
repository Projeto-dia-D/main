interface Props {
  size?: number;
  className?: string;
}

export function Logo({ size = 32, className = '' }: Props) {
  return (
    <img
      src="/logo.png"
      alt="Dia D Burst"
      width={size}
      height={size}
      className={`object-contain drop-shadow-[0_0_12px_rgba(255,107,0,0.5)] ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
