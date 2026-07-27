import express from 'express';
import cors from 'cors';
import { config } from './config';
import { logger } from './utils/logger';
import { getPool } from './config/database';
import { getRedisClient } from './config/redis';
import { getEmailQueue } from './queues/emailQueue';
import authRouter from './routes/auth';
import emailsRouter from './routes/emails';
import sendersRouter from './routes/senders';
import demoRouter from './routes/demo';
import { errorHandler } from './middleware/errorHandler';
import { getDefaultTransporter } from './services/ethereal';

const app = express();

// CORS — allow frontend
app.use(cors({
  origin: config.frontendUrl,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check
app.get('/health', async (_req, res) => {
  try {
    const pool = getPool();
    await pool.query('SELECT 1');

    const redis = getRedisClient();
    await redis.ping();

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        postgres: 'connected',
        redis: 'connected',
      },
    });
  } catch (err) {
    res.status(503).json({
      status: 'degraded',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// Routes
app.use('/api/auth', authRouter);
app.use('/api/demo', demoRouter);
app.use('/api/emails', emailsRouter);
app.use('/api/senders', sendersRouter);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use(errorHandler);

async function runMigrations(): Promise<void> {
  const { getPool } = await import('./config/database');
  const pool = getPool();
  const migrations = `
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      google_id VARCHAR(255) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      avatar_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS email_senders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      ethereal_user VARCHAR(255) NOT NULL,
      ethereal_pass VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, email)
    );
    CREATE TABLE IF NOT EXISTS email_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sender_id UUID REFERENCES email_senders(id) ON DELETE SET NULL,
      bulk_job_id UUID,
      recipient_email VARCHAR(255) NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      scheduled_at TIMESTAMPTZ NOT NULL,
      sent_at TIMESTAMPTZ,
      status VARCHAR(50) NOT NULL DEFAULT 'scheduled',
      bullmq_job_id VARCHAR(255),
      ethereal_preview_url TEXT,
      error_message TEXT,
      attempt_count INTEGER DEFAULT 0,
      idempotency_key VARCHAR(255) UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS bulk_email_campaigns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sender_id UUID REFERENCES email_senders(id) ON DELETE SET NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      total_recipients INTEGER NOT NULL DEFAULT 0,
      scheduled_count INTEGER NOT NULL DEFAULT 0,
      sent_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      start_time TIMESTAMPTZ NOT NULL,
      delay_between_emails_ms INTEGER NOT NULL DEFAULT 2000,
      hourly_limit INTEGER,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_email_jobs_user_id ON email_jobs(user_id);
    CREATE INDEX IF NOT EXISTS idx_email_jobs_status ON email_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_email_jobs_scheduled_at ON email_jobs(scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_email_jobs_bulk_job_id ON email_jobs(bulk_job_id);
    CREATE INDEX IF NOT EXISTS idx_bulk_campaigns_user_id ON bulk_email_campaigns(user_id);
  `;
  await pool.query(migrations);
  logger.info('Migrations applied');
}

async function bootstrap(): Promise<void> {
  // Verify database connection
  try {
    const pool = getPool();
    await pool.query('SELECT 1');
    logger.info('PostgreSQL connected successfully');
    // Run migrations inline on boot (idempotent CREATE IF NOT EXISTS)
    await runMigrations();
  } catch (err) {
    logger.error('PostgreSQL connection failed:', err);
    process.exit(1);
  }
  // Verify Redis connection
  try {
    const redis = getRedisClient();
    await redis.ping();
    logger.info('Redis connected successfully');
  } catch (err) {
    logger.error('Redis connection failed:', err);
    process.exit(1);
  }

  // Initialize email queue (creates connection to Redis)
  getEmailQueue();

  // Initialize default Ethereal transporter (creates account if needed)
  try {
    const { credentials } = await getDefaultTransporter();
    logger.info('Ethereal SMTP ready', { user: credentials.user });
    logger.info('Ethereal inbox: https://ethereal.email');
  } catch (err) {
    logger.warn('Could not initialize Ethereal transporter:', err);
  }

  app.listen(config.port, () => {
    logger.info(`Server running on port ${config.port}`, {
      env: config.nodeEnv,
      frontendUrl: config.frontendUrl,
    });
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received — shutting down gracefully');
  const pool = getPool();
  await pool.end();
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection:', reason);
});

bootstrap().catch((err) => {
  logger.error('Bootstrap failed:', err);
  process.exit(1);
});

export default app;
