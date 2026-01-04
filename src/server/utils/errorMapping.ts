/**
 * Error Mapping and Recovery Suggestions
 * Phase 8, Tasks 1, 2: Comprehensive error handling with recovery suggestions
 * 
 * This file handles:
 * - Mapping MCP/LLM/tool errors to user-friendly messages
 * - Providing recovery suggestions for common error types
 * - Preserving technical details for debugging
 * - Structured error categorization
 */

import type { MCPError } from '../mcpClient.js';
import type { LLMError } from '../llmClient.js';

/**
 * Error category for structured logging
 */
export type ErrorCategory = 
  | 'MCP_INVALID_PARAMS'
  | 'MCP_NO_DATA'
  | 'MCP_NETWORK'
  | 'MCP_TIMEOUT'
  | 'MCP_SERVER_ERROR'
  | 'LLM_REQUEST_FAILED'
  | 'LLM_TIMEOUT'
  | 'LLM_NETWORK'
  | 'TOOL_EXECUTION_FAILED'
  | 'UNKNOWN';

/**
 * User-friendly error message with recovery suggestions
 */
export interface UserFriendlyError {
  /** User-friendly error message */
  message: string;
  /** Recovery suggestions (array of actionable steps) */
  recoverySuggestions: string[];
  /** Error category for logging */
  category: ErrorCategory;
  /** Technical details (preserved for debugging) */
  technicalDetails?: {
    code?: number;
    message?: string;
    stack?: string;
    details?: unknown;
    type?: string;
  };
}

/**
 * Map MCP error to user-friendly message with recovery suggestions
 */
export function mapMCPError(error: MCPError): UserFriendlyError {
  const code = error.code;
  const message = error.message;
  
  // MCP Invalid Params (-32602)
  if (code === -32602) {
    return {
      message: 'The query parameters are invalid. Please check your field names, filters, or date ranges.',
      recoverySuggestions: [
        'Check that all field names match the datasource metadata',
        'Verify filter values are in the correct format',
        'Try removing unsupported fields or filters',
        'Check date range format (use YYYY-MM-DD or ISO 8601 format)',
      ],
      category: 'MCP_INVALID_PARAMS',
      technicalDetails: {
        code,
        message,
        stack: error.stack,
        details: error.data,
        type: 'MCPError',
      },
    };
  }
  
  // MCP No Data (empty results or no matching data)
  if (message.includes('no data') || message.includes('empty') || message.includes('no results')) {
    return {
      message: 'No data found matching your query. Try adjusting your filters or date range.',
      recoverySuggestions: [
        'Try a different date range',
        'Remove or adjust filters that might be too restrictive',
        'Check that field names are correct',
        'Try a broader query to see available data',
      ],
      category: 'MCP_NO_DATA',
      technicalDetails: {
        code,
        message,
        stack: error.stack,
        details: error.data,
        type: 'MCPError',
      },
    };
  }
  
  // MCP Timeout
  if (message.includes('timeout') || message.includes('timed out')) {
    return {
      message: 'The request took too long to complete. Please try again with a simpler query.',
      recoverySuggestions: [
        'Try a simpler query with fewer fields or filters',
        'Reduce the date range',
        'Wait a moment and try again',
        'Check your network connection',
      ],
      category: 'MCP_TIMEOUT',
      technicalDetails: {
        code,
        message,
        stack: error.stack,
        details: error.data,
        type: 'MCPError',
      },
    };
  }
  
  // MCP Network Error
  if (message.includes('network') || message.includes('connection') || message.includes('fetch')) {
    return {
      message: 'Network error occurred. Please check your connection and try again.',
      recoverySuggestions: [
        'Check your internet connection',
        'Wait a moment and try again',
        'Verify the service is available',
      ],
      category: 'MCP_NETWORK',
      technicalDetails: {
        code,
        message,
        stack: error.stack,
        details: error.data,
        type: 'MCPError',
      },
    };
  }
  
  // MCP Server Error (5xx or -32603)
  if (code === -32603 || code === -32000 || (code && code >= 500 && code < 600)) {
    return {
      message: 'A server error occurred. Please try again in a moment.',
      recoverySuggestions: [
        'Wait a moment and try again',
        'Try a simpler query',
        'If the problem persists, contact support',
      ],
      category: 'MCP_SERVER_ERROR',
      technicalDetails: {
        code,
        message,
        stack: error.stack,
        details: error.data,
        type: 'MCPError',
      },
    };
  }
  
  // Generic MCP Error
  return {
    message: 'An error occurred while processing your query. Please try again.',
    recoverySuggestions: [
      'Try rephrasing your query',
      'Check that all parameters are correct',
      'Wait a moment and try again',
    ],
    category: 'MCP_INVALID_PARAMS',
    technicalDetails: {
      code,
      message,
      stack: error.stack,
      details: error.data,
      type: 'MCPError',
    },
  };
}

