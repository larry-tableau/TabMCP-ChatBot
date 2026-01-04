/**
 * Error response formatting utilities
 * Provides consistent error response format across the application
 */

import { config } from '../config.js';

export interface ErrorResponse {
  error: string;
  message: string;
  path?: string;
  timestamp?: string;
  details?: unknown;
}

/**
 * Formats an error into a consistent response structure
 * @param error - The error object
 * @param path - The request path (optional)
 * @param includeDetails - Whether to include technical details (default: false, true in development)
 * @returns Formatted error response
 */
export function formatErrorResponse(
  error: unknown,
  path?: string,
  includeDetails = config.server.nodeEnv === 'development'
): ErrorResponse {
  const timestamp = new Date().toISOString();
  
  // Determine error type and message
  let errorName = 'Internal Server Error';
  let message = 'An unexpected error occurred. Please try again.';
  let details: unknown = undefined;

  if (error instanceof Error) {
    errorName = error.name;
    message = error.message;
    
    // Map common error types to user-friendly messages
    if (error.name === 'SyntaxError' || error.message.includes('JSON')) {
      errorName = 'Bad Request';
      message = 'Invalid request format. Please check your input.';
    } else if (error.name === 'ValidationError') {
      errorName = 'Bad Request';
      message = error.message || 'Invalid request data.';
    }
    
    if (includeDetails) {
      details = {
        type: error.name,
        message: error.message,
        stack: error.stack,
      };
    }
  } else if (typeof error === 'string') {
    message = error;
    if (includeDetails) {
      details = { raw: error };
    }
  } else if (includeDetails) {
    details = error;
  }

  const response: ErrorResponse = {
    error: errorName,
    message,
    timestamp,
  };

  if (path) {
    response.path = path;
  }

  if (includeDetails && details) {
    response.details = details;
  }

  return response;
}

/**
 * Creates a 404 Not Found error response
 * @param path - The requested path
 * @returns Formatted 404 error response
 */
export function createNotFoundResponse(path: string): ErrorResponse {
  return {
    error: 'Not Found',
    message: 'The requested resource was not found.',
    path,
    timestamp: new Date().toISOString(),
  };
}

