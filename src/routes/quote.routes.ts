import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { QuoteService } from '../services/quote.service.js';

const router = Router();
const quoteService = new QuoteService();

const quoteItemSchema = z.object({
  skuId: z.string().trim().min(1).optional(),
  quantity: z.coerce.number().int().positive().optional(),
  note: z.string().trim().min(1).max(500).optional(),
}).refine((value) => Boolean(value.skuId || value.note), {
  message: 'Each quote item must include a skuId or note',
});

const createQuoteSchema = z.object({
  email: z.string().trim().email(),
  company: z.string().trim().min(1).max(120).optional(),
  contactName: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().min(1).max(40).optional(),
  notes: z.string().trim().min(1).max(5000),
  items: z.array(quoteItemSchema).max(100).optional(),
});

const quoteParamsSchema = z.object({
  quoteRequestId: z.string().trim().min(1, 'quoteRequestId is required'),
});

type CreateQuoteBody = z.infer<typeof createQuoteSchema>;
type QuoteParams = z.infer<typeof quoteParamsSchema>;

router.post('/', optionalAuth, validate(createQuoteSchema, 'body'), async (req, res, next) => {
  try {
    const quoteRequest = await quoteService.createQuoteRequest(
      req.body as CreateQuoteBody,
      req.user?.id
    );

    res.status(201).json({
      success: true,
      data: quoteRequest,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:quoteRequestId', validate(quoteParamsSchema, 'params'), async (req, res, next) => {
  try {
    const { quoteRequestId } = req.params as unknown as QuoteParams;
    const quoteRequest = await quoteService.getQuoteRequest(quoteRequestId);

    res.status(200).json({
      success: true,
      data: quoteRequest,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
