/**
 * LLM Client
 * Phase 3, Task 1: LLM Gateway HTTP client implementation
 * 
 * This file handles:
 * - HTTP client for LLM Gateway using Node.js fetch API
 * - Bearer token authentication
 * - Streaming response handling (SSE)
 * - Tool-calling request format (Anthropic API compatible)
 * - Error handling (HTTP errors, network errors, JSON errors, LLM errors)
 * - Request/response logging
 * - Timeout handling
 * - Connection validation
 * 
 * CRITICAL: Never hard-code gateway URLs, auth tokens, or model names
 * Always use configuration from config.llm.*
 */

import { config } from './config.js';

/**
 * Normalize gateway URL to include /v1/messages path
 * - If URL already ends with "/v1/messages" (with or without trailing slash), use it as-is
 * - Otherwise append "/v1/messages" safely (avoid double slashes)
 * 
 * @param baseUrl - Base gateway URL from config
 * @returns Normalized URL with /v1/messages path
 */
function normaliseMessagesUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    throw new Error('Gateway URL cannot be empty');
  }

  // Remove trailing slash
  const normalized = trimmed.replace(/\/+$/, '');

  // Check if /v1/messages is already present
  if (normalized.endsWith('/v1/messages')) {
    return normalized;
  }

  // Append /v1/messages (base already has no trailing slash)
  return `${normalized}/v1/messages`;
}

/**
 * LLM Message interface (Anthropic API format)
 */
export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{
    type: 'text' | 'tool_use' | 'tool_result';
    text?: string;
    tool_use_id?: string;
    name?: string;
    input?: Record<string, unknown>;
    content?: string;
  }>;
}

/**
 * LLM Tool interface (Anthropic API format)
 */
export interface LLMTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * LLM Request Options
 */
export interface LLMRequestOptions {
  /** Request timeout in milliseconds (default: 90000) */
  timeoutMs?: number;
  /** Maximum number of tokens (optional) */
  maxTokens?: number;
  /** Temperature for response generation (optional) */
  temperature?: number;
  /** Additional request parameters */
  [key: string]: unknown;
}

/**
 * LLM Response Chunk interface (Anthropic API SSE format)
 */
export interface LLMResponseChunk {
  type:
    | 'message_start'
    | 'content_block_start'
    | 'content_block_delta'
    | 'content_block_stop'
    | 'message_delta'
    | 'message_stop'
    | 'ping';
  /** Content block index (used to associate input_json_delta chunks with tool_use blocks) */
  index?: number;
  message?: {
    id: string;
    role: string;
    content: unknown[];
  };
  content_block?: {
    type: 'text' | 'tool_use';
    text?: string;
    /** Tool use ID (Anthropic API uses 'id', but some gateways may use 'tool_use_id') */
    id?: string;
    /** Tool use ID (alternative field name for compatibility) */
    tool_use_id?: string;
    name?: string;
    input?: Record<string, unknown>;
  };
  delta?: {
    type: 'text_delta' | 'input_json_delta';
    text?: string;
    partial_json?: string;
  };
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  stop_reason?: string;
  stop_sequence?: string;
}

/**
 * LLM Error interface
 */
export interface LLMError extends Error {
  code?: number;
  type?: string;
  data?: unknown;
  isLlmError?: true;
}

/**
 * Helper to check if an error is an LLMError
 */
function isLLMError(error: unknown): error is LLMError {
  return (
    error instanceof Error &&
    'isLlmError' in error &&
    (error as LLMError).isLlmError === true
  );
}

/**
 * LLM Gateway Client
 * Handles communication with LLM Gateway via HTTP with streaming support
 * 
 * The gateway URL is normalized via `normaliseMessagesUrl()` to ensure it includes
 * the `/v1/messages` path. If the URL already ends with `/v1/messages`, it is used
 * as-is; otherwise, `/v1/messages` is appended.
 */
export class LLMClient {
  private _gatewayUrl: string;
  private _authToken: string;
  private _model: string;
  private _messagesUrl: string;
  private _defaultMaxTokens: number;

  constructor() {
    this._gatewayUrl = config.llm.gatewayUrl;
    this._authToken = config.llm.authToken;
    this._model = config.llm.model;
    // Normalize gateway URL to include /v1/messages path if not already present
    this._messagesUrl = normaliseMessagesUrl(this._gatewayUrl);
    this._defaultMaxTokens = config.llm.defaultMaxTokens;
  }

