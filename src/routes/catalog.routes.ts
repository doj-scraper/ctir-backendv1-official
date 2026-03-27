import { Router } from 'express';
import { z } from 'zod';
import { CatalogService } from '../services/catalog.service.js';
import { validate } from '../middleware/validate.js';

const router = Router();
const catalogService = new CatalogService();

const modelsQuerySchema = z.object({
  brandId: z.string().optional(),
});

const brandParamsSchema = z.object({
  brandId: z.string(),
});

const partsQuerySchema = z.object({
  device: z
    .string({ required_error: 'device is required' })
    .trim()
    .min(1, 'device is required'),
});

const variantParamsSchema = z.object({
  variantId: z.string(),
});

type ModelsQuery = z.infer<typeof modelsQuerySchema>;
type BrandParams = z.infer<typeof brandParamsSchema>;
type PartsQuery = z.infer<typeof partsQuerySchema>;
type VariantParams = z.infer<typeof variantParamsSchema>;

router.get('/brands', async (_req, res, next) => {
  try {
    const brands = await catalogService.getBrands();
    res.json({
      success: true,
      brands,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/models', validate(modelsQuerySchema, 'query'), async (req, res, next) => {
  try {
    const { brandId } = req.query as ModelsQuery;
    const models = await catalogService.getModels(brandId);

    res.json({
      success: true,
      models,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/brands/:brandId/models', validate(brandParamsSchema, 'params'), async (req, res, next) => {
  try {
    const { brandId } = req.params as unknown as BrandParams;
    const models = await catalogService.getModels(brandId);

    res.json({
      success: true,
      models,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/parts', validate(partsQuerySchema, 'query'), async (req, res, next) => {
  try {
    const { device } = req.query as PartsQuery;
    const parts = await catalogService.searchParts(device);

    res.json({
      success: true,
      parts,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/variants/:variantId/parts', validate(variantParamsSchema, 'params'), async (req, res, next) => {
  try {
    const { variantId } = req.params as unknown as VariantParams;
    const parts = await catalogService.getPartsForVariant(variantId);

    res.json({
      success: true,
      parts,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/hierarchy', async (_req, res, next) => {
  try {
    const hierarchy = await catalogService.getHierarchy();

    res.json({
      success: true,
      hierarchy,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
