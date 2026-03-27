import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/auth.js';

export type UserProfileDto = {
  id: string;
  clerkId?: string;
  email: string;
  name?: string;
  company?: string;
  phone?: string;
  role: 'BUYER' | 'ADMIN';
  createdAt: Date;
  updatedAt: Date;
};

export type UpdateUserProfileInput = {
  name?: string;
  company?: string;
  phone?: string;
};

const profileSelect = {
  id: true,
  clerkId: true,
  email: true,
  name: true,
  company: true,
  phone: true,
  role: true,
  createdAt: true,
  updatedAt: true,
} as const;

type UserProfileRecord = {
  id: string;
  clerkId: string;
  email: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  role: 'BUYER' | 'ADMIN';
  createdAt: Date;
  updatedAt: Date;
};

function normalizeOptionalProfileField(value: string | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function mapUserProfile(user: UserProfileRecord): UserProfileDto {
  return {
    id: user.id,
    clerkId: user.clerkId,
    email: user.email,
    name: user.name ?? undefined,
    company: user.company ?? undefined,
    phone: user.phone ?? undefined,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export class UserService {
  async getProfile(userId: string): Promise<UserProfileDto> {
    const user = await (prisma as any).user.findUnique({
      where: { id: userId },
      select: profileSelect as any,
    } as any);

    if (!user) {
      throw new HttpError(404, 'User not found', 'USER_NOT_FOUND');
    }

    return mapUserProfile(user);
  }

  async updateProfile(userId: string, input: UpdateUserProfileInput): Promise<UserProfileDto> {
    const data = {
      ...(input.name !== undefined ? { name: normalizeOptionalProfileField(input.name) } : {}),
      ...(input.company !== undefined ? { company: normalizeOptionalProfileField(input.company) } : {}),
      ...(input.phone !== undefined ? { phone: normalizeOptionalProfileField(input.phone) } : {}),
    };

    const user = await (prisma as any).user.update({
      where: { id: userId },
      data,
      select: profileSelect as any,
    } as any);

    return mapUserProfile(user);
  }
}