  /**
   * Get the resolved messages URL (for debugging/logging)
   */
  getMessagesUrl(): string {
    return this._messagesUrl;
  }

  /**
   * Send tool-calling request to LLM Gateway and stream responses
   * 
   * @param messages - Array of conversation messages
   * @param tools - Array of tool definitions
   * @param options - Optional request options (timeout, maxTokens, etc.)
   * @returns AsyncIterable of response chunks
   * @throws LLMError if request fails
   * 
   * @example
   * ```typescript
   * const messages: LLMMessage[] = [
   *   { role: 'user', content: 'What are the top 5 states by sales?' }
   * ];
   * 
   * const tools: LLMTool[] = [
   *   {
   *     name: 'query-datasource',
   *     description: 'Query a Tableau datasource',
   *     input_schema: {
   *       type: 'object',
   *       properties: {
   *         datasourceLuid: { type: 'string' },
   *         query: { type: 'object' }
   *       },
   *       required: ['datasourceLuid', 'query']
   *     }
   *   }
   * ];
   * 
   * const chunks = await client.streamToolCalling(messages, tools);
   * for await (const chunk of chunks) {
   *   console.log('Chunk:', chunk.type);
   *   if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
   *     process.stdout.write(chunk.delta.text);
   *   }
   * }
   * ```
   */
  async streamToolCalling(
    messages: LLMMessage[],
    tools: LLMTool[],
    options?: LLMRequestOptions
  ): Promise<AsyncIterable<LLMResponseChunk>> {
    const timeoutMs = options?.timeoutMs ?? 90000;
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Validate options.maxTokens if provided
    if (options?.maxTokens !== undefined) {
      if (!Number.isInteger(options.maxTokens)) {
        const error: LLMError = new Error(
          `Invalid maxTokens: "${options.maxTokens}". Must be an integer.`
        );
        error.code = 400;
        error.isLlmError = true;
        console.error(`[LLM] Validation Error: streamToolCalling (id: ${requestId})`, {
          field: 'maxTokens',
          value: options.maxTokens,
          error: 'Must be an integer',
        });
        throw error;
      }
      if (options.maxTokens < 1) {
        const error: LLMError = new Error(
          `Invalid maxTokens: ${options.maxTokens}. Must be >= 1.`
        );
        error.code = 400;
        error.isLlmError = true;
        console.error(`[LLM] Validation Error: streamToolCalling (id: ${requestId})`, {
          field: 'maxTokens',
          value: options.maxTokens,
          error: 'Must be >= 1',
        });
        throw error;
      }
    }

    // Validate options.temperature if provided (Anthropic API range: 0-1, but gateway may accept 0-2)
    if (options?.temperature !== undefined) {
      if (typeof options.temperature !== 'number' || isNaN(options.temperature)) {
        const error: LLMError = new Error(
          `Invalid temperature: "${options.temperature}". Must be a number.`
        );
        error.code = 400;
        error.isLlmError = true;
        console.error(`[LLM] Validation Error: streamToolCalling (id: ${requestId})`, {
          field: 'temperature',
          value: options.temperature,
          error: 'Must be a number',
        });
        throw error;
      }
      if (options.temperature < 0 || options.temperature > 2) {
        const error: LLMError = new Error(
          `Invalid temperature: ${options.temperature}. Must be between 0 and 2 (inclusive).`
        );
        error.code = 400;
        error.isLlmError = true;
        console.error(`[LLM] Validation Error: streamToolCalling (id: ${requestId})`, {
          field: 'temperature',
          value: options.temperature,
          error: 'Must be between 0 and 2 (inclusive)',
        });
        throw error;
      }
    }

    // Log request
    console.log(
      `[LLM] Request: streamToolCalling (id: ${requestId}, model: ${this._model}, messages: ${messages.length}, tools: ${tools.length})`
    );

    // Build request body
    // max_tokens is mandatory - use provided value or fall back to config default
    const maxTokens = options?.maxTokens ?? this._defaultMaxTokens;
    
    // Extract system messages and filter from messages array
    // LLM Gateway requires system content as top-level parameter, not in messages array
    const systemMessages: string[] = [];
    const filteredMessages = messages.filter((msg) => {
      if (msg.role === 'system') {
        // Collect system message content (handle both string and array content)
        if (typeof msg.content === 'string') {
          systemMessages.push(msg.content);
        } else if (Array.isArray(msg.content)) {
          // System messages with array content are not standard, but handle gracefully
          systemMessages.push(JSON.stringify(msg.content));
        }
        return false; // Filter out system message
      }
      return true; // Keep non-system messages
    });
    
    // Combine multiple system messages into single string (if any)
    const systemParam = systemMessages.length > 0 ? systemMessages.join('\n\n') : undefined;
    
    const requestBody: Record<string, unknown> = {
      model: this._model,
      messages: filteredMessages,
      stream: true,
      max_tokens: maxTokens, // Always include max_tokens (mandatory)
    };

    if (systemParam) {
      requestBody.system = systemParam;
    }

    if (tools.length > 0) {
      requestBody.tools = tools;
    }

    if (options?.temperature !== undefined) {
      requestBody.temperature = options.temperature;
    }

    // Create AbortController for timeout
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, timeoutMs);

