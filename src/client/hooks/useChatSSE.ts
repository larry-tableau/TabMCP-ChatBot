/**
 * useChatSSE hook
 * Phase 5, Task 6: Hook for POST /api/chat SSE streaming
 * 
 * This hook handles:
 * - POST-based SSE streaming (using fetch with ReadableStream)
 * - SSE event parsing and state management
 * - Progress phase tracking for ProgressIndicator
 * - Answer chunk accumulation
 * - Error handling
 * 
 * Unlike useSSE (which uses EventSource for GET requests), this hook uses
 * fetch() with ReadableStream to support POST requests with SSE streaming.
 */

import { useState, useCallback } from 'react';
import type { ProgressPhase } from '../components/ProgressIndicator.js';
import type { ErrorData } from '../components/ErrorMessage.js';

export interface ChatRequest {
  message: string;
  datasourceLuid?: string;
  workbookId?: string;
  viewId?: string;
}

// Citation interface matching backend Citation (without result field for SSE)
export interface CitationForSSE {
  datasource: {
    name?: string;
    luid: string;
  };
  workbook?: {
    name?: string;
    id: string;
  };
  view?: {
    name?: string;
    id: string;
  };
  fields: Array<{
    name: string;
    aggregation?: string;
    role?: string;
  }>;
  filters?: Array<{
    field: string;
    type?: string;
    [key: string]: unknown;
  }>;
  queryTimestamp: string;
  tool: string;
  parameters: Record<string, unknown>;
}

export interface ChatSSEReturn {
  answer: string;
  citations: CitationForSSE[];
  progressPhase: ProgressPhase;
  error: ErrorData | null;
  isStreaming: boolean;
  sessionId: string | undefined;
  clearSession: () => void;
  sendMessage: (message: string, context?: { datasourceLuid?: string; workbookId?: string; viewId?: string }) => void;
}

/**
 * Parse SSE stream from ReadableStream
 * Handles SSE format: event: <type>\ndata: <json>\n\n
 */
async function parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (eventType: string, data: unknown) => void
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      let currentEvent: string | null = null;
      let currentData: string[] = [];

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.substring(7).trim();
        } else if (line.startsWith('data: ')) {
          currentData.push(line.substring(6));
        } else if (line === '' && currentEvent && currentData.length > 0) {
          // Empty line indicates end of event
          try {
            const data = JSON.parse(currentData.join(''));
            onEvent(currentEvent, data);
          } catch (err) {
            console.error('[useChatSSE] Error parsing SSE data:', err);
          }
          currentEvent = null;
          currentData = [];
        }
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name !== 'AbortError') {
      throw error;
    }
  }
}

/**
 * Hook for POST /api/chat SSE streaming
 * 
 * @returns ChatSSEReturn with answer, progressPhase, error, isStreaming, and sendMessage function
 */
// localStorage key for sessionId persistence
const SESSION_ID_STORAGE_KEY = 'chat_session_id';

