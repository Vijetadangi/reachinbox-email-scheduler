import { Router, Request, Response } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { requireAuth } from '../middleware/auth';
import { scheduleSingleEmail, scheduleBulkEmails } from '../services/emailScheduler';
import { cancelEmailJob, getQueueStats } from '../queues/emailQueue';
import { query, queryOne } from '../config/database';
import { logger } from '../utils/logger';
import { EmailJob, BulkEmailCampaign } from '../types';
import { getRateLimitStatus } from '../services/rateLimiter';
import { createError } from '../middleware/errorHandler';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// All routes require authentication
router.use(requireAuth);

/**
 * POST /api/emails/schedule
 * Schedule a single email.
 */
router.post('/schedule', async (req: Request, res: Response) => {
  try {
    const { recipientEmail, subject, body, scheduledAt, senderId } = req.body as {
      recipientEmail: string;
      subject: string;
      body: string;
      scheduledAt: string;
      senderId?: string;
    };

    if (!recipientEmail || !subject || !body || !scheduledAt) {
      return res.status(400).json({ error: 'recipientEmail, subject, body, and scheduledAt are required' });
    }

    const scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime())) {
      return res.status(400).json({ error: 'Invalid scheduledAt datetime' });
    }

    const emailJob = await scheduleSingleEmail({
      userId: req.user!.id,
      senderId,
      recipientEmail,
      subject,
      body,
      scheduledAt: scheduledDate,
    });

    return res.status(201).json({ job: emailJob });
  } catch (err) {
    logger.error('Error scheduling email:', err);
    return res.status(500).json({ error: 'Failed to schedule email' });
  }
});

/**
 * POST /api/emails/schedule/bulk
 * Schedule a bulk email campaign from a CSV file or raw recipient list.
 * Accepts multipart/form-data with optional CSV file.
 */
router.post('/schedule/bulk', upload.single('csv'), async (req: Request, res: Response) => {
  try {
    let recipients: string[] = [];

    // Parse recipients from CSV file if uploaded
    if (req.file) {
      const csvContent = req.file.buffer.toString('utf-8');
      const parsed = parse(csvContent, {
        skip_empty_lines: true,
        trim: true,
      }) as string[][];

      // Support CSV with header row or plain list
      // Extract emails: look for column named 'email', else take first column
      if (parsed.length > 0) {
        const headerRow = parsed[0];
        const emailColIndex = headerRow.findIndex((col) =>
          col.toLowerCase().includes('email')
        );

        if (emailColIndex !== -1) {
          // Has header row — skip first row
          recipients = parsed
            .slice(1)
            .map((row) => row[emailColIndex])
            .filter(isValidEmail);
        } else {
          // Plain list — first column
          recipients = parsed
            .map((row) => row[0])
            .filter(isValidEmail);
        }
      }
    } else if (req.body.recipients) {
      // Also accept JSON array
      const raw = typeof req.body.recipients === 'string'
        ? JSON.parse(req.body.recipients)
        : req.body.recipients;

      recipients = (raw as string[]).filter(isValidEmail);
    }

    if (recipients.length === 0) {
      return res.status(400).json({ error: 'No valid email addresses found' });
    }

    const {
      subject,
      body,
      startTime,
      delayBetweenEmailsMs,
      hourlyLimit,
      senderId,
    } = req.body as {
      subject: string;
      body: string;
      startTime: string;
      delayBetweenEmailsMs?: string;
      hourlyLimit?: string;
      senderId?: string;
    };

    if (!subject || !body || !startTime) {
      return res.status(400).json({ error: 'subject, body, and startTime are required' });
    }

    const campaign = await scheduleBulkEmails(req.user!.id, {
      recipients,
      subject,
      body,
      startTime,
      delayBetweenEmailsMs: delayBetweenEmailsMs ? parseInt(delayBetweenEmailsMs, 10) : 2000,
      hourlyLimit: hourlyLimit ? parseInt(hourlyLimit, 10) : undefined,
      senderId,
    });

    return res.status(201).json({
      campaign,
      recipientCount: recipients.length,
    });
  } catch (err) {
    logger.error('Error scheduling bulk emails:', err);
    return res.status(500).json({ error: 'Failed to schedule bulk emails' });
  }
});

/**
 * POST /api/emails/parse-csv
 * Parse a CSV and return detected email addresses (preview before scheduling).
 */
router.post('/parse-csv', upload.single('csv'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'CSV file is required' });
  }

  try {
    const csvContent = req.file.buffer.toString('utf-8');
    const parsed = parse(csvContent, {
      skip_empty_lines: true,
      trim: true,
    }) as string[][];

    let emails: string[] = [];

    if (parsed.length > 0) {
      const headerRow = parsed[0];
      const emailColIndex = headerRow.findIndex((col) =>
        col.toLowerCase().includes('email')
      );

      if (emailColIndex !== -1) {
        emails = parsed.slice(1).map((row) => row[emailColIndex]).filter(isValidEmail);
      } else {
        emails = parsed.map((row) => row[0]).filter(isValidEmail);
      }
    }

    return res.json({
      emails,
      count: emails.length,
      preview: emails.slice(0, 5),
    });
  } catch (err) {
    logger.error('Error parsing CSV:', err);
    return res.status(400).json({ error: 'Failed to parse CSV file' });
  }
});

