import nodemailer from 'nodemailer';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface EtherealCredentials {
  user: string;
  pass: string;
  host: string;
  port: number;
}

let defaultTransporter: nodemailer.Transporter | null = null;
let defaultCredentials: EtherealCredentials | null = null;

/**
 * Create a new Ethereal test account and return credentials.
 * Ethereal is a fake SMTP service for testing — emails are captured, not delivered.
 */
export async function createEtherealAccount(): Promise<EtherealCredentials> {
  const testAccount = await nodemailer.createTestAccount();

  const creds: EtherealCredentials = {
    user: testAccount.user,
    pass: testAccount.pass,
    host: 'smtp.ethereal.email',
    port: 587,
  };

  logger.info('Created new Ethereal test account', { user: creds.user });
  return creds;
}

/**
 * Get the default SMTP transporter.
 * Uses env vars if set, otherwise creates a new Ethereal account on first call.
 */
export async function getDefaultTransporter(): Promise<{
  transporter: nodemailer.Transporter;
  credentials: EtherealCredentials;
}> {
  if (defaultTransporter && defaultCredentials) {
    return { transporter: defaultTransporter, credentials: defaultCredentials };
  }

  if (config.ethereal.user && config.ethereal.pass) {
    defaultCredentials = {
      user: config.ethereal.user,
      pass: config.ethereal.pass,
      host: config.ethereal.host,
      port: config.ethereal.port,
    };
  } else {
    defaultCredentials = await createEtherealAccount();
    logger.info('Ethereal credentials (save these to .env):', {
      ETHEREAL_USER: defaultCredentials.user,
      ETHEREAL_PASS: defaultCredentials.pass,
    });
  }

  defaultTransporter = createTransporter(defaultCredentials);
  return { transporter: defaultTransporter, credentials: defaultCredentials };
}

/**
 * Build a transporter from given credentials.
 */
export function createTransporter(creds: EtherealCredentials): nodemailer.Transporter {
  return nodemailer.createTransport({
    host: creds.host,
    port: creds.port,
    secure: false,
    auth: {
      user: creds.user,
      pass: creds.pass,
    },
  });
}

export interface SendEmailOptions {
  from: string;
  to: string;
  subject: string;
  html: string;
  transporter?: nodemailer.Transporter;
}

export interface SendEmailResult {
  messageId: string;
  previewUrl: string;
}

/**
 * Send an email and return the message ID + Ethereal preview URL.
 */
export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  let transporter = options.transporter;

  if (!transporter) {
    const result = await getDefaultTransporter();
    transporter = result.transporter;
  }

  const info = await transporter.sendMail({
    from: options.from,
    to: options.to,
    subject: options.subject,
    html: options.html,
  });

  const previewUrl = nodemailer.getTestMessageUrl(info) || '';

  logger.info('Email sent via Ethereal', {
    messageId: info.messageId,
    to: options.to,
    subject: options.subject,
    previewUrl,
  });

  return {
    messageId: info.messageId as string,
    previewUrl: previewUrl as string,
  };
}