export const useChatSSE = (): ChatSSEReturn => {
  const [answer, setAnswer] = useState<string>('');
  const [citations, setCitations] = useState<CitationForSSE[]>([]);
  const [progressPhase, setProgressPhase] = useState<ProgressPhase>(null);
  const [error, setError] = useState<ErrorData | null>(null);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  
  // Load sessionId from localStorage on initialization
  const [sessionId, setSessionId] = useState<string | undefined>(() => {
    try {
      const stored = localStorage.getItem(SESSION_ID_STORAGE_KEY);
      return stored && stored.trim().length > 0 ? stored.trim() : undefined;
    } catch {
      // localStorage may not be available (e.g., in some test environments)
      return undefined;
    }
  });

  const sendMessage = useCallback(
    async (message: string, context?: { datasourceLuid?: string; workbookId?: string; viewId?: string }) => {
      // Reset state
      setAnswer('');
      setCitations([]);
      setProgressPhase(null);
      setError(null);
      setIsStreaming(true);

      try {
        // POST to /api/chat
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message,
            sessionId,
            datasourceLuid: context?.datasourceLuid,
            workbookId: context?.workbookId,
            viewId: context?.viewId,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Read session ID from response header (before stream parsing)
        const newSessionId = response.headers.get('x-session-id');
        if (newSessionId && newSessionId.trim().length > 0) {
          const trimmedSessionId = newSessionId.trim();
          setSessionId(trimmedSessionId);
          // Persist sessionId to localStorage
          try {
            localStorage.setItem(SESSION_ID_STORAGE_KEY, trimmedSessionId);
          } catch {
            // localStorage may not be available (e.g., in some test environments)
            // Continue without persistence
          }
        }

        if (!response.body) {
          throw new Error('Response body is null');
        }

        // Parse SSE stream
        const reader = response.body.getReader();
        await parseSSEStream(reader, (eventType, data) => {
          // Handle different event types
          switch (eventType) {
            case 'reasoning_start':
              setProgressPhase('reasoning');
              break;

            case 'tool_call_start':
              setProgressPhase('tool_call');
              break;

            case 'tool_call_complete':
              // Keep progressPhase as 'tool_call' (no-op)
              break;

            case 'answer_start':
              setProgressPhase('processing');
              setAnswer(''); // Clear previous answer
              break;

            case 'answer_chunk': {
              // Accumulate answer chunks
              const chunkData = data as { text?: string };
              if (chunkData.text && typeof chunkData.text === 'string') {
                setAnswer((prev) => prev + chunkData.text);
              }
              break;
            }

            case 'answer_complete': {
              // Finalize answer and clear progress
              const completeData = data as { text?: string; citations?: CitationForSSE[] };
              if (completeData.text && typeof completeData.text === 'string') {
                setAnswer(completeData.text);
              }
              // Receive citations from answer_complete event (optional field)
              if (Array.isArray(completeData.citations)) {
                setCitations(completeData.citations);
              } else {
                setCitations([]);
              }
              setProgressPhase(null);
              setIsStreaming(false);
              break;
            }

            case 'error': {
              // Handle error event
              // SSE error event structure: { message: string, recoverySuggestions?: string[], code?: number, stack?: string, details?: unknown, timestamp: string }
              const errorData = data as { 
                message?: string; 
                error?: string; 
                recoverySuggestions?: string[];
                code?: number;
                stack?: string;
                details?: unknown;
                timestamp?: string;
              };
              
              // Use message as primary, fallback to error field
              const userMessage = errorData.message || errorData.error || 'Unknown error';
              
              // Extract error details
              let stack: string | undefined = errorData.stack;
              let code: number | undefined = errorData.code;
              
              // If stack not provided, try to parse from error string
              if (!stack && errorData.error) {
                const errorStr = errorData.error;
                // Check if error string looks like a stack trace
                if (errorStr.includes('\n') || errorStr.includes('at ') || errorStr.includes('Error:')) {
                  stack = errorStr;
                }
              }
              
              // Create ErrorData object with recovery suggestions
              const errorInfo: ErrorData = {
                message: userMessage,
                code,
                stack,
                details: errorData.details,
                recoverySuggestions: errorData.recoverySuggestions,
                timestamp: errorData.timestamp,
              };
              
              setError(errorInfo);
              setProgressPhase(null);
              setIsStreaming(false);
              break;
            }

            default:
              // Ignore unknown event types
              break;
          }
        });

        // Stream ended normally
        setIsStreaming(false);
      } catch (err) {
        // Handle connection/network errors
        const errorObj = err instanceof Error ? err : new Error('Unknown error');
        const errorInfo: ErrorData = {
          message: errorObj.message,
          stack: errorObj.stack,
        };
        setError(errorInfo);
        setProgressPhase(null);
        setIsStreaming(false);
      }
    },
    []
  );

  // Function to clear session (for new session)
  const clearSession = useCallback(() => {
    setSessionId(undefined);
    try {
      localStorage.removeItem(SESSION_ID_STORAGE_KEY);
    } catch {
      // localStorage may not be available
    }
  }, []);

  return {
    answer,
    citations,
    progressPhase,
    error,
    isStreaming,
    sessionId,
    clearSession,
    sendMessage,
  };
};