    try {
      // Make HTTP request
      const response = await fetch(this._messagesUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream, application/json',
          'x-api-key': this._authToken, // Anthropic API format
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });
      
      // Log response details for debugging (verbose mode handled by test harness)
      if (config.server.nodeEnv === 'development') {
        console.log(`[LLM] Response details: status=${response.status}, contentType=${response.headers.get('Content-Type')}, location=${response.headers.get('Location') || 'N/A'}`);
      }

      // Handle HTTP errors
      if (!response.ok) {
        let errorText = '';
        try {
          errorText = await response.text();
        } catch {
          errorText = 'Unable to read error response';
        }

        // Clear timeout before throwing error
        clearTimeout(timeoutId);

        // Truncate error body to max 500 chars
        const truncatedErrorText = errorText.length > 500
          ? errorText.substring(0, 500) + '... (truncated)'
          : errorText;

        const error: LLMError = new Error(
          `LLM request failed: ${response.status} ${response.statusText}. ${truncatedErrorText}`
        );
        error.code = response.status;
        error.data = { statusText: response.statusText, body: truncatedErrorText };
        error.isLlmError = true;

        console.error(`[LLM] HTTP Error: streamToolCalling (id: ${requestId})`, {
          status: response.status,
          statusText: response.statusText,
          error: truncatedErrorText,
        });

        throw error;
      }

      // Log streaming start
      console.log(`[LLM] Response: streamToolCalling (id: ${requestId}) - Streaming started`);

      // Check content type and return appropriate stream
      const contentType = response.headers.get('Content-Type') || '';
      