/**
 * GET /api/emails/scheduled
 * List all scheduled (pending) emails for the current user.
 */
router.get('/scheduled', async (req: Request, res: Response) => {
  try {
    const page = parseInt((req.query.page as string) || '1', 10);
    const limit = Math.min(parseInt((req.query.limit as string) || '20', 10), 100);
    const offset = (page - 1) * limit;

    const [countResult] = await query<{ count: string }>(
      `SELECT COUNT(*) FROM email_jobs
       WHERE user_id = $1 AND status IN ('scheduled', 'processing')`,
      [req.user!.id]
    );

    const jobs = await query<EmailJob>(
      `SELECT ej.*, es.name as sender_name, es.email as sender_email
       FROM email_jobs ej
       LEFT JOIN email_senders es ON ej.sender_id = es.id
       WHERE ej.user_id = $1 AND ej.status IN ('scheduled', 'processing')
       ORDER BY ej.scheduled_at ASC
       LIMIT $2 OFFSET $3`,
      [req.user!.id, limit, offset]
    );

    return res.json({
      jobs,
      pagination: {
        page,
        limit,
        total: parseInt(countResult.count, 10),
        totalPages: Math.ceil(parseInt(countResult.count, 10) / limit),
      },
    });
  } catch (err) {
    logger.error('Error fetching scheduled emails:', err);
    return res.status(500).json({ error: 'Failed to fetch scheduled emails' });
  }
});

/**
 * GET /api/emails/sent
 * List all sent (and failed) emails for the current user.
 */
router.get('/sent', async (req: Request, res: Response) => {
  try {
    const page = parseInt((req.query.page as string) || '1', 10);
    const limit = Math.min(parseInt((req.query.limit as string) || '20', 10), 100);
    const offset = (page - 1) * limit;

    const [countResult] = await query<{ count: string }>(
      `SELECT COUNT(*) FROM email_jobs
       WHERE user_id = $1 AND status IN ('sent', 'failed')`,
      [req.user!.id]
    );

    const jobs = await query<EmailJob>(
      `SELECT ej.*, es.name as sender_name, es.email as sender_email
       FROM email_jobs ej
       LEFT JOIN email_senders es ON ej.sender_id = es.id
       WHERE ej.user_id = $1 AND ej.status IN ('sent', 'failed')
       ORDER BY ej.sent_at DESC NULLS LAST, ej.updated_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user!.id, limit, offset]
    );

    return res.json({
      jobs,
      pagination: {
        page,
        limit,
        total: parseInt(countResult.count, 10),
        totalPages: Math.ceil(parseInt(countResult.count, 10) / limit),
      },
    });
  } catch (err) {
    logger.error('Error fetching sent emails:', err);
    return res.status(500).json({ error: 'Failed to fetch sent emails' });
  }
});

/**
 * GET /api/emails/:id
 * Get a single email job by ID.
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const job = await queryOne<EmailJob>(
      `SELECT ej.*, es.name as sender_name, es.email as sender_email
       FROM email_jobs ej
       LEFT JOIN email_senders es ON ej.sender_id = es.id
       WHERE ej.id = $1 AND ej.user_id = $2`,
      [req.params.id, req.user!.id]
    );

    if (!job) {
      return res.status(404).json({ error: 'Email job not found' });
    }

    return res.json({ job });
  } catch (err) {
    logger.error('Error fetching email job:', err);
    return res.status(500).json({ error: 'Failed to fetch email job' });
  }
});

/**
 * DELETE /api/emails/:id
 * Cancel a scheduled email (removes from queue + marks cancelled in DB).
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const job = await queryOne<EmailJob>(
      `SELECT * FROM email_jobs WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user!.id]
    );

    if (!job) {
      return res.status(404).json({ error: 'Email job not found' });
    }

    if (job.status !== 'scheduled') {
      return res.status(400).json({ error: `Cannot cancel a job with status '${job.status}'` });
    }

    // Remove from BullMQ queue
    if (job.bullmq_job_id) {
      await cancelEmailJob(job.bullmq_job_id);
    }

    // Mark cancelled in DB
    await query(
      `UPDATE email_jobs SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [job.id]
    );

    return res.json({ message: 'Email job cancelled' });
  } catch (err) {
    logger.error('Error cancelling email job:', err);
    return res.status(500).json({ error: 'Failed to cancel email job' });
  }
});

/**
 * GET /api/emails/stats/queue
 * Get BullMQ queue statistics.
 */
router.get('/stats/queue', async (_req: Request, res: Response) => {
  try {
    const stats = await getQueueStats();
    return res.json({ stats });
  } catch (err) {
    logger.error('Error fetching queue stats:', err);
    return res.status(500).json({ error: 'Failed to fetch queue stats' });
  }
});

/**
 * GET /api/emails/stats/rate-limit
 * Get current rate limit status for the authenticated user.
 */
router.get('/stats/rate-limit', async (req: Request, res: Response) => {
  try {
    const senderId = (req.query.senderId as string) || `user:${req.user!.id}`;
    const status = await getRateLimitStatus(senderId);
    return res.json(status);
  } catch (err) {
    logger.error('Error fetching rate limit status:', err);
    return res.status(500).json({ error: 'Failed to fetch rate limit status' });
  }
});

// --- Helpers ---

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export default router;
