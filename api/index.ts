/**
 * Vercel serverless entry point.
 * Exports the Express app as a default export so @vercel/node can wrap it
 * as a serverless function without calling app.listen().
 */
import { createApp } from '../src/app.js';

export default createApp();
