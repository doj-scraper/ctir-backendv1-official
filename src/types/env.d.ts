declare global {
  namespace NodeJS {
    interface ProcessEnv {
      PORT?: string;
      NODE_ENV?: 'development' | 'production' | 'test';
      DATABASE_URL: string;
      DIRECT_URL?: string;
      REDIS_URL?: string;
      STRIPE_SECRET_KEY?: string;
      STRIPE_WEBHOOK_SECRET?: string;
      JWT_SECRET: string;
      JWT_EXPIRES_IN?: string;
      CORS_ORIGIN?: string;
    }
  }
}

export {};
