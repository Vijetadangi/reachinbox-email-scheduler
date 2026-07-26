'use client';

import { useEffect, useState, useCallback } from 'react';
import { CheckCircle, ExternalLink, RefreshCw } from 'lucide-react';
import { fetchSentEmails } from '@/lib/api';
import { EmailJob, PaginationMeta } from '@/types';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { showToast } from '@/components/ui/Toaster';
import { formatDate, truncate } from '@/lib/utils';

export function SentEmailsTable() {
  const [jobs, setJobs] = useState<EmailJob[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchSentEmails(page, 20);
      setJobs(data.jobs);
      setPagination(data.pagination);
    } catch {
      showToast('Failed to load sent emails', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

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
        icon={CheckCircle}
        title="No sent emails yet"
        description="Once your scheduled emails are delivered, they'll show up here."
      />
    );
  }

  return (
    <div>
      {/* Table header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/5">
        <p className="text-white/50 text-sm">
          {pagination?.total ?? jobs.length} email{pagination?.total !== 1 ? 's' : ''} delivered
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
              <th className="text-left px-6 py-3 text-white/40 font-medium">Sent at</th>
              <th className="text-left px-6 py-3 text-white/40 font-medium">Status</th>
              <th className="text-right px-6 py-3 text-white/40 font-medium">Preview</th>
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
                  {formatDate(job.sent_at)}
                </td>
                <td className="px-6 py-4">
                  <StatusBadge status={job.status} />
                  {job.error_message && (
                    <p className="text-red-400/60 text-xs mt-1 max-w-[200px] truncate" title={job.error_message}>
                      {job.error_message}
                    </p>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  {job.ethereal_preview_url && (
                    <a
                      href={job.ethereal_preview_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-indigo-400/60 hover:text-indigo-400 transition-colors text-xs"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      View
                    </a>
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
