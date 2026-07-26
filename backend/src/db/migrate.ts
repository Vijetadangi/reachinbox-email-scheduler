import { getPool } from '../config/database';
import { logger } from '../utils/logger';

const migrations = `
  -- Users table (for Google OAuth)
  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    google_id VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- Email senders table (multiple senders per user)
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

  -- Email jobs table
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

  -- Bulk email campaigns table
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

  -- Indexes for performance
  CREATE INDEX IF NOT EXISTS idx_email_jobs_user_id ON email_jobs(user_id);
  CREATE INDEX IF NOT EXISTS idx_email_jobs_status ON email_jobs(status);
  CREATE INDEX IF NOT EXISTS idx_email_jobs_scheduled_at ON email_jobs(scheduled_at);
  CREATE INDEX IF NOT EXISTS idx_email_jobs_bulk_job_id ON email_jobs(bulk_job_id);
  CREATE INDEX IF NOT EXISTS idx_email_jobs_idempotency_key ON email_jobs(idempotency_key);
  CREATE INDEX IF NOT EXISTS idx_bulk_campaigns_user_id ON bulk_email_campaigns(user_id);

  -- Update trigger
  CREATE OR REPLACE FUNCTION update_updated_at_column()
  RETURNS TRIGGER AS $$
  BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
  END;
  $$ language 'plpgsql';

  DROP TRIGGER IF EXISTS update_email_jobs_updated_at ON email_jobs;
  CREATE TRIGGER update_email_jobs_updated_at
    BEFORE UPDATE ON email_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

  DROP TRIGGER IF EXISTS update_bulk_campaigns_updated_at ON bulk_email_campaigns;
  CREATE TRIGGER update_bulk_campaigns_updated_at
    BEFORE UPDATE ON bulk_email_campaigns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
`;

async function migrate(): Promise<void> {
  const pool = getPool();

  try {
    logger.info('Running database migrations...');
    await pool.query(migrations);
    logger.info('Migrations completed successfully');
  } catch (error) {
    logger.error('Migration failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

migrate().catch((err) => {
  logger.error('Fatal migration error:', err);
  process.exit(1);
});
