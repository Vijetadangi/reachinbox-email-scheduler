import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { queryOne } from '../config/database';
import { User } from '../types';
import { logger } from '../utils/logger';

export interface JwtPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

export function generateToken(userId: string, email: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (jwt.sign as any)({ userId, email }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwt.secret) as JwtPayload;
}

/**
 * Express middleware that validates JWT and attaches the user to req.user.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : (req.cookies?.token as string | undefined);

    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const payload = verifyToken(token);

    const user = await queryOne<User>(
      `SELECT * FROM users WHERE id = $1`,
      [payload.userId]
    );

    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    req.user = user;
    next();
  } catch (err) {
    logger.warn('Auth middleware failed', { err });
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
