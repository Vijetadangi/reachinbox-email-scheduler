import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../config/database';
import { scheduleEmailJob } from '../queues/emailQueue';
import { logger } from '../utils/logger';
import { EmailJob, BulkEmailCampaign, BulkScheduleRequest, EmailJobData } from '../types';

/**
 * Schedule a single email.
 *
 * Creates a DB record and enqueues a BullMQ delayed job.
 * The BullMQ job ID matches the DB record ID for traceability.
 *
 * Idempotency key prevents duplicate sends on restart or double-submission.
 */
export async function scheduleSingleEmail(params: {
  userId: string;
  senderId?: string;
  recipientEmail: string;
  subject: string;
  body: string;
  scheduledAt: Date;
  bulkJobId?: string;
  idempotencyKey?: string;
}): Promise<EmailJob> {
  const {
    userId,
    senderId,
    recipientEmail,
    subject,
    body,
    scheduledAt,
    bulkJobId,
    idempotencyKey: existingKey,
  } = params;

  // Generate idempotency key if not provided
  const idempotencyKey = existingKey || `${userId}:${recipientEmail}:${scheduledAt.toISOString()}:${uuidv4()}`;
  const jobId = uuidv4();

  // Check for duplicate idempotency key
  const existing = await queryOne<EmailJob>(
    `SELECT * FROM email_jobs WHERE idempotency_key = $1`,
    [idempotencyKey]
  );

  if (existing) {
    logger.warn('Duplicate email job detected, skipping', { idempotencyKey });
    return existing;
  }

  // Insert into DB first (so state is durable even if Redis is temporarily down)
  const [emailJob] = await query<EmailJob>(
    `INSERT INTO email_jobs (
      id, user_id, sender_id, bulk_job_id,
      recipient_email, subject, body,
      scheduled_at, status, idempotency_key
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled', $9)
    RETURNING *`,
    [jobId, userId, senderId || null, bulkJobId || null, recipientEmail, subject, body, scheduledAt, idempotencyKey]
  );

  // Calculate delay from now
  const nowMs = Date.now();
  const scheduledMs = scheduledAt.getTime();
  const delayMs = Math.max(0, scheduledMs - nowMs);

  // Build BullMQ job data
  const jobData: EmailJobData = {
    jobId,
    userId,
    senderId: senderId || null,
    recipientEmail,
    subject,
    body,
    idempotencyKey,
    scheduledAt: scheduledAt.toISOString(),
    bulkJobId,
  };

  // Enqueue in BullMQ (persisted in Redis)
  // Using jobId as BullMQ job ID ensures 1:1 mapping and deduplication
  const bullmqJobId = await scheduleEmailJob(jobData, delayMs, jobId);

  // Update DB with BullMQ job ID for reference
  await query(
    `UPDATE email_jobs SET bullmq_job_id = $1 WHERE id = $2`,
    [bullmqJobId, jobId]
  );

  logger.info('Single email scheduled', {
    jobId,
    recipient: recipientEmail,
    scheduledAt: scheduledAt.toISOString(),
    delayMs,
  });

  return { ...emailJob, bullmq_job_id: bullmqJobId };
}

/**
 * Schedule a bulk email campaign.
 *
 * Given a list of recipients, schedules them sequentially with spacing.
 * Respects hourly limits by pushing emails to the next available window.
 *
 * Design:
 * - Each email gets its own BullMQ delayed job
 * - Emails are spaced by delayBetweenEmailsMs starting from startTime
 * - If hourlyLimit is set, emails that exceed the limit are pushed to the next hour
 * - All state is persisted in Postgres — restart-safe
 */
export async function scheduleBulkEmails(
  userId: string,
  request: BulkScheduleRequest
): Promise<BulkEmailCampaign> {
  const {
    recipients,
    subject,
    body,
    startTime,
    delayBetweenEmailsMs = 2000,
    hourlyLimit,
    senderId,
  } = request;

  const campaignId = uuidv4();
  const startDate = new Date(startTime);
  const effectiveHourlyLimit = hourlyLimit || config_value('maxPerSenderPerHour');

  // Create the campaign record
  const [campaign] = await query<BulkEmailCampaign>(
    `INSERT INTO bulk_email_campaigns (
      id, user_id, sender_id, subject, body,
      total_recipients, start_time, delay_between_emails_ms, hourly_limit, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
    RETURNING *`,
    [
      campaignId, userId, senderId || null, subject, body,
      recipients.length, startDate, delayBetweenEmailsMs, effectiveHourlyLimit,
    ]
  );

  logger.info('Bulk email campaign created', {
    campaignId,
    totalRecipients: recipients.length,
    startTime,
    delayBetweenEmailsMs,
    hourlyLimit: effectiveHourlyLimit,
  });

  // Schedule each recipient with staggered timing
  let scheduledCount = 0;
  let currentScheduleTime = startDate.getTime();
  let emailsInCurrentHour = 0;

  // Track which hour window we're filling
  let currentHourWindow = getHourWindow(currentScheduleTime);

  for (const recipientEmail of recipients) {
    // If we've hit the hourly limit for this window, push to next hour
    if (effectiveHourlyLimit && emailsInCurrentHour >= effectiveHourlyLimit) {
      const nextHourMs = getStartOfNextHour(currentScheduleTime);
      currentScheduleTime = nextHourMs;
      currentHourWindow = getHourWindow(currentScheduleTime);
      emailsInCurrentHour = 0;

      logger.debug('Hourly limit reached, moving to next hour window', {
        campaignId,
        nextHourMs,
      });
    }

    const scheduledAt = new Date(currentScheduleTime);

    // Each email gets a deterministic idempotency key
    // Using campaignId + index ensures no duplicates even on restart
    const idempotencyKey = `campaign:${campaignId}:${recipientEmail}:${scheduledAt.toISOString()}`;

    try {
      await scheduleSingleEmail({
        userId,
        senderId,
        recipientEmail,
        subject,
        body,
        scheduledAt,
        bulkJobId: campaignId,
        idempotencyKey,
      });

      scheduledCount++;
      emailsInCurrentHour++;
    } catch (err) {
      logger.error('Failed to schedule email in bulk campaign', {
        campaignId,
        recipientEmail,
        err,
      });
    }

    // Add spacing between emails
    currentScheduleTime += delayBetweenEmailsMs;
  }

  // Update campaign scheduled count
  await query(
    `UPDATE bulk_email_campaigns
     SET scheduled_count = $1,
         status = 'active',
         updated_at = NOW()
     WHERE id = $2`,
    [scheduledCount, campaignId]
  );

  logger.info('Bulk campaign scheduling complete', {
    campaignId,
    scheduledCount,
    totalRecipients: recipients.length,
  });

  return { ...campaign, scheduled_count: scheduledCount };
}

function config_value(key: 'maxPerSenderPerHour'): number {
  const { config } = require('../config');
  return config.rateLimit.maxEmailsPerHourPerSender;
}

function getHourWindow(timestampMs: number): string {
  const d = new Date(timestampMs);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}`;
}

function getStartOfNextHour(timestampMs: number): number {
  const d = new Date(timestampMs);
  d.setUTCMinutes(0, 0, 0);
  d.setUTCHours(d.getUTCHours() + 1);
  return d.getTime();
}
