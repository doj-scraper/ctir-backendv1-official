import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { env } from '../config/env.js';
import { logger } from './logger.js';

declare global {
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const isNeon = env.DATABASE_URL.includes('neon.tech');

  if (isNeon) {
    const connectionString = env.DIRECT_URL || env.DATABASE_URL;
    const adapter = new PrismaNeon({ connectionString });

    logger.info('Initializing Prisma with Neon serverless adapter');
    return new PrismaClient({ adapter });
  }

  logger.info('Initializing standard Prisma client');
  return new PrismaClient({
    log: env.NODE_ENV === 'development' 
      ? ['query', 'error', 'warn'] 
      : ['error'],
  });
}

export const prisma = global.__prisma || createPrismaClient();

if (env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}
