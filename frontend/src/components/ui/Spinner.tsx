import { cn } from '@/lib/utils';

interface Props {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_MAP = {
  sm: 'w-4 h-4 border-[1.5px]',
  md: 'w-6 h-6 border-2',
  lg: 'w-8 h-8 border-2',
};

export function Spinner({ size = 'md', className }: Props) {
  return (
    <div
      className={cn(
        'border-indigo-500 border-t-transparent rounded-full animate-spin',
        SIZE_MAP[size],
        className
      )}
      role="status"
      aria-label="Loading"
    />
  );
}
