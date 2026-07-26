'use client';

import { useState, useCallback, useEffect } from 'react';
import { Plus, Clock, CheckCircle, BarChart3, Mail } from 'lucide-react';
import { ScheduledEmailsTable } from '@/components/emails/ScheduledEmailsTable';
import { SentEmailsTable } from '@/components/emails/SentEmailsTable';
import { ComposeModal } from '@/components/emails/ComposeModal';
import { QueueStatsBar } from '@/components/emails/QueueStatsBar';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';

type Tab = 'scheduled' | 'sent';

export default function DashboardPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('scheduled');
  const [composeOpen, setComposeOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleEmailScheduled = useCallback(() => {
    setComposeOpen(false);
    setRefreshKey((k) => k + 1);
    setActiveTab('scheduled');
  }, []);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
          </h1>
          <p className="text-white/40 text-sm mt-1">
            Manage your scheduled and sent email campaigns
          </p>
        </div>

        <button
          onClick={() => setComposeOpen(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Compose Email
        </button>
      </div>

      {/* Queue stats bar */}
      <QueueStatsBar />

      {/* Tabs */}
      <div className="card overflow-hidden">
        <div className="flex border-b border-white/10">
          <TabButton
            active={activeTab === 'scheduled'}
            onClick={() => setActiveTab('scheduled')}
            icon={<Clock className="w-4 h-4" />}
            label="Scheduled"
          />
          <TabButton
            active={activeTab === 'sent'}
            onClick={() => setActiveTab('sent')}
            icon={<CheckCircle className="w-4 h-4" />}
            label="Sent"
          />
        </div>

        <div className="p-0">
          {activeTab === 'scheduled' && (
            <ScheduledEmailsTable key={`scheduled-${refreshKey}`} />
          )}
          {activeTab === 'sent' && (
            <SentEmailsTable key={`sent-${refreshKey}`} />
          )}
        </div>
      </div>

      {/* Compose modal */}
      <ComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onSuccess={handleEmailScheduled}
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-6 py-4 text-sm font-medium border-b-2 transition-colors duration-200',
        active
          ? 'border-indigo-500 text-white'
          : 'border-transparent text-white/40 hover:text-white/70'
      )}
    >
      {icon}
      {label}
    </button>
  );
}
