import { HttpError } from '../lib/auth.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

export type QuoteStatus = 'RECEIVED' | 'REVIEWING' | 'RESPONDED' | 'CLOSED';

export type QuoteRequestInput = {
  email: string;
  company?: string;
  contactName?: string;
  phone?: string;
  notes: string;
  items?: Array<{
    skuId?: string;
    quantity?: number;
    note?: string;
  }>;
};

export type QuoteRequestDto = {
  quoteRequestId: string;
  userId?: string;
  status: QuoteStatus;
  email: string;
  company?: string;
  contactName?: string;
  phone?: string;
  notes: string;
  items: Array<{
    skuId?: string;
    quantity?: number;
    note?: string;
  }>;
  submittedAt: Date;
  updatedAt: Date;
};

const quoteRequestInclude = {
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
} as const;

type QuoteRequestRecord = {
  id: string;
  userId: string | null;
  status: QuoteStatus;
  email: string;
  company: string | null;
  contactName: string | null;
  phone: string | null;
  notes: string;
  submittedAt: Date;
  updatedAt: Date;
  items: Array<{
    skuId: string | null;
    quantity: number | null;
    note: string | null;
  }>;
};

function normalizeOptionalString(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function mapQuoteRequest(quoteRequest: QuoteRequestRecord): QuoteRequestDto {
  return {
    quoteRequestId: quoteRequest.id,
    userId: quoteRequest.userId ?? undefined,
    status: quoteRequest.status,
    email: quoteRequest.email,
    company: quoteRequest.company ?? undefined,
    contactName: quoteRequest.contactName ?? undefined,
    phone: quoteRequest.phone ?? undefined,
    notes: quoteRequest.notes,
    items: quoteRequest.items.map((item) => ({
      skuId: item.skuId ?? undefined,
      quantity: item.quantity ?? undefined,
      note: item.note ?? undefined,
    })),
    submittedAt: quoteRequest.submittedAt,
    updatedAt: quoteRequest.updatedAt,
  };
}

export class QuoteService {
  async createQuoteRequest(input: QuoteRequestInput, userId?: string): Promise<QuoteRequestDto> {
    const createdQuoteRequest = await (prisma as any).quoteRequest.create({
      data: {
        userId,
        email: input.email.trim().toLowerCase(),
        company: normalizeOptionalString(input.company),
        contactName: normalizeOptionalString(input.contactName),
        phone: normalizeOptionalString(input.phone),
        notes: input.notes.trim(),
        items: {
          create: (input.items ?? []).map((item) => ({
            skuId: normalizeOptionalString(item.skuId),
            quantity: item.quantity,
            note: normalizeOptionalString(item.note),
          })),
        },
      },
      include: quoteRequestInclude,
    } as any) as QuoteRequestRecord;

    logger.info(
      {
        quoteRequestId: createdQuoteRequest.id,
        userId,
        email: createdQuoteRequest.email,
        company: createdQuoteRequest.company,
        itemCount: createdQuoteRequest.items.length,
      },
      'Quote request received'
    );

    return mapQuoteRequest(createdQuoteRequest);
  }

  async getQuoteRequest(quoteRequestId: string): Promise<QuoteRequestDto> {
    const quoteRequest = await (prisma as any).quoteRequest.findUnique({
      where: { id: quoteRequestId },
      include: quoteRequestInclude,
    } as any) as QuoteRequestRecord | null;

    if (!quoteRequest) {
      throw new HttpError(404, 'Quote request not found', 'QUOTE_REQUEST_NOT_FOUND');
    }

    return mapQuoteRequest(quoteRequest);
  }
}
