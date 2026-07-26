import { Queue, QueueEvents } from 'bullmq';
import { createRedisConnection } from '../config/redis';
import { logger } from '../utils/logger';
import { EmailJobData } from '../types';

export const EMAIL_QUEUE_NAME = 'email-scheduler';

let emailQueue: Queue<EmailJobData> | null = null;
let queueEvents: QueueEvents | null = null;

/**
 * Get or create the BullMQ email queue.
 * Using a singleton to avoid multiple queue connections.
 */
export function getEmailQueue(): Queue<EmailJobData> {
  if (!emailQueue) {
    emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        // Keep completed jobs for 24 hours for audit trail
        removeOnComplete: {
          age: 86400,
          count: 10000,
        },
        // Keep failed jobs for 7 days for debugging
        removeOnFail: {
          age: 604800,
          count: 5000,
        },
        // Retry failed jobs up to 3 times with exponential backoff
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      },
    });

    emailQueue.on('error', (err) => {
      logger.error('Email queue error:', err);
    });

    logger.info('Email queue initialized');
  }

  return emailQueue;
}

/**
 * Get or create queue events listener (for monitoring).
 */
export function getQueueEvents(): QueueEvents {
  if (!queueEvents) {
    queueEvents = new QueueEvents(EMAIL_QUEUE_NAME, {
      connection: createRedisConnection(),
    });

    queueEvents.on('completed', ({ jobId }) => {
      logger.debug('Job completed', { jobId });
    });

    queueEvents.on('failed', ({ jobId, failedReason }) => {
      logger.warn('Job failed', { jobId, failedReason });
    });

    queueEvents.on('delayed', ({ jobId, delay }) => {
      logger.debug('Job delayed', { jobId, delay });
    });
  }

  return queueEvents;
}

/**
 * Schedule a single email job with a delay.
 *
 * BullMQ persists delayed jobs in Redis sorted sets, so they survive restarts.
 * The job won't fire until the delay has elapsed, even if the server restarts.
 *
 * @param jobData     - Email payload
 * @param delayMs     - Milliseconds from now to send
 * @param jobId       - Unique job ID (used for deduplication / idempotency)
 */
export async function scheduleEmailJob(
  jobData: EmailJobData,
  delayMs: number,
  jobId: string
): Promise<string> {
  const queue = getEmailQueue();

  const job = await queue.add(
    'send-email',
    jobData,
    {
      delay: delayMs,
      jobId,               // BullMQ deduplicates by jobId — safe to call multiple times
      removeOnComplete: {
        age: 86400,
      },
      removeOnFail: {
        age: 604800,
      },
    }
  );

  logger.info('Email job scheduled', {
    bullmqJobId: job.id,
    recipient: jobData.recipientEmail,
    scheduledAt: jobData.scheduledAt,
    delayMs,
  });

  return job.id as string;
}

/**
 * Cancel a pending email job.
 * Only works if the job hasn't started processing yet.
 */
export async function cancelEmailJob(bullmqJobId: string): Promise<boolean> {
  const queue = getEmailQueue();

  try {
    const job = await queue.getJob(bullmqJobId);
    if (!job) {
      logger.warn('Job not found for cancellation', { bullmqJobId });
      return false;
    }

    const state = await job.getState();
    if (state === 'delayed' || state === 'waiting') {
      await job.remove();
      logger.info('Job cancelled', { bullmqJobId });
      return true;
    }

    logger.warn('Job cannot be cancelled in state', { bullmqJobId, state });
    return false;
  } catch (err) {
    logger.error('Error cancelling job', { bullmqJobId, err });
    return false;
  }
}

/**
 * Get queue stats for monitoring.
 */
export async function getQueueStats(): Promise<{
  waiting: number;
  delayed: number;
  active: number;
  completed: number;
  failed: number;
}> {
  const queue = getEmailQueue();
  const counts = await queue.getJobCounts('waiting', 'delayed', 'active', 'completed', 'failed');
  return counts as {
    waiting: number;
    delayed: number;
    active: number;
    completed: number;
    failed: number;
  };
}