/**
 * Map LLM error to user-friendly message with recovery suggestions
 */
export function mapLLMError(error: LLMError): UserFriendlyError {
  const message = error.message;
  
  // LLM Timeout
  if (message.includes('timeout') || message.includes('timed out')) {
    return {
      message: 'The AI service took too long to respond. Please try again.',
      recoverySuggestions: [
        'Wait a moment and try again',
        'Try a simpler or shorter query',
        'Check your network connection',
      ],
      category: 'LLM_TIMEOUT',
      technicalDetails: {
        message,
        stack: error.stack,
        details: error.data,
        type: 'LLMError',
      },
    };
  }
  
  // LLM Network Error
  if (message.includes('network') || message.includes('connection') || message.includes('fetch')) {
    return {
      message: 'Network error connecting to AI service. Please check your connection and try again.',
      recoverySuggestions: [
        'Check your internet connection',
        'Wait a moment and try again',
        'Verify the service is available',
      ],
      category: 'LLM_NETWORK',
      technicalDetails: {
        message,
        stack: error.stack,
        details: error.data,
        type: 'LLMError',
      },
    };
  }
  
  // Generic LLM Error
  return {
    message: 'An error occurred while processing your request. Please try again.',
    recoverySuggestions: [
      'Try rephrasing your query',
      'Wait a moment and try again',
      'If the problem persists, contact support',
    ],
    category: 'LLM_REQUEST_FAILED',
    technicalDetails: {
      message,
      stack: error.stack,
      details: error.data,
      type: 'LLMError',
    },
  };
}

/**
 * Map generic error to user-friendly message with recovery suggestions
 */
export function mapGenericError(error: unknown): UserFriendlyError {
  if (error instanceof Error) {
    const message = error.message;
    
    // Network errors
    if (message.includes('network') || message.includes('connection') || message.includes('fetch')) {
      return {
        message: 'Network error occurred. Please check your connection and try again.',
        recoverySuggestions: [
          'Check your internet connection',
          'Wait a moment and try again',
          'Verify the service is available',
        ],
        category: 'MCP_NETWORK',
        technicalDetails: {
          message,
          stack: error.stack,
          type: 'Error',
        },
      };
    }
    
    // Timeout errors
    if (message.includes('timeout') || message.includes('timed out')) {
      return {
        message: 'The request took too long to complete. Please try again.',
        recoverySuggestions: [
          'Wait a moment and try again',
          'Try a simpler query',
          'Check your network connection',
        ],
        category: 'MCP_TIMEOUT',
        technicalDetails: {
          message,
          stack: error.stack,
          type: 'Error',
        },
      };
    }
    
    // Generic error
    return {
      message: 'An unexpected error occurred. Please try again.',
      recoverySuggestions: [
        'Try rephrasing your query',
        'Wait a moment and try again',
        'If the problem persists, contact support',
      ],
      category: 'UNKNOWN',
      technicalDetails: {
        message,
        stack: error.stack,
        type: 'Error',
      },
    };
  }
  
  // Unknown error type
  return {
    message: 'An unexpected error occurred. Please try again.',
    recoverySuggestions: [
      'Try rephrasing your query',
      'Wait a moment and try again',
      'If the problem persists, contact support',
    ],
    category: 'UNKNOWN',
    technicalDetails: {
      details: error,
    },
  };
}

