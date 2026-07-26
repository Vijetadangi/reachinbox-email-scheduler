'use client';

import { useEffect, useState } from 'react';
import { Clock, Zap, CheckCircle, AlertCircle, Hourglass } from 'lucide-react';
import { getQueueStats } from '@/lib/api';
import { QueueStats } from '@/types';

export function QueueStatsBar() {
  const [stats, setStats] = useState<QueueStats | null>(null);

  useEffect(() => {
    const load = () => {
      getQueueStats()
        .then(setStats)
        .catch(() => {}); // Fail silently — stats are supplementary
    };

    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  if (!stats) return null;

  const items = [
    { label: 'Delayed', value: stats.delayed, icon: Hourglass, color: 'text-blue-400' },
    { label: 'Active', value: stats.active, icon: Zap, color: 'text-yellow-400' },
    { label: 'Waiting', value: stats.waiting, icon: Clock, color: 'text-indigo-400' },
    { label: 'Completed', value: stats.completed, icon: CheckCircle, color: 'text-green-400' },
    { label: 'Failed', value: stats.failed, icon: AlertCircle, color: 'text-red-400' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {items.map(({ label, value, icon: Icon, color }) => (
        <div key={label} className="card px-4 py-3 flex items-center gap-3">
          <Icon className={`w-4 h-4 ${color} flex-shrink-0`} />
          <div>
            <p className="text-white font-semibold text-lg leading-none">{value}</p>
            <p className="text-white/40 text-xs mt-0.5">{label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
