import { OrderStatus } from '@prisma/client';
import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../lib/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { OrderService } from '../services/order.service.js';

const router = Router();
const orderService = new OrderService();

const orderIdSchema = z
  .string({ required_error: 'Order ID is required' })
  .trim()
  .min(1, 'Order ID is required');

const paginationSchema = {
  page: z.coerce
    .number({ invalid_type_error: 'page must be a number' })
    .int('page must be a whole number')
    .positive('page must be a positive integer')
    .default(1),
  limit: z.coerce
    .number({ invalid_type_error: 'limit must be a number' })
    .int('limit must be a whole number')
    .positive('limit must be a positive integer')
    .max(100, 'limit must be at most 100')
    .default(20),
} as const;

const orderListQuerySchema = z.object({
  ...paginationSchema,
  status: z.nativeEnum(OrderStatus).optional(),
});

const orderIdParamSchema = z.object({
  id: orderIdSchema,
});

type OrderListQuery = z.infer<typeof orderListQuerySchema>;
type OrderIdParams = z.infer<typeof orderIdParamSchema>;

function getAuthenticatedUserId(req: Request): string {
  const userId = req.user?.id;

  if (!userId) {
    throw new HttpError(401, 'Authentication required', 'AUTH_REQUIRED');
  }

  return userId;
}

async function listOrders(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await orderService.listUserOrders(
      getAuthenticatedUserId(req),
      req.query as unknown as OrderListQuery
    );

    res.status(200).json({
      success: true,
      data: result.items,
      meta: result.meta,
    });
  } catch (error) {
    next(error);
  }
}

async function getOrderDetail(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params as unknown as OrderIdParams;
    const order = await orderService.getOrderDetail(getAuthenticatedUserId(req), id);

    res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    next(error);
  }
}

router.use(requireAuth);

router.get('/history', validate(orderListQuerySchema, 'query'), listOrders);
router.get('/:id/tracking', validate(orderIdParamSchema, 'params'), getOrderDetail);
router.get('/', validate(orderListQuerySchema, 'query'), listOrders);
router.get('/:id', validate(orderIdParamSchema, 'params'), getOrderDetail);

export default router;
