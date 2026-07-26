'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, X, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

// Simple global event bus for toasts
const listeners: Array<(toast: Toast) => void> = [];

export function showToast(message: string, type: ToastType = 'info'): void {
  const toast: Toast = {
    id: Date.now().toString(),
    type,
    message,
  };
  listeners.forEach((l) => l(toast));
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const handler = (toast: Toast) => {
      setToasts((prev) => [...prev, toast]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, 4500);
    };
    listeners.push(handler);
    return () => {
      const idx = listeners.indexOf(handler);
      if (idx > -1) listeners.splice(idx, 1);
    };
  }, []);

  const dismiss = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const config = {
    success: {
      icon: CheckCircle,
      className: 'bg-green-500/10 border-green-500/20 text-green-400',
    },
    error: {
      icon: AlertCircle,
      className: 'bg-red-500/10 border-red-500/20 text-red-400',
    },
    info: {
      icon: Info,
      className: 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400',
    },
  };

  const { icon: Icon, className } = config[toast.type];

  return (
    <div
      className={cn(
        'pointer-events-auto flex items-start gap-3 p-4 rounded-xl border shadow-2xl min-w-[280px] max-w-sm',
        'animate-in slide-in-from-right-5 duration-300',
        className
      )}
    >
      <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
      <p className="text-sm font-medium flex-1 text-white">{toast.message}</p>
      <button
        onClick={onDismiss}
        className="text-white/40 hover:text-white/70 flex-shrink-0 transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
