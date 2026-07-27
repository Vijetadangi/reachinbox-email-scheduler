/**
 * Demo route — only active in development.
 * Lets you log in without real Google credentials so you can
 * explore the dashboard on localhost immediately.
 */
import { Router, Request, Response } from 'express';
import { query, queryOne } from '../config/database';
import { generateToken } from '../middleware/auth';
import { logger } from '../utils/logger';
import { User } from '../types';
import { config } from '../config';

const router = Router();

router.post('/demo-login', async (_req: Request, res: Response) => {
  if (config.nodeEnv === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    // Upsert a demo user
    let user = await queryOne<User>(
      `SELECT * FROM users WHERE google_id = 'demo-user-001'`
    );

    if (!user) {
      const [created] = await query<User>(
        `INSERT INTO users (google_id, email, name, avatar_url)
         VALUES ('demo-user-001', 'demo@reachinbox.dev', 'Demo User', null)
         ON CONFLICT (google_id) DO UPDATE SET name = EXCLUDED.name
         RETURNING *`
      );
      user = created;
    }

    const token = generateToken(user.id, user.email);
    logger.info('Demo login', { userId: user.id });

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatar_url,
      },
    });
  } catch (err) {
    logger.error('Demo login error:', err);
    return res.status(500).json({ error: 'Demo login failed' });
  }
});

export default router;
