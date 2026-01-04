/**
 * ErrorMessage component
 * Phase 5, Task 7: Error message display with technical details toggle
 * 
 * This component handles:
 * - Displaying user-friendly error messages by default
 * - Providing UI option to show/hide technical details
 * - Displaying MCP error codes, stack traces, and technical debugging information
 * - Maintaining clean default UX while providing troubleshooting capability
 */

import React, { useState } from 'react';
import './ErrorMessage.css';

export interface ErrorData {
  message: string;
  code?: number;
  stack?: string;
  details?: unknown;
  timestamp?: string;
  recoverySuggestions?: string[];
}

export interface ErrorMessageProps {
  error: Error | ErrorData;
  timestamp?: string;
  onRetry?: () => void; // Optional, for future use
}

/**
 * Normalize error data from Error object or ErrorData
 */
function normalizeErrorData(error: Error | ErrorData): ErrorData {
  if (error instanceof Error) {
    // Extract from Error object
    const mcpError = error as Error & { code?: number; data?: unknown; isMcpError?: true };
    return {
      message: error.message,
      code: mcpError.code,
      stack: error.stack,
      details: mcpError.data,
    };
  } else {
    // Use ErrorData as-is
    return error;
  }
}

/**
 * Get MCP error code description
 */
function getMCPErrorCodeDescription(code: number): string {
  // Common MCP error codes (JSON-RPC 2.0)
  const codeMap: Record<string, string> = {
    '-32700': 'Parse Error',
    '-32600': 'Invalid Request',
    '-32601': 'Method Not Found',
    '-32602': 'Invalid Params',
    '-32603': 'Internal Error',
    '-32000': 'Server Error',
    '-32001': 'Server Not Initialized',
    '-32002': 'Unknown Error Code',
    '-32003': 'Invalid Request',
    '-32004': 'Request Failed',
    '-32005': 'Request Cancelled',
    '-32099': 'Server Error End',
  };
  const codeStr = String(code);
  return codeMap[codeStr] || 'Unknown Error';
}

/**
 * Format technical details for display
 */
function formatTechnicalDetails(data: unknown): string {
  if (data === null || data === undefined) {
    return '';
  }
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

/**
 * Redact sensitive information from text
 * Removes common patterns that might contain tokens/secrets
 */
function redactSensitiveInfo(text: string): string {
  // Redact common token patterns (API keys, tokens, etc.)
  // This is a basic implementation - can be enhanced
  return text
    .replace(/\b[A-Za-z0-9]{32,}\b/g, '[REDACTED]') // Long alphanumeric strings (potential tokens)
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+/gi, 'Bearer [REDACTED]') // Bearer tokens
    .replace(/api[_-]?key[=:]\s*[A-Za-z0-9\-._~+/]+/gi, 'api_key=[REDACTED]') // API keys
    .replace(/token[=:]\s*[A-Za-z0-9\-._~+/]+/gi, 'token=[REDACTED]'); // Tokens
}

const ErrorMessage: React.FC<ErrorMessageProps> = ({ error, timestamp }) => {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState<boolean>(false);

  // Normalize error data
  const errorData = normalizeErrorData(error);

  // Check if technical details are available
  const hasTechnicalDetails = !!(errorData.code || errorData.stack || errorData.details);

  // Toggle technical details visibility
  const toggleTechnicalDetails = () => {
    setShowTechnicalDetails((prev) => !prev);
  };

  return (
    <div className="error-message">
      <div className="error-message-content">
        <div className="error-message-text">{errorData.message}</div>
        {errorData.recoverySuggestions && errorData.recoverySuggestions.length > 0 && (
          <div className="error-message-recovery">
            <div className="error-message-recovery-label">Suggestions:</div>
            <ul className="error-message-recovery-list">
              {errorData.recoverySuggestions.map((suggestion, index) => (
                <li key={index}>{suggestion}</li>
              ))}
            </ul>
          </div>
        )}
        {hasTechnicalDetails && (
          <button
            type="button"
            className="error-message-toggle"
            onClick={toggleTechnicalDetails}
            aria-expanded={showTechnicalDetails}
          >
            {showTechnicalDetails ? 'Hide technical details' : 'Show technical details'}
          </button>
        )}
      </div>
      {showTechnicalDetails && hasTechnicalDetails && (
        <div className="error-message-technical">
          {errorData.code !== undefined && (
            <div className="error-message-technical-section">
              <div className="error-message-technical-label">Error Code:</div>
              <div className="error-message-technical-value">
                {errorData.code} ({getMCPErrorCodeDescription(errorData.code)})
              </div>
            </div>
          )}
          {errorData.stack && (
            <div className="error-message-technical-section">
              <div className="error-message-technical-label">Stack Trace:</div>
              <pre className="error-message-technical-value error-message-stack">
                {redactSensitiveInfo(errorData.stack)}
              </pre>
            </div>
          )}
          {errorData.details !== undefined && errorData.details !== null && (
            <div className="error-message-technical-section">
              <div className="error-message-technical-label">Technical Details:</div>
              <pre className="error-message-technical-value error-message-details">
                {redactSensitiveInfo(formatTechnicalDetails(errorData.details))}
              </pre>
            </div>
          )}
          {timestamp && (
            <div className="error-message-technical-section">
              <div className="error-message-technical-label">Timestamp:</div>
              <div className="error-message-technical-value">{timestamp}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ErrorMessage;

