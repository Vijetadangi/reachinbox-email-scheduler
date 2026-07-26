import { Router, Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config';
import { query, queryOne } from '../config/database';
import { generateToken, requireAuth } from '../middleware/auth';
import { logger } from '../utils/logger';
import { User } from '../types';

const router = Router();
const googleClient = new OAuth2Client(config.google.clientId);

/**
 * GET /api/auth/google
 * Redirect user to Google's OAuth consent screen.
 */
router.get('/google', (_req: Request, res: Response) => {
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    new URLSearchParams({
      client_id: config.google.clientId,
      redirect_uri: config.google.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'select_account',
    }).toString();

  res.redirect(authUrl);
});

/**
 * GET /api/auth/google/callback
 * Handle the OAuth callback, create/update user, issue JWT.
 */
router.get('/google/callback', async (req: Request, res: Response) => {
  const { code, error } = req.query;

  if (error) {
    logger.warn('Google OAuth error', { error });
    return res.redirect(`${config.frontendUrl}/login?error=oauth_denied`);
  }

  if (!code || typeof code !== 'string') {
    return res.redirect(`${config.frontendUrl}/login?error=invalid_code`);
  }

  try {
    // Exchange authorization code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: config.google.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenResponse.json() as {
      access_token?: string;
      id_token?: string;
      error?: string;
    };

    if (tokenData.error || !tokenData.id_token) {
      logger.error('Token exchange failed', { tokenData });
      return res.redirect(`${config.frontendUrl}/login?error=token_exchange_failed`);
    }

    // Verify ID token and extract user info
    const ticket = await googleClient.verifyIdToken({
      idToken: tokenData.id_token,
      audience: config.google.clientId,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
      return res.redirect(`${config.frontendUrl}/login?error=invalid_token`);
    }

    const { sub: googleId, email, name, picture } = payload;

    // Upsert user in database
    const user = await upsertUser({
      googleId,
      email,
      name: name || email,
      avatarUrl: picture || null,
    });

    // Issue JWT
    const token = generateToken(user.id, user.email);

    logger.info('User logged in via Google', { userId: user.id, email: user.email });

    // Redirect to frontend with token
    return res.redirect(`${config.frontendUrl}/auth/callback?token=${token}`);
  } catch (err) {
    logger.error('Google OAuth callback error:', err);
    return res.redirect(`${config.frontendUrl}/login?error=server_error`);
  }
});

/**
 * POST /api/auth/google/token
 * Alternative: accept Google ID token from frontend (for SPA flow).
 */
router.post('/google/token', async (req: Request, res: Response) => {
  const { idToken } = req.body as { idToken?: string };

  if (!idToken) {
    return res.status(400).json({ error: 'idToken is required' });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: config.google.clientId,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
      return res.status(400).json({ error: 'Invalid token payload' });
    }

    const { sub: googleId, email, name, picture } = payload;

    const user = await upsertUser({
      googleId,
      email,
      name: name || email,
      avatarUrl: picture || null,
    });

    const token = generateToken(user.id, user.email);

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
    logger.error('Token verification failed:', err);
    return res.status(401).json({ error: 'Invalid Google token' });
  }
});

/**
 * GET /api/auth/me
 * Return current user info.
 */
router.get('/me', requireAuth, (req: Request, res: Response) => {
  const user = req.user!;
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatar_url,
  });
});

/**
 * POST /api/auth/logout
 * Client-side logout (invalidate on frontend; JWT is stateless).
 */
router.post('/logout', (_req: Request, res: Response) => {
  res.json({ message: 'Logged out successfully' });
});

// --- Helpers ---

async function upsertUser(params: {
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}): Promise<User> {
  const { googleId, email, name, avatarUrl } = params;

  const existing = await queryOne<User>(
    `SELECT * FROM users WHERE google_id = $1`,
    [googleId]
  );

  if (existing) {
    const [updated] = await query<User>(
      `UPDATE users SET name = $1, avatar_url = $2, updated_at = NOW()
       WHERE google_id = $3
       RETURNING *`,
      [name, avatarUrl, googleId]
    );
    return updated;
  }

  const [created] = await query<User>(
    `INSERT INTO users (google_id, email, name, avatar_url)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [googleId, email, name, avatarUrl]
  );

  return created;
}

export default router;
