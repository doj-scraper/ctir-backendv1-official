export class HttpError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, message: string, code: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export type AuthRole = 'BUYER' | 'ADMIN';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: AuthRole;
  clerkId: string;
  name?: string;
  company?: string;
  phone?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthSessionResult {
  user: AuthenticatedUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface ClerkAuth {
  userId: string | null;
  sessionId: string | null;
  orgId: string | null;
}

export interface AuthClaims {
  sub: string;
  userId: string;
  email: string;
  role: AuthRole;
  tokenType: 'access' | 'refresh';
}

export interface AuthenticatedRequestUser {
  id: string;
  email: string;
  role: AuthRole;
  clerkId: string;
}

export async function blacklistAccessToken(token: string): Promise<void> {
  // No-op for now as we transition to Clerk
  return Promise.resolve();
}
