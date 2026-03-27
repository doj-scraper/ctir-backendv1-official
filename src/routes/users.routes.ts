import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../lib/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { UserService } from '../services/user.service.js';

const router = Router();
const userService = new UserService();

const updateProfileSchema = z.object({
  name: z.string().trim().max(120).optional(),
  company: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
});

type UpdateProfileBody = z.infer<typeof updateProfileSchema>;

function getAuthenticatedUserId(req: Request): string {
  const userId = req.user?.id;

  if (!userId) {
    throw new HttpError(401, 'Authentication required', 'AUTH_REQUIRED');
  }

  return userId;
}

async function getProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const profile = await userService.getProfile(getAuthenticatedUserId(req));
    res.status(200).json({
      success: true,
      data: profile,
    });
  } catch (error) {
    next(error);
  }
}

async function updateProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const profile = await userService.updateProfile(
      getAuthenticatedUserId(req),
      req.body as UpdateProfileBody
    );
    res.status(200).json({
      success: true,
      data: profile,
    });
  } catch (error) {
    next(error);
  }
}

router.use(requireAuth);

router.get('/profile', getProfile);
router.put('/profile', validate(updateProfileSchema, 'body'), updateProfile);

export default router;