/**
 * Map any error to user-friendly message with recovery suggestions
 * Handles MCPError, LLMError, and generic errors
 */
export function mapErrorToUserFriendly(error: unknown): UserFriendlyError {
  // Check if it's an MCPError
  if (error && typeof error === 'object' && 'isMcpError' in error && (error as MCPError).isMcpError) {
    return mapMCPError(error as MCPError);
  }
  
  // Check if it's an LLMError
  if (error && typeof error === 'object' && 'isLlmError' in error && (error as LLMError).isLlmError) {
    return mapLLMError(error as LLMError);
  }
  
  // Check if it has MCP error code (MCPError without isMcpError flag)
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code: unknown }).code === 'number') {
    const mcpError = error as MCPError;
    if (mcpError.code && mcpError.code < 0) {
      return mapMCPError(mcpError);
    }
  }
  
  // Generic error
  return mapGenericError(error);
}

// Import shared string similarity utilities
import { scoreSimilarity } from './stringSimilarity.js';

/**
 * Suggest similar field names for a given input field name
 * 
 * Compares input against candidate field names and returns up to 3 suggestions
 * with similarity score >= 0.6. Exact matches are excluded.
 * 
 * Algorithm:
 * 1. Normalize strings (lowercase, trim, collapse spaces)
 * 2. Score each candidate using: exact match (1.0), startsWith (0.8), includes (0.6), or Levenshtein ratio
 * 3. Filter candidates with score >= 0.6, exclude exact matches
 * 4. Return top 3 by score (descending)
 * 
 * @param input - Input field name to find suggestions for
 * @param candidates - Array of candidate field names to compare against
 * @returns Array of suggested field names (max 3, sorted by similarity score descending)
 * 
 * @example
 * ```typescript
 * const suggestions = suggestSimilarFields('Salez', ['Sales', 'Sales Amount', 'Profit']);
 * // Returns: ['Sales', 'Sales Amount'] (if scores >= 0.6)
 * ```
 */
export function suggestSimilarFields(input: string, candidates: string[]): string[] {
  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    return [];
  }
  
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }
  
  // Score all candidates
  const scored = candidates
    .map(candidate => ({
      candidate,
      score: scoreSimilarity(input, candidate),
    }))
    .filter(item => item.score >= 0.6 && item.score < 1.0) // Accept score >= 0.6, exclude exact matches
    .sort((a, b) => b.score - a.score) // Sort by score descending
    .slice(0, 3) // Take top 3
    .map(item => item.candidate); // Extract candidate names
  
  return scored;
}

/**
 * Log error with structured format (never logs tokens/PII)
 */
export function logError(category: ErrorCategory, error: UserFriendlyError, context?: string): void {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` [${context}]` : '';
  
  // Log error category and user-friendly message (never log tokens/PII)
  console.error(`[${timestamp}] ERROR${contextStr} [${category}]: ${error.message}`);
  
  // Log recovery suggestions in development
  if (process.env.NODE_ENV === 'development') {
    if (error.recoverySuggestions.length > 0) {
      console.error(`[${timestamp}] Recovery suggestions:`, error.recoverySuggestions);
    }
  }
  
  // Log technical details only in development (stack traces, error codes)
  if (process.env.NODE_ENV === 'development' && error.technicalDetails) {
    if (error.technicalDetails.code !== undefined) {
      console.error(`[${timestamp}] Error code: ${error.technicalDetails.code}`);
    }
    if (error.technicalDetails.stack) {
      // Redact sensitive info from stack traces
      const redactedStack = error.technicalDetails.stack
        .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+/gi, 'Bearer [REDACTED]')
        .replace(/api[_-]?key[=:]\s*[A-Za-z0-9\-._~+/]+/gi, 'api_key=[REDACTED]')
        .replace(/token[=:]\s*[A-Za-z0-9\-._~+/]+/gi, 'token=[REDACTED]');
      console.error(`[${timestamp}] Stack trace:`, redactedStack);
    }
  }
}

