import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../lib/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { CartService, type AddOrUpdateCartItemInput, type CartSummaryDto, type CartValidationDto } from '../services/cart.service.js';

const router = Router();
const cartService = new CartService();

const skuIdSchema = z
  .string({ required_error: 'skuId is required' })
  .trim()
  .min(1, 'skuId is required');

const quantitySchema = z.coerce
  .number({ invalid_type_error: 'quantity must be a number' })
  .int('quantity must be a whole number')
  .positive('quantity must be a positive integer');

const addCartItemSchema = z.object({
  skuId: skuIdSchema,
  quantity: quantitySchema,
});

const updateCartItemSchema = z.object({
  quantity: quantitySchema,
});

const cartItemParamSchema = z.object({
  skuId: skuIdSchema,
});

const cartSyncSchema = z.object({
  items: z.array(addCartItemSchema).max(250, 'items must contain at most 250 entries'),
});

const validateCartSchema = z.preprocess(
  (value) => value ?? {},
  z.object({
    items: z.array(addCartItemSchema).max(250, 'items must contain at most 250 entries').optional(),
  })
);

type AddCartItemBody = z.infer<typeof addCartItemSchema>;
type UpdateCartItemBody = z.infer<typeof updateCartItemSchema>;
type CartItemParams = z.infer<typeof cartItemParamSchema>;
type CartSyncBody = z.infer<typeof cartSyncSchema>;
type ValidateCartBody = z.infer<typeof validateCartSchema>;

function getAuthenticatedUserId(req: Request): string {
  const userId = req.user?.id;

  if (!userId) {
    throw new HttpError(401, 'Authentication required', 'AUTH_REQUIRED');
  }

  return userId;
}

function sendCartResponse(res: Response, cart: CartSummaryDto): void {
  res.status(200).json({
    success: true,
    ...cart,
  });
}

function sendCartValidationResponse(res: Response, validation: CartValidationDto): void {
  res.status(200).json({
    success: true,
    data: validation,
  });
}

async function getCart(req: Request, res: Response, next: NextFunction) {
  try {
    const cart = await cartService.getCart(getAuthenticatedUserId(req));
    sendCartResponse(res, cart);
  } catch (error) {
    next(error);
  }
}

async function addCartItem(req: Request, res: Response, next: NextFunction) {
  try {
    const input = req.body as AddCartItemBody;
    const cart = await cartService.addOrUpdateItem(getAuthenticatedUserId(req), input);
    sendCartResponse(res, cart);
  } catch (error) {
    next(error);
  }
}

async function updateCartItem(req: Request, res: Response, next: NextFunction) {
  try {
    const { skuId } = req.params as unknown as CartItemParams;
    const { quantity } = req.body as UpdateCartItemBody;
    const cart = await cartService.updateItemQuantity(getAuthenticatedUserId(req), skuId, quantity);
    sendCartResponse(res, cart);
  } catch (error) {
    next(error);
  }
}

async function removeCartItem(req: Request, res: Response, next: NextFunction) {
  try {
    const { skuId } = req.params as unknown as CartItemParams;
    const cart = await cartService.removeItem(getAuthenticatedUserId(req), skuId);
    sendCartResponse(res, cart);
  } catch (error) {
    next(error);
  }
}

async function clearCart(req: Request, res: Response, next: NextFunction) {
  try {
    const cart = await cartService.clearCart(getAuthenticatedUserId(req));
    sendCartResponse(res, cart);
  } catch (error) {
    next(error);
  }
}

async function syncCart(req: Request, res: Response, next: NextFunction) {
  try {
    const input = req.body as CartSyncBody;
    const cart = await cartService.syncCart(
      getAuthenticatedUserId(req),
      input.items as AddOrUpdateCartItemInput[]
    );
    sendCartResponse(res, cart);
  } catch (error) {
    next(error);
  }
}

async function validateCart(req: Request, res: Response, next: NextFunction) {
  try {
    const input = req.body as ValidateCartBody;
    const validation = await cartService.validateCart(
      getAuthenticatedUserId(req),
      input.items as AddOrUpdateCartItemInput[] | undefined
    );
    sendCartValidationResponse(res, validation);
  } catch (error) {
    next(error);
  }
}

router.use(requireAuth);

router.get('/', getCart);
router.post('/', validate(addCartItemSchema, 'body'), addCartItem);
router.post('/items', validate(addCartItemSchema, 'body'), addCartItem);
router.post('/sync', validate(cartSyncSchema, 'body'), syncCart);
router.put('/sync', validate(cartSyncSchema, 'body'), syncCart);
router.post('/validate', validate(validateCartSchema, 'body'), validateCart);
router.patch('/:skuId', validate(cartItemParamSchema, 'params'), validate(updateCartItemSchema, 'body'), updateCartItem);
router.patch('/items/:skuId', validate(cartItemParamSchema, 'params'), validate(updateCartItemSchema, 'body'), updateCartItem);
router.delete('/:skuId', validate(cartItemParamSchema, 'params'), removeCartItem);
router.delete('/items/:skuId', validate(cartItemParamSchema, 'params'), removeCartItem);
router.delete('/', clearCart);

export default router;
