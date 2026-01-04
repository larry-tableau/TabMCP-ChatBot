/**
 * Request logging middleware
 * Logs all incoming requests in structured format for demo purposes
 * Format: [timestamp] METHOD /path - IP
 */

import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to log incoming requests
 * Logs: timestamp, HTTP method, path, and client IP
 */
export function requestLogger(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const timestamp = new Date().toISOString();
  const method = req.method;
  const path = req.path;
  const ip = req.ip || req.socket.remoteAddress || 'unknown';

  // Format: [timestamp] METHOD /path - IP
  console.log(`[${timestamp}] ${method} ${path} - ${ip}`);

  next();
}

