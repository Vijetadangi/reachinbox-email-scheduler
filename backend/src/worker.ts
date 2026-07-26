/**
 * BullMQ Worker Process
 *
 * This is a separate process that consumes email jobs from the queue.
 * It handles:
 * - Rate limiting (per-sender + global, Redis-backed, safe across instances)
 * - Minimum delay between sends (2s default)
 * - Actual email dispatch via Ethereal SMTP
 * - Idempotency (won't re-send already-sent emails)
 * - Persists status back to PostgreSQL
 */

import { Worker, Job } from 'bullmq';
import { createRedisConnection } from './config/redis';
import { config } from './config';
import { logger } from './utils/logger';
import { EMAIL_QUEUE_NAME } from './queues/emailQueue';
import { EmailJobData } from './types';
import { checkAndIncrementRateLimit } from './services/rateLimiter';
import { sendEmail, getDefaultTransporter, createTransporter } from './services/ethereal';
import { query, queryOne } from './config/database';
import { EmailJob, EmailSender } from './types';

// Track time of last send to enforce minimum delay between sends
let lastSendTime = 0;

/**
 * Enforce a minimum gap between consecutive email sends.
 * This mimics real-world SMTP provider throttling requirements.
 */
async function enforceMinDelay(): Promise<void> {
  const minDelay = config.worker.minSendDelayMs;
  const now = Date.now();
  const timeSinceLast = now - lastSendTime;

  if (timeSinceLast < minDelay) {
    const waitMs = minDelay - timeSinceLast;
    logger.debug('Enforcing min send delay', { waitMs });
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  lastSendTime = Date.now();
}

/**
 * Main job processor.
 */
async function processEmailJob(job: Job<EmailJobData>): Promise<void> {
  const { jobId, userId, senderId, recipientEmail, subject, body, idempotencyKey, scheduledAt } =
    job.data;

  logger.info('Processing email job', {
    bullmqJobId: job.id,
    dbJobId: jobId,
    recipient: recipientEmail,
  });

  // 1. Idempotency check — never send the same email twice
  const existingJob = await queryOne<EmailJob>(
    `SELECT id, status FROM email_jobs WHERE idempotency_key = $1`,
    [idempotencyKey]
  );

  if (existingJob?.status === 'sent') {
    logger.warn('Duplicate send attempt blocked by idempotency key', {
      idempotencyKey,
      jobId,
    });
    return; // Job is already done — skip silently
  }

  // 2. Mark job as 'processing'
  await query(
    `UPDATE email_jobs SET status = 'processing', attempt_count = attempt_count + 1, updated_at = NOW() WHERE id = $1`,
    [jobId]
  );

  // 3. Check rate limit (Redis-backed, safe across concurrent workers)
  const effectiveSenderId = senderId || `user:${userId}`;
  const rateLimitResult = await checkAndIncrementRateLimit(effectiveSenderId);

  if (!rateLimitResult.allowed) {
    logger.warn('Rate limit exceeded, rescheduling job', {
      jobId,
      retryAfterMs: rateLimitResult.retryAfterMs,
    });

    // Reset status to scheduled so it can be retried
    await query(
      `UPDATE email_jobs SET status = 'scheduled', updated_at = NOW() WHERE id = $1`,
      [jobId]
    );

    // Throw a retriable error — BullMQ will delay and retry
    // We move the delay into next hour to respect the rate limit window
    const error = new Error(`Rate limit exceeded. Retry after ${rateLimitResult.retryAfterMs}ms`);
    (error as Error & { retryAfterMs: number }).retryAfterMs = rateLimitResult.retryAfterMs;

    // Use BullMQ's moveToDelayed to push job to exact retry time
    await job.moveToDelayed(Date.now() + rateLimitResult.retryAfterMs, job.token);
    return;
  }

  // 4. Enforce minimum delay between sends
  await enforceMinDelay();

  // 5. Resolve which SMTP transporter to use
  let transporter;
  let fromAddress: string;

  if (senderId) {
    const sender = await queryOne<EmailSender>(
      `SELECT * FROM email_senders WHERE id = $1`,
      [senderId]
    );

    if (sender) {
      transporter = createTransporter({
        user: sender.ethereal_user,
        pass: sender.ethereal_pass,
        host: 'smtp.ethereal.email',
        port: 587,
      });
      fromAddress = `"${sender.name}" <${sender.email}>`;
    } else {
      const { transporter: t, credentials } = await getDefaultTransporter();
      transporter = t;
      fromAddress = `"ReachInbox" <${credentials.user}>`;
    }
  } else {
    const { transporter: t, credentials } = await getDefaultTransporter();
    transporter = t;
    fromAddress = `"ReachInbox" <${credentials.user}>`;
  }

  // 6. Send the email
  try {
    const result = await sendEmail({
      from: fromAddress,
      to: recipientEmail,
      subject,
      html: body,
      transporter,
    });

    // 7. Update DB: mark sent
    await query(
      `UPDATE email_jobs
       SET status = 'sent',
           sent_at = NOW(),
           ethereal_preview_url = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [result.previewUrl, jobId]
    );

    // 8. Update campaign counters if this is part of a bulk send
    if (job.data.bulkJobId) {
      await query(
        `UPDATE bulk_email_campaigns
         SET sent_count = sent_count + 1, updated_at = NOW()
         WHERE id = $1`,
        [job.data.bulkJobId]
      );
    }

    logger.info('Email sent successfully', {
      jobId,
      recipient: recipientEmail,
      previewUrl: result.previewUrl,
    });
  } catch (sendError) {
    const errorMessage = sendError instanceof Error ? sendError.message : String(sendError);

    logger.error('Failed to send email', {
      jobId,
      recipient: recipientEmail,
      error: errorMessage,
    });

    // Determine if we've exhausted retries
    const isFinalAttempt = job.attemptsMade >= (job.opts.attempts ?? 3) - 1;

    await query(
      `UPDATE email_jobs
       SET status = $1,
           error_message = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [isFinalAttempt ? 'failed' : 'scheduled', errorMessage, jobId]
    );

    if (job.data.bulkJobId && isFinalAttempt) {
      await query(
        `UPDATE bulk_email_campaigns
         SET failed_count = failed_count + 1, updated_at = NOW()
         WHERE id = $1`,
        [job.data.bulkJobId]
      );
    }

    // Re-throw to trigger BullMQ's built-in retry/backoff
    throw sendError;
  }
}

// Create worker with configurable concurrency
const worker = new Worker<EmailJobData>(
  EMAIL_QUEUE_NAME,
  processEmailJob,
  {
    connection: createRedisConnection(),
    concurrency: config.worker.concurrency,
    // BullMQ limiter as a secondary safety net — caps total job starts per time window
    limiter: {
      max: config.rateLimit.maxEmailsPerHour,
      duration: 3600000, // 1 hour in ms
    },
  }
);

worker.on('completed', (job) => {
  logger.info('Worker: job completed', { jobId: job.id });
});

worker.on('failed', (job, err) => {
  logger.error('Worker: job failed', {
    jobId: job?.id,
    error: err.message,
  });
});

worker.on('error', (err) => {
  logger.error('Worker error:', err);
});

worker.on('stalled', (jobId) => {
  logger.warn('Worker: job stalled', { jobId });
});

logger.info('Email worker started', {
  queueName: EMAIL_QUEUE_NAME,
  concurrency: config.worker.concurrency,
  minSendDelayMs: config.worker.minSendDelayMs,
  maxEmailsPerHour: config.rateLimit.maxEmailsPerHour,
  maxPerSenderPerHour: config.rateLimit.maxEmailsPerHourPerSender,
});

// Graceful shutdown
async function shutdown(): Promise<void> {
  logger.info('Worker shutting down...');
  await worker.close();
  logger.info('Worker shut down cleanly');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
