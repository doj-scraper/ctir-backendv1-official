import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { InventoryService } from '../services/inventory.service.js';

const router = Router();
const inventoryService = new InventoryService();

const skuParamsSchema = z.object({
  skuId: z
    .string({ required_error: 'skuId is required' })
    .trim()
    .min(1, 'skuId is required'),
});

const modelParamsSchema = z.object({
  modelId: z.string(),
});

const variantParamsSchema = z.object({
  variantId: z.string(),
});

const bulkCheckSchema = z.object({
  skuIds: z
    .array(z.string().trim().min(1, 'skuIds must contain non-empty strings'))
    .max(100, 'skuIds must contain at most 100 items'),
});

type SkuParams = z.infer<typeof skuParamsSchema>;
type ModelParams = z.infer<typeof modelParamsSchema>;
type VariantParams = z.infer<typeof variantParamsSchema>;
type BulkCheckBody = z.infer<typeof bulkCheckSchema>;

router.get('/', async (_req, res, next) => {
  try {
    const inventory = await inventoryService.listInventory();

    res.json({
      success: true,
      inventory,
      count: inventory.length,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:skuId/specs', validate(skuParamsSchema, 'params'), async (req, res, next) => {
  try {
    const { skuId } = req.params as unknown as SkuParams;
    const specifications = await inventoryService.getInventorySpecifications(skuId);

    if (!specifications) {
      res.status(404).json({
        success: false,
        error: 'Part not found',
      });
      return;
    }

    res.json({
      success: true,
      skuId,
      specifications,
      count: specifications.length,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/check/:skuId', validate(skuParamsSchema, 'params'), async (req, res, next) => {
  try {
    const { skuId } = req.params as unknown as SkuParams;
    const stock = await inventoryService.checkStock(skuId);

    if (!stock) {
      res.status(404).json({
        success: false,
        error: 'Inventory item not found',
      });
      return;
    }

    res.json({
      success: true,
      stock,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/bulk-check', validate(bulkCheckSchema, 'body'), async (req, res, next) => {
  try {
    const { skuIds } = req.body as BulkCheckBody;

    const results = await inventoryService.bulkCheckStock(skuIds);

    res.json({
      success: true,
      results,
      count: results.length,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/model/:modelId', validate(modelParamsSchema, 'params'), async (req, res, next) => {
  try {
    const { modelId } = req.params as unknown as ModelParams;
    const parts = await inventoryService.getInventoryByModel(modelId);

    res.json({
      success: true,
      parts,
      count: parts.length,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/variants/:variantId/parts', validate(variantParamsSchema, 'params'), async (req, res, next) => {
  try {
    const { variantId } = req.params as unknown as VariantParams;
    const parts = await inventoryService.getInventoryByVariant(variantId);

    res.json({
      success: true,
      parts,
      count: parts.length,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:skuId', validate(skuParamsSchema, 'params'), async (req, res, next) => {
  try {
    const { skuId } = req.params as unknown as SkuParams;
    const part = await inventoryService.getInventoryPart(skuId);

    if (!part) {
      res.status(404).json({
        success: false,
        error: 'Part not found',
      });
      return;
    }

    res.json({
      success: true,
      part,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
