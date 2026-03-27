import { clerkMiddleware } from '@clerk/express';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { HttpError, type ClerkAuth } from '../lib/auth.js';

// Extend Express Request to include Clerk auth
declare global {
  namespace Express {
    interface Request {
      auth?: ClerkAuth;
      user?: {
        id: string;
        email: string;
        role: 'BUYER' | 'ADMIN';
        clerkId: string;
      };
    }
  }
}

/**
 * Standard Clerk middleware that processes the session token.
 * Does NOT block unauthenticated requests (use requireAuth for that).
 */
export const authMiddleware = clerkMiddleware();

/**
 * Enforces authentication and hydrates req.user from our database.
 * Blocks unauthenticated requests.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    // 1. Check if Clerk authenticated the request
    if (!req.auth?.userId) {
      throw new HttpError(401, 'Authentication required', 'AUTH_REQUIRED');
    }

    const clerkId = req.auth.userId;

    // 2. Fetch the internal user from our database using the Clerk ID
    const user = await prisma.user.findUnique({
      where: { clerkId },
      select: {
        id: true,
        email: true,
        role: true,
        clerkId: true,
      },
    });

    if (!user) {
      // Valid Clerk token but no matching user in our DB yet.
      // This happens if the webhook hasn't fired/processed yet.
      throw new HttpError(403, 'User account not fully initialized', 'USER_NOT_FOUND');
    }

    // 3. Attach the internal user to the request
    req.user = user;
    
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Optional authentication that hydrates req.user if a token is present,
 * but allows the request to proceed anonymously if not.
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.auth?.userId) {
      return next();
    }

    const clerkId = req.auth.userId;

    const user = await prisma.user.findUnique({
      where: { clerkId },
      select: {
        id: true,
        email: true,
        role: true,
        clerkId: true,
      },
    });

    if (user) {
      req.user = user;
    }

    next();
  } catch (error) {
    // In optional auth, errors shouldn't block the request, just proceed as anonymous
    next();
  }
}

/**
 * Enforces that the authenticated user has a specific role.
 * Must be used AFTER requireAuth.
 */
export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (!req.user) {
        throw new HttpError(401, 'Authentication required', 'AUTH_REQUIRED');
      }

      if (!roles.includes(req.user.role)) {
        throw new HttpError(403, 'Insufficient permissions', 'INSUFFICIENT_ROLE');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

