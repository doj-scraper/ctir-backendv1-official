import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: prismaMock.prisma,
}));

describe('UserService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://celltech:celltech@localhost:5432/celltech_test';
    process.env.JWT_SECRET = 'test-secret-for-user-service';
  });

  it('returns the authenticated user profile with Clerk-ready fields', async () => {
    const createdAt = new Date('2026-03-26T12:00:00.000Z');
    const updatedAt = new Date('2026-03-26T12:10:00.000Z');
    prismaMock.prisma.user.findUnique.mockResolvedValue({
      id: 'user-123',
      clerkId: 'clerk_123',
      email: 'buyer@example.com',
      name: 'Yen',
      company: 'CellTech Repair',
      phone: '555-0101',
      role: 'BUYER',
      createdAt,
      updatedAt,
    });

    const { UserService } = await import('../services/user.service.js');
    const service = new UserService();

    const result = await service.getProfile('user-123');

    expect(result).toEqual({
      id: 'user-123',
      clerkId: 'clerk_123',
      email: 'buyer@example.com',
      name: 'Yen',
      company: 'CellTech Repair',
      phone: '555-0101',
      role: 'BUYER',
      createdAt,
      updatedAt,
    });
  });

  it('returns the persisted Clerk-linked profile when update is requested', async () => {
    const createdAt = new Date('2026-03-26T12:00:00.000Z');
    const updatedAt = new Date('2026-03-26T12:15:00.000Z');
    prismaMock.prisma.user.update.mockResolvedValue({
      id: 'user-123',
      clerkId: 'clerk_123',
      email: 'buyer@example.com',
      name: 'Yen Distributor',
      company: null,
      phone: '555-0102',
      role: 'BUYER',
      createdAt,
      updatedAt,
    });

    const { UserService } = await import('../services/user.service.js');
    const service = new UserService();

    const result = await service.updateProfile('user-123', {
      name: ' Yen Distributor ',
      company: '   ',
      phone: ' 555-0102 ',
    });

    expect(prismaMock.prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-123' },
      data: {
        name: 'Yen Distributor',
        company: null,
        phone: '555-0102',
      },
      select: {
        id: true,
        clerkId: true,
        email: true,
        name: true,
        company: true,
        phone: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    expect(result).toEqual({
      id: 'user-123',
      clerkId: 'clerk_123',
      email: 'buyer@example.com',
      name: 'Yen Distributor',
      company: undefined,
      phone: '555-0102',
      role: 'BUYER',
      createdAt,
      updatedAt,
    });
  });
});
