'use client';

import { useEffect, useState, useCallback } from 'react';
import { Clock, Trash2, ExternalLink, RefreshCw } from 'lucide-react';
import { fetchScheduledEmails, cancelEmail } from '@/lib/api';
import { EmailJob, PaginationMeta } from '@/types';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { showToast } from '@/components/ui/Toaster';
import { formatDate, formatRelative, truncate } from '@/lib/utils';

export function ScheduledEmailsTable() {
  const [jobs, setJobs] = useState<EmailJob[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchScheduledEmails(page, 20);
      setJobs(data.jobs);
      setPagination(data.pagination);
    } catch {
      showToast('Failed to load scheduled emails', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
    // Poll every 15 seconds to catch status changes
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  const handleCancel = async (job: EmailJob) => {
    if (!confirm(`Cancel scheduled email to ${job.recipient_email}?`)) return;

    setCancellingId(job.id);
    try {
      await cancelEmail(job.id);
      showToast('Email cancelled', 'success');
      await load();
    } catch {
      showToast('Failed to cancel email', 'error');
    } finally {
      setCancellingId(null);
    }
  };

  if (isLoading && jobs.length === 0) {
    return (
      <div className="flex justify-center items-center py-16">
        <Spinner />
      </div>
    );
  }

  if (!isLoading && jobs.length === 0) {
    return (
      <EmptyState
        icon={Clock}
        title="No scheduled emails"
        description="Emails you schedule will appear here. Hit 'Compose Email' to get started."
      />
    );
  }

  return (
    <div>
      {/* Table header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/5">
        <p className="text-white/50 text-sm">
          {pagination?.total ?? jobs.length} email{pagination?.total !== 1 ? 's' : ''} scheduled
        </p>
        <button
          onClick={load}
          className="text-white/30 hover:text-white/60 transition-colors p-1 rounded"
          aria-label="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5">
              <th className="text-left px-6 py-3 text-white/40 font-medium">Recipient</th>
              <th className="text-left px-6 py-3 text-white/40 font-medium">Subject</th>
              <th className="text-left px-6 py-3 text-white/40 font-medium">Scheduled for</th>
              <th className="text-left px-6 py-3 text-white/40 font-medium">Status</th>
              <th className="text-right px-6 py-3 text-white/40 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr
                key={job.id}
                className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
              >
                <td className="px-6 py-4 text-white/80 font-medium">
                  {job.recipient_email}
                </td>
                <td className="px-6 py-4 text-white/60">
                  {truncate(job.subject, 50)}
                </td>
                <td className="px-6 py-4 text-white/60">
                  <span title={formatDate(job.scheduled_at)}>
                    {formatRelative(job.scheduled_at)}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <StatusBadge status={job.status} />
                </td>
                <td className="px-6 py-4 text-right">
                  {job.status === 'scheduled' && (
                    <button
                      onClick={() => handleCancel(job)}
                      disabled={cancellingId === job.id}
                      className="text-red-400/60 hover:text-red-400 transition-colors p-1.5 rounded hover:bg-red-400/10"
                      aria-label="Cancel email"
                    >
                      {cancellingId === job.id ? (
                        <Spinner size="sm" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/5">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="btn-secondary text-sm py-1.5 px-3 disabled:opacity-30"
          >
            Previous
          </button>
          <span className="text-white/40 text-sm">
            Page {page} of {pagination.totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
            disabled={page >= pagination.totalPages}
            className="btn-secondary text-sm py-1.5 px-3 disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
