export interface User {
  id: string;
  google_id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface EmailSender {
  id: string;
  user_id: string;
  name: string;
  email: string;
  ethereal_user: string;
  ethereal_pass: string;
  created_at: Date;
}

export interface EmailJob {
  id: string;
  user_id: string;
  sender_id: string | null;
  bulk_job_id: string | null;
  recipient_email: string;
  subject: string;
  body: string;
  scheduled_at: Date;
  sent_at: Date | null;
  status: EmailJobStatus;
  bullmq_job_id: string | null;
  ethereal_preview_url: string | null;
  error_message: string | null;
  attempt_count: number;
  idempotency_key: string;
  created_at: Date;
  updated_at: Date;
}

export type EmailJobStatus = 'scheduled' | 'processing' | 'sent' | 'failed' | 'cancelled';

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
  start_time: Date;
  delay_between_emails_ms: number;
  hourly_limit: number | null;
  status: CampaignStatus;
  created_at: Date;
  updated_at: Date;
}

export type CampaignStatus = 'pending' | 'active' | 'completed' | 'failed' | 'cancelled';

// BullMQ job data shape
export interface EmailJobData {
  jobId: string;           // DB record UUID
  userId: string;
  senderId: string | null;
  recipientEmail: string;
  subject: string;
  body: string;
  idempotencyKey: string;
  scheduledAt: string;     // ISO string
  bulkJobId?: string;
}

export interface ScheduleEmailRequest {
  recipientEmail: string;
  subject: string;
  body: string;
  scheduledAt: string;     // ISO datetime string
  senderId?: string;
}

export interface BulkScheduleRequest {
  recipients: string[];    // list of email addresses
  subject: string;
  body: string;
  startTime: string;       // ISO datetime string
  delayBetweenEmailsMs?: number;
  hourlyLimit?: number;
  senderId?: string;
}

export interface AuthenticatedRequest extends Express.Request {
  user?: User;
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}
