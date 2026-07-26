import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { query, queryOne } from '../config/database';
import { createEtherealAccount } from '../services/ethereal';
import { logger } from '../utils/logger';
import { EmailSender } from '../types';

const router = Router();
router.use(requireAuth);

/**
 * GET /api/senders
 * List all email senders for the current user.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const senders = await query<EmailSender>(
      `SELECT id, user_id, name, email, created_at FROM email_senders WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user!.id]
    );
    return res.json({ senders });
  } catch (err) {
    logger.error('Error fetching senders:', err);
    return res.status(500).json({ error: 'Failed to fetch senders' });
  }
});

/**
 * POST /api/senders
 * Create a new email sender with a fresh Ethereal account.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, email } = req.body as { name?: string; email?: string };

    // If email is provided, use it; otherwise create a fresh Ethereal test account
    let senderEmail = email;
    let etherealUser: string;
    let etherealPass: string;

    if (email) {
      // User wants to use a specific address — still need Ethereal creds
      const creds = await createEtherealAccount();
      senderEmail = email;
      etherealUser = creds.user;
      etherealPass = creds.pass;
    } else {
      // Auto-create Ethereal account
      const creds = await createEtherealAccount();
      senderEmail = creds.user;
      etherealUser = creds.user;
      etherealPass = creds.pass;
    }

    const senderName = name || senderEmail;

    const existing = await queryOne<EmailSender>(
      `SELECT id FROM email_senders WHERE user_id = $1 AND email = $2`,
      [req.user!.id, senderEmail]
    );

    if (existing) {
      return res.status(409).json({ error: 'Sender with this email already exists' });
    }

    const [sender] = await query<EmailSender>(
      `INSERT INTO email_senders (user_id, name, email, ethereal_user, ethereal_pass)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, name, email, created_at`,
      [req.user!.id, senderName, senderEmail, etherealUser, etherealPass]
    );

    logger.info('New sender created', { senderId: sender.id, email: senderEmail });

    return res.status(201).json({ sender });
  } catch (err) {
    logger.error('Error creating sender:', err);
    return res.status(500).json({ error: 'Failed to create sender' });
  }
});

/**
 * DELETE /api/senders/:id
 * Remove a sender.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const sender = await queryOne<EmailSender>(
      `SELECT id FROM email_senders WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user!.id]
    );

    if (!sender) {
      return res.status(404).json({ error: 'Sender not found' });
    }

    await query(`DELETE FROM email_senders WHERE id = $1`, [req.params.id]);

    return res.json({ message: 'Sender deleted' });
  } catch (err) {
    logger.error('Error deleting sender:', err);
    return res.status(500).json({ error: 'Failed to delete sender' });
  }
});

export default router;
