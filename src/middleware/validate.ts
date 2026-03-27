import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

export type ValidationTarget = 'body' | 'query' | 'params' | 'request';

function getDataToValidate(req: Request, target: ValidationTarget) {
  switch (target) {
    case 'body':
      return req.body;
    case 'query':
      return req.query;
    case 'params':
      return req.params;
    case 'request':
    default:
      return {
        ...req.body,
        ...req.query,
        ...req.params,
      };
  }
}

export function validate(schema: ZodSchema, target: ValidationTarget = 'request') {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const validated = await schema.parseAsync(getDataToValidate(req, target));

      if (target === 'body' || target === 'request') {
        req.body = validated;
      } else if (target === 'query') {
        req.query = validated as Request['query'];
      } else {
        req.params = validated as Request['params'];
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(error);
      } else {
        next(new Error('Validation error'));
      }
    }
  };
}
