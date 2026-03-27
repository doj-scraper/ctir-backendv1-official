import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  prisma: {
    quoteRequest: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: prismaMock.prisma,
}));

vi.mock('../lib/logger.js', () => ({
  logger: loggerMock,
}));

describe('QuoteService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://celltech:celltech@localhost:5432/celltech_test';
    process.env.JWT_SECRET = 'test-secret-for-quote-service';
  });

  it('persists quote requests durably through Prisma with optional user ownership', async () => {
    const submittedAt = new Date('2026-03-26T12:00:00.000Z');
    const updatedAt = new Date('2026-03-26T12:00:00.000Z');

    prismaMock.prisma.quoteRequest.create.mockResolvedValue({
      id: 'quote_1',
      userId: 'user-123',
      status: 'RECEIVED',
      email: 'buyer@example.com',
      company: 'CellTech Repair',
      contactName: 'Yen',
      phone: '555-0101',
      notes: 'Need screens',
      submittedAt,
      updatedAt,
      items: [
        {
          skuId: 'BAT-IP15',
          quantity: 10,
          note: null,
        },
      ],
    });

    const { QuoteService } = await import('../services/quote.service.js');
    const service = new QuoteService();

    const result = await service.createQuoteRequest({
      email: 'Buyer@Example.com ',
      company: ' CellTech Repair ',
      contactName: ' Yen ',
      phone: ' 555-0101 ',
      notes: ' Need screens ',
      items: [
        { skuId: ' BAT-IP15 ', quantity: 10 },
      ],
    }, 'user-123');

    expect(prismaMock.prisma.quoteRequest.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-123',
        email: 'buyer@example.com',
        company: 'CellTech Repair',
        contactName: 'Yen',
        phone: '555-0101',
        notes: 'Need screens',
        items: {
          create: [
            {
              skuId: 'BAT-IP15',
              quantity: 10,
              note: undefined,
            },
          ],
        },
      },
      include: {
        items: {
          orderBy: {
            id: 'asc',
          },
          select: {
            skuId: true,
            quantity: true,
            note: true,
          },
        },
      },
    });

    expect(result).toEqual({
      quoteRequestId: 'quote_1',
      userId: 'user-123',
      status: 'RECEIVED',
      email: 'buyer@example.com',
      company: 'CellTech Repair',
      contactName: 'Yen',
      phone: '555-0101',
      notes: 'Need screens',
      items: [
        {
          skuId: 'BAT-IP15',
          quantity: 10,
          note: undefined,
        },
      ],
      submittedAt,
      updatedAt,
    });
  });

  it('loads persisted quote requests by id', async () => {
    const submittedAt = new Date('2026-03-26T12:00:00.000Z');
    const updatedAt = new Date('2026-03-26T12:00:00.000Z');
    prismaMock.prisma.quoteRequest.findUnique.mockResolvedValue({
      id: 'quote_1',
      userId: null,
      status: 'RECEIVED',
      email: 'buyer@example.com',
      company: null,
      contactName: null,
      phone: null,
      notes: 'Need screens',
      submittedAt,
      updatedAt,
      items: [],
    });

    const { QuoteService } = await import('../services/quote.service.js');
    const service = new QuoteService();

    const result = await service.getQuoteRequest('quote_1');

    expect(prismaMock.prisma.quoteRequest.findUnique).toHaveBeenCalledWith({
      where: { id: 'quote_1' },
      include: {
        items: {
          orderBy: {
            id: 'asc',
          },
          select: {
            skuId: true,
            quantity: true,
            note: true,
          },
        },
      },
    });

    expect(result).toEqual({
      quoteRequestId: 'quote_1',
      userId: undefined,
      status: 'RECEIVED',
      email: 'buyer@example.com',
      company: undefined,
      contactName: undefined,
      phone: undefined,
      notes: 'Need screens',
      items: [],
      submittedAt,
      updatedAt,
    });
  });
});
