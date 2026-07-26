import { EmailJobStatus } from '@/types';
import { cn } from '@/lib/utils';
import { Clock, CheckCircle, AlertCircle, Loader2, XCircle } from 'lucide-react';

const STATUS_CONFIG: Record<
  EmailJobStatus,
  { label: string; className: string; icon: React.ComponentType<{ className?: string }> }
> = {
  scheduled: {
    label: 'Scheduled',
    className: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
    icon: Clock,
  },
  processing: {
    label: 'Sending',
    className: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
    icon: Loader2,
  },
  sent: {
    label: 'Sent',
    className: 'bg-green-500/10 text-green-400 border border-green-500/20',
    icon: CheckCircle,
  },
  failed: {
    label: 'Failed',
    className: 'bg-red-500/10 text-red-400 border border-red-500/20',
    icon: AlertCircle,
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-gray-500/10 text-gray-400 border border-gray-500/20',
    icon: XCircle,
  },
};

interface Props {
  status: EmailJobStatus;
  className?: string;
}

export function StatusBadge({ status, className }: Props) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.scheduled;
  const Icon = cfg.icon;

  return (
    <span className={cn('status-badge', cfg.className, className)}>
      <Icon className={cn('w-3 h-3', status === 'processing' && 'animate-spin')} />
      {cfg.label}
    </span>
  );
}
