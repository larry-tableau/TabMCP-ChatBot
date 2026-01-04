/**
 * Error handling middleware
 * Catches all unhandled errors and formats them consistently
 */

import { Request, Response, NextFunction } from 'express';
import { formatErrorResponse } from '../utils/errors.js';
import { config } from '../config.js';

/**
 * Express error handling middleware (4-parameter function)
 * Catches all unhandled errors and returns consistent error responses
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const includeDetails = config.server.nodeEnv === 'development';
  const errorResponse = formatErrorResponse(error, req.path, includeDetails);

  // Determine HTTP status code
  let statusCode = 500;
  if (error instanceof Error) {
    if (error.name === 'SyntaxError' || error.message.includes('JSON')) {
      statusCode = 400;
    } else if (error.name === 'ValidationError') {
      statusCode = 400;
    }
  }

  // Log error server-side
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ERROR: ${errorResponse.message} - ${error instanceof Error ? error.stack : String(error)}`);

  // Send error response
  res.status(statusCode).json(errorResponse);
}