      if (contentType.includes('text/event-stream')) {
        // Return wrapper that clears timeout in finally
        return this._wrapSSEStream(response, requestId, timeoutId, abortController.signal);
      } else if (contentType.includes('application/json')) {
        // Return wrapper for JSON response
        return this._wrapJSONStream(response, requestId, timeoutId);
      } else {
        // Unknown content type, try SSE parsing as fallback
        clearTimeout(timeoutId);
        return this._parseSSEStream(response, requestId, abortController.signal);
      }
    } catch (error) {
      clearTimeout(timeoutId);

      // Handle timeout errors
      if (error instanceof Error && error.name === 'AbortError') {
        const timeoutError: LLMError = new Error('LLM request timeout');
        timeoutError.code = 408;
        timeoutError.data = { timeoutMs };
        timeoutError.isLlmError = true;
        console.error(`[LLM] Timeout: streamToolCalling (id: ${requestId}) - Request exceeded ${timeoutMs}ms`);
        throw timeoutError;
      }

      // Handle network errors
      if (error instanceof Error && !isLLMError(error)) {
        const networkError: LLMError = new Error(
          `LLM request failed: ${error.message}`
        );
        networkError.cause = error;
        networkError.isLlmError = true;
        console.error(`[LLM] Network Error: streamToolCalling (id: ${requestId})`, error);
        throw networkError;
      }

      // Re-throw LLM errors
      throw error;
    }
  }

  /**
   * Wrap SSE stream with timeout cleanup
   * Clears timeout in finally block when stream completes or errors
   */
  private async *_wrapSSEStream(
    response: Response,
    requestId: string,
    timeoutId: NodeJS.Timeout,
    abortSignal?: AbortSignal
  ): AsyncIterable<LLMResponseChunk> {
    try {
      yield* this._parseSSEStream(response, requestId, abortSignal);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Wrap JSON response as single-chunk stream with timeout cleanup
   */
  private async *_wrapJSONStream(
    response: Response,
    _requestId: string,
    timeoutId: NodeJS.Timeout
  ): AsyncIterable<LLMResponseChunk> {
    try {
      const text = await response.text();
      const json = JSON.parse(text) as LLMResponseChunk;
      yield json;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Parse SSE stream from response
   * Handles Server-Sent Events format: "data: {...}\n\n"
   * 
   * @param response - The fetch Response object
   * @param requestId - Request ID for logging
   * @param abortSignal - Optional abort signal for timeout handling
   * @returns AsyncIterable of LLMResponseChunk objects
   */
  private async *_parseSSEStream(
    response: Response,
    requestId: string,
    abortSignal?: AbortSignal
  ): AsyncIterable<LLMResponseChunk> {
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      const error: LLMError = new Error('Response body is not readable');
      error.isLlmError = true;
      throw error;
    }

    let buffer = '';
    let aborted = false;

    try {
      // Listen to abort signal for faster termination
      if (abortSignal) {
        const abortHandler = () => {
          aborted = true;
          reader.cancel().catch(() => {
            // Ignore cancel errors
          });
        };
        // Check if already aborted
        if (abortSignal.aborted) {
          aborted = true;
        } else {
          abortSignal.addEventListener('abort', abortHandler);
        }
      }

      while (true) {
        // Check if aborted before reading
        if (aborted || (abortSignal?.aborted)) {
          const timeoutError: LLMError = new Error('LLM request timeout');
          timeoutError.code = 408;
          timeoutError.isLlmError = true;
          throw timeoutError;
        }

        const { done, value } = await reader.read();
        
        // Check again after read (abort may have occurred during read)
        if (aborted || (abortSignal?.aborted)) {
          const timeoutError: LLMError = new Error('LLM request timeout');
          timeoutError.code = 408;
          timeoutError.isLlmError = true;
          throw timeoutError;
        }
        
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();

          // Skip empty lines and comments
          if (trimmed.length === 0 || trimmed.startsWith(':')) {
            continue;
          }

          // Parse data lines
          if (trimmed.startsWith('data: ')) {
            const jsonStr = trimmed.slice(6); // Remove 'data: ' prefix

            // Skip empty data lines and [DONE] marker
            if (jsonStr.trim().length === 0 || jsonStr.trim() === '[DONE]') {
              continue;
            }

            try {
              const chunk = JSON.parse(jsonStr) as LLMResponseChunk;
              yield chunk;
            } catch (parseError) {
              console.warn(
                `[LLM] Failed to parse SSE data (id: ${requestId}):`,
                jsonStr.substring(0, 100)
              );
              // Don't throw - continue parsing other chunks
            }
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim().length > 0) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6);
          if (jsonStr.trim().length > 0 && jsonStr.trim() !== '[DONE]') {
            try {
              const chunk = JSON.parse(jsonStr) as LLMResponseChunk;
              yield chunk;
            } catch (parseError) {
              // Ignore parse errors for final buffer
            }
          }
        }
      }
    } catch (error) {
      // If it's already an LLMError (like our timeout), re-throw it
      if (isLLMError(error)) {
        throw error;
      }
      // If it's an AbortError or aborted signal, convert to LLMError
      if (error instanceof Error && (error.name === 'AbortError' || aborted)) {
        const timeoutError: LLMError = new Error('LLM request timeout');
        timeoutError.code = 408;
        timeoutError.isLlmError = true;
        throw timeoutError;
      }
      // Re-throw other errors
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Test connection to LLM Gateway
   * Sends a minimal request to validate connection
   * @returns true if connection succeeds, false otherwise
   */
  async testConnection(): Promise<boolean> {
    try {
      // Send a minimal request to validate connection
      const messages: LLMMessage[] = [
        { role: 'user', content: 'test' },
      ];

      // Use a very short timeout for connection test
      // Explicitly set maxTokens: 2048 to minimize cost
      const stream = await this.streamToolCalling(messages, [], { 
        timeoutMs: 5000,
        maxTokens: 2048,
      });

      // Try to read first chunk
      const iterator = stream[Symbol.asyncIterator]();
      const firstChunk = await iterator.next();
      return !firstChunk.done;
    } catch (error) {
      // Logging safety: only log sanitized error.message unless in development
      const isDevelopment = config.server.nodeEnv === 'development';
      if (isDevelopment) {
        console.error('[LLM] Connection test: FAILED', error);
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('[LLM] Connection test: FAILED', errorMessage);
      }
      return false;
    }
  }
}
