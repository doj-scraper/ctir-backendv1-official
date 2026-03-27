import type { ClerkAuth, AuthenticatedRequestUser } from '../lib/auth.js';

declare global {
  namespace Express {
    interface Request {
      auth?: ClerkAuth;
      user?: AuthenticatedRequestUser;
      accessToken?: string;
    }
  }
}

export {};
