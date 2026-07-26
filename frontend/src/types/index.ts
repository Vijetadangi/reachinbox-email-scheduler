export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export type EmailJobStatus = 'scheduled' | 'processing' | 'sent' | 'failed' | 'cancelled';

export interface EmailJob {
  id: string;
  user_id: string;
  sender_id: string | null;
  bulk_job_id: string | null;
  recipient_email: string;
  subject: string;
  body: string;
  scheduled_at: string;
  sent_at: string | null;
  status: EmailJobStatus;
  bullmq_job_id: string | null;
  ethereal_preview_url: string | null;
  error_message: string | null;
  attempt_count: number;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
  // Joined fields
  sender_name?: string;
  sender_email?: string;
}

export type CampaignStatus = 'pending' | 'active' | 'completed' | 'failed' | 'cancelled';

export interface BulkEmailCampaign {
  id: string;
  user_id: string;
  sender_id: string | null;
  subject: string;
  body: string;
  total_recipients: number;
  scheduled_count: number;
  sent_count: number;
  failed_count: number;
  start_time: string;
  delay_between_emails_ms: number;
  hourly_limit: number | null;
  status: CampaignStatus;
  created_at: string;
  updated_at: string;
}

export interface EmailSender {
  id: string;
  user_id: string;
  name: string;
  email: string;
  created_at: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ScheduleEmailForm {
  subject: string;
  body: string;
  recipientEmail?: string;
  recipients?: string[];
  csvFile?: File;
  scheduledAt: string;
  senderId?: string;
  delayBetweenEmailsMs: number;
  hourlyLimit?: number;
}

export interface QueueStats {
  waiting: number;
  delayed: number;
  active: number;
  completed: number;
  failed: number;
}

export interface RateLimitStatus {
  senderCount: number;
  globalCount: number;
  perSenderLimit: number;
  globalLimit: number;
}
