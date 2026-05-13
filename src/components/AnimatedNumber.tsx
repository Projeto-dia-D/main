import { useAnimatedNumber } from '../hooks/useAnimatedNumber';

interface Props {
  value: number;
  decimals?: number;
  suffix?: string;
  className?: string;
}

export function AnimatedNumber({ value, decimals = 0, suffix = '', className = '' }: Props) {
  const v = useAnimatedNumber(value);
  return (
    <span className={className}>
      {v.toFixed(decimals)}
      {suffix}
    </span>
  );
}
