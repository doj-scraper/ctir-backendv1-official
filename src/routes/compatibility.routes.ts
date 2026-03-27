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

type SkuParams = z.infer<typeof skuParamsSchema>;

router.get('/:skuId', validate(skuParamsSchema, 'params'), async (req, res, next) => {
  try {
    const { skuId } = req.params as unknown as SkuParams;
    const compatibleModels = await inventoryService.getCompatibilityModels(skuId);

    if (!compatibleModels) {
      res.status(404).json({
        success: false,
        error: 'Part not found',
      });
      return;
    }

    res.json({
      success: true,
      skuId,
      isDirectPart: compatibleModels.length <= 1,
      compatibleModels,
      count: compatibleModels.length,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
