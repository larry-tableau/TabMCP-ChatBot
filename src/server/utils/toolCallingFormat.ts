/**
 * Tool-Calling Request Format Utilities
 * Phase 3, Task 2: Implement tool-calling request format
 * 
 * This module provides utility functions for:
 * - Building LLM messages (user, assistant with tool results)
 * - Formatting MCP tool results into LLM tool_result format
 * - Parsing tool calls from LLM response chunks
 * - Managing message arrays for conversation history
 * 
 * CRITICAL: Never hard-code tool names, field names, or values
 * Always use dynamic parameters from function arguments
 */

import type { LLMMessage, LLMResponseChunk } from '../llmClient.js';
import { MAX_TOOL_RESULT_SIZE_BYTES, MAX_QUERY_RESULT_ROWS } from '../config.js';

/**
 * Tool Call interface
 * Represents a complete tool call extracted from LLM response
 */
export interface ToolCall {
  /** Tool use ID (unique identifier for this tool call) */
  id: string;
  /** Tool name (e.g., 'query-datasource', 'list-datasources') */
  name: string;
  /** Tool input arguments */
  input: Record<string, unknown>;
}

/**
 * Tool Result interface
 * Represents a formatted tool result ready to send back to LLM
 */
export interface ToolResult {
  /** Tool use ID (matches the tool_use_id from the original tool call) */
  tool_use_id: string;
  /** Tool result content (JSON stringified) */
  content: string;
  /** Whether this result represents an error */
  isError?: boolean;
}

/**
 * Build a user message from a string
 * 
 * @param content - User message content (required, non-empty)
 * @returns LLMMessage with role 'user' and string content
 * @throws Error if content is empty or invalid
 * 
 * @example
 * ```typescript
 * const message = buildUserMessage('What are the top 5 states by sales?');
 * // Returns: { role: 'user', content: 'What are the top 5 states by sales?' }
 * ```
 */
export function buildUserMessage(content: string): LLMMessage {
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('User message content must be a non-empty string');
  }

  return {
    role: 'user',
    content: content.trim(),
  };
}

/**
 * Build a user message with tool results
 * 
 * Formats tool results into the LLM tool_result format required for
 * sending tool execution results back to the LLM in subsequent requests.
 * 
 * CRITICAL: Tool results must be sent as role 'user' with content array containing
 * tool_result blocks. This is the correct format for the LLM Gateway.
 * 
 * @param toolResults - Array of tool results to include (required, non-empty)
 * @returns LLMMessage with role 'user' and tool_result content blocks
 * @throws Error if toolResults is empty or invalid
 * 
 * @example
 * ```typescript
 * const toolResults: ToolResult[] = [
 *   {
 *     tool_use_id: 'tool_123',
 *     content: JSON.stringify({ data: [{ state: 'CA', sales: 1000 }] }),
 *   }
 * ];
 * const message = buildUserMessageWithToolResults(toolResults);
 * // Returns: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_123', content: '...' }] }
 * ```
 */
export function buildUserMessageWithToolResults(
  toolResults: ToolResult[]
): LLMMessage {
  if (!Array.isArray(toolResults) || toolResults.length === 0) {
    throw new Error('Tool results must be a non-empty array');
  }

  // Validate each tool result
  for (let i = 0; i < toolResults.length; i++) {
    const result = toolResults[i];
    if (!result || typeof result !== 'object') {
      throw new Error(`Tool result at index ${i} must be an object`);
    }
    if (!result.tool_use_id || typeof result.tool_use_id !== 'string' || result.tool_use_id.trim().length === 0) {
      throw new Error(`Tool result at index ${i} must have a non-empty tool_use_id`);
    }
    if (typeof result.content !== 'string') {
      throw new Error(`Tool result at index ${i} must have a string content`);
    }
  }

  return {
    role: 'user',
    content: toolResults.map((result) => ({
      type: 'tool_result' as const,
      tool_use_id: result.tool_use_id,
      content: result.content,
      // Note: isError is kept internally in ToolResult interface but not serialized to LLM
      // The Anthropic API schema does not support isError field in tool_result blocks
      // Error information should be embedded in content as JSON if needed
    })),
  };
}

/**
 * Build an assistant message with tool use blocks
 * 
 * Formats tool calls into the LLM tool_use format required for
 * sending tool calls back to the LLM in conversation history.
 * 
 * This is used to construct the assistant message that contains tool_use blocks,
 * which must appear before tool_result blocks in the message sequence.
 * 
 * @param toolCalls - Array of tool calls to include (required, non-empty)
 * @returns LLMMessage with role 'assistant' and tool_use content blocks
 * @throws Error if toolCalls is empty or invalid
 * 
 * @example
 * ```typescript
 * const toolCalls: ToolCall[] = [
 *   {
 *     id: 'tool_123',
 *     name: 'get-datasource-metadata',
 *     input: { datasourceLuid: 'abc-123' },
 *   }
 * ];
 * const message = buildAssistantMessageWithToolCalls(toolCalls);
 * // Returns: { role: 'assistant', content: [{ type: 'tool_use', id: 'tool_123', name: 'get-datasource-metadata', input: {...} }] }
 * ```
 */
export function buildAssistantMessageWithToolCalls(
  toolCalls: ToolCall[]
): LLMMessage {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    throw new Error('Tool calls must be a non-empty array');
  }

  // Validate each tool call
  for (let i = 0; i < toolCalls.length; i++) {
    const toolCall = toolCalls[i];
    if (!toolCall || typeof toolCall !== 'object') {
      throw new Error(`Tool call at index ${i} must be an object`);
    }
    if (!toolCall.id || typeof toolCall.id !== 'string' || toolCall.id.trim().length === 0) {
      throw new Error(`Tool call at index ${i} must have a non-empty id`);
    }
    if (!toolCall.name || typeof toolCall.name !== 'string' || toolCall.name.trim().length === 0) {
      throw new Error(`Tool call at index ${i} must have a non-empty name`);
    }
    if (!toolCall.input || typeof toolCall.input !== 'object' || Array.isArray(toolCall.input)) {
      throw new Error(`Tool call at index ${i} must have a plain object input`);
    }
  }

  return {
    role: 'assistant',
    content: toolCalls.map((toolCall) => ({
      type: 'tool_use' as const,
      id: toolCall.id,
      name: toolCall.name,
      input: toolCall.input,
    })),
  };
}

/**
 * @deprecated Use buildUserMessageWithToolResults() instead. Tool results must be sent as role 'user'.
 * This function is kept for backward compatibility but will be removed in a future version.
 */
export function buildAssistantMessageWithToolResults(
  toolResults: ToolResult[]
): LLMMessage {
  return buildUserMessageWithToolResults(toolResults);
}

/**
 * Truncate query result data array to prevent LLM input overflow
 * 
 * For query-datasource results, if the data array exceeds MAX_QUERY_RESULT_ROWS,
 * truncate to first N rows and include metadata about total row count.
 * 
 * @param result - Query result object with data array
 * @returns Truncated result with summary metadata
 */
function truncateQueryResult(result: unknown): unknown {
  // Check if this is a query result with data array
  if (
    result &&
    typeof result === 'object' &&
    !Array.isArray(result) &&
    'data' in result &&
    Array.isArray((result as { data?: unknown }).data)
  ) {
    const queryResult = result as { data: Array<Record<string, unknown>> };
    const totalRows = queryResult.data.length;
    
    if (totalRows > MAX_QUERY_RESULT_ROWS) {
      // Truncate to first N rows
      const truncatedData = queryResult.data.slice(0, MAX_QUERY_RESULT_ROWS);
      
      // Return truncated result with metadata
      return {
        ...queryResult,
        data: truncatedData,
        _metadata: {
          totalRows,
          returnedRows: MAX_QUERY_RESULT_ROWS,
          truncated: true,
          note: `Result truncated: showing first ${MAX_QUERY_RESULT_ROWS} of ${totalRows} rows`,
        },
      };
    }
  }
  
  return result;
}

/**
 * Truncate tool result content if it exceeds size limit
 * 
 * @param content - JSON stringified tool result content
 * @returns Truncated content string with truncation indicator
 */
function truncateToolResultContent(content: string): string {
  // Convert to bytes (UTF-8 encoding: 1 char = 1-4 bytes, approximate as 1 byte per char)
  const sizeBytes = Buffer.byteLength(content, 'utf8');
  
  if (sizeBytes <= MAX_TOOL_RESULT_SIZE_BYTES) {
    return content;
  }
  
  // Truncate to max size (leave room for truncation indicator)
  const truncationIndicator = '... [TRUNCATED: result too large]';
  const maxContentSize = MAX_TOOL_RESULT_SIZE_BYTES - Buffer.byteLength(truncationIndicator, 'utf8');
  
  // Truncate string (approximate, may be slightly over due to multi-byte chars)
  let truncated = content.slice(0, maxContentSize);
  
  // Ensure we don't break JSON structure - find last complete JSON value
  // Simple approach: find last complete object/array boundary
  const lastBrace = truncated.lastIndexOf('}');
  const lastBracket = truncated.lastIndexOf(']');
  const lastBoundary = Math.max(lastBrace, lastBracket);
  
  if (lastBoundary > maxContentSize * 0.8) {
    // If we found a reasonable boundary, use it
    truncated = truncated.slice(0, lastBoundary + 1);
  }
  
  // Try to parse to ensure valid JSON
  try {
    JSON.parse(truncated);
  } catch {
    // If invalid, wrap in object with error message
    truncated = JSON.stringify({
      _truncated: true,
      _note: 'Result was too large and had to be truncated',
      _originalSizeBytes: sizeBytes,
      _truncatedSizeBytes: Buffer.byteLength(truncated, 'utf8'),
    });
  }
  
  return truncated + truncationIndicator;
}

/**
 * Format an MCP tool result into LLM tool_result format
 * 
 * Converts MCP tool execution results (objects, arrays, primitives) into
 * the JSON stringified format required by the LLM Gateway.
 * 
 * **Size Limits:**
 * - Query results with data arrays are truncated to MAX_QUERY_RESULT_ROWS rows
 * - All results are truncated if they exceed MAX_TOOL_RESULT_SIZE_BYTES
 * 
 * @param toolUseId - Tool use ID from the original tool call (required)
 * @param result - MCP tool result (any type - will be JSON stringified)
 * @param isError - Whether this result represents an error (default: false)
 * @returns ToolResult object ready to send to LLM
 * @throws Error if toolUseId is invalid
 * 
 * @example
 * ```typescript
 * // Format a successful query result
 * const queryResult = { data: [{ state: 'CA', sales: 1000 }] };
 * const toolResult = formatToolResult('tool_123', queryResult);
 * // Returns: { tool_use_id: 'tool_123', content: '{"data":[{"state":"CA","sales":1000}]}', isError: false }
 * 
 * // Format an error result
 * const error = new Error('Datasource not found');
 * const errorResult = formatToolResult('tool_123', { error: error.message }, true);
 * // Returns: { tool_use_id: 'tool_123', content: '{"error":"Datasource not found"}', isError: true }
 * ```
 */
export function formatToolResult(
  toolUseId: string,
  result: unknown,
  isError = false
): ToolResult {
  if (!toolUseId || typeof toolUseId !== 'string' || toolUseId.trim().length === 0) {
    throw new Error('Tool use ID must be a non-empty string');
  }

  // First, truncate query results if needed (before stringification)
  const truncatedResult = truncateQueryResult(result);

  let content: string;
  try {
    // JSON stringify the result
    content = JSON.stringify(truncatedResult);
  } catch (stringifyError) {
    // If JSON.stringify fails, fallback to String() representation
    // This handles circular references and other edge cases
    const errorMessage = stringifyError instanceof Error ? stringifyError.message : String(stringifyError);
    console.warn(`[LLM] Failed to JSON stringify tool result, using String() fallback: ${errorMessage}`);
    content = JSON.stringify({ error: String(result) });
  }

  // Truncate content if it exceeds size limit
  content = truncateToolResultContent(content);

  return {
    tool_use_id: toolUseId.trim(),
    content,
    isError,
  };
}

/**
 * Extract tool call from a single LLM response chunk
 * 
 * Quick extraction of tool call information from a content_block_start chunk.
 * Returns null if the chunk doesn't contain a tool_use block.
 * 
 * Note: This extracts from a single chunk. For complete tool calls that span
 * multiple chunks (with input_json_delta), use parseToolCallsFromChunks().
 * 
 * @param chunk - LLM response chunk to extract from
 * @returns ToolCall object if chunk contains tool_use, null otherwise
 * 
 * @example
 * ```typescript
 * const chunk: LLMResponseChunk = {
 *   type: 'content_block_start',
 *   content_block: {
 *     type: 'tool_use',
 *     tool_use_id: 'tool_123',
 *     name: 'query-datasource',
 *     input: { datasourceLuid: 'abc', query: { fields: [...] } }
 *   }
 * };
 * const toolCall = extractToolCallFromChunk(chunk);
 * // Returns: { id: 'tool_123', name: 'query-datasource', input: {...} }
 * ```
 */
export function extractToolCallFromChunk(chunk: LLMResponseChunk): ToolCall | null {
  if (chunk.type !== 'content_block_start') {
    return null;
  }

  if (!chunk.content_block || chunk.content_block.type !== 'tool_use') {
    return null;
  }

  // Support both 'id' and 'tool_use_id' field names (gateway may use either)
  const toolUseId = chunk.content_block.tool_use_id ?? chunk.content_block.id;
  const name = chunk.content_block.name;
  const input = chunk.content_block.input;

  if (!toolUseId || typeof toolUseId !== 'string' || toolUseId.trim().length === 0) {
    return null;
  }

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return null;
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }

  return {
    id: toolUseId.trim(),
    name: name.trim(),
    input: input as Record<string, unknown>,
  };
}

/**
 * Parse complete tool calls from LLM response chunks stream
 * 
 * Aggregates chunks to build complete tool calls, handling multi-chunk
 * tool calls where input is streamed via input_json_delta chunks.
 * 
 * @param chunks - AsyncIterable of LLM response chunks
 * @returns Promise resolving to array of complete ToolCall objects
 * 
 * @example
 * ```typescript
 * const stream = await llmClient.streamToolCalling(messages, tools);
 * const toolCalls = await parseToolCallsFromChunks(stream);
 * // Returns: [{ id: 'tool_123', name: 'query-datasource', input: {...} }, ...]
 * ```
 */
export async function parseToolCallsFromChunks(
  chunks: AsyncIterable<LLMResponseChunk>
): Promise<ToolCall[]> {
  const toolCalls: ToolCall[] = [];
  // Map content block index -> tool_use_id (for associating input_json_delta chunks)
  const indexToToolUseId = new Map<number, string>();
  // Map tool_use_id -> tool call data
  const toolCallMap = new Map<string, Partial<ToolCall>>();
  // Map tool_use_id -> accumulated input JSON buffer
  const inputBuffers = new Map<string, string>();

  for await (const chunk of chunks) {
    // Handle content_block_start (tool_use)
    if (chunk.type === 'content_block_start' && chunk.content_block?.type === 'tool_use') {
      // Support both 'id' and 'tool_use_id' field names (gateway may use either)
      const toolUseId = chunk.content_block.tool_use_id ?? chunk.content_block.id;
      const name = chunk.content_block.name;
      const input = chunk.content_block.input;
      const index = chunk.index;

      if (toolUseId && name) {
        toolCallMap.set(toolUseId, {
          id: toolUseId,
          name,
          input: input || {},
        });
        inputBuffers.set(toolUseId, '');
        
        // Map index to tool_use_id for input_json_delta association
        if (index !== undefined) {
          indexToToolUseId.set(index, toolUseId);
        }
      }
    }

    // Handle input_json_delta (partial JSON for tool input)
    // CRITICAL: input_json_delta chunks use chunk.index to associate with tool_use blocks
    // They do NOT include content_block.tool_use_id
    if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'input_json_delta') {
      const index = chunk.index;
      const partialJson = chunk.delta.partial_json;

      // Use index to find the associated tool_use_id
      let toolUseId: string | undefined;
      if (index !== undefined) {
        toolUseId = indexToToolUseId.get(index);
      }
      
      // Fallback: try content_block if index is not available (defensive)
      if (!toolUseId) {
        toolUseId = chunk.content_block?.tool_use_id ?? chunk.content_block?.id;
      }

      if (toolUseId && partialJson && partialJson.trim().length > 0) {
        // Accumulate partial JSON
        const currentBuffer = inputBuffers.get(toolUseId) || '';
        inputBuffers.set(toolUseId, currentBuffer + partialJson);
      }
    }

    // Handle content_block_stop (complete tool call)
    if (chunk.type === 'content_block_stop') {
      const index = chunk.index;
      // Support both 'id' and 'tool_use_id' field names (gateway may use either)
      let toolUseId = chunk.content_block?.tool_use_id ?? chunk.content_block?.id;
      
      // If tool_use_id not in content_block, try index lookup
      if (!toolUseId && index !== undefined) {
        toolUseId = indexToToolUseId.get(index);
      }

      if (toolUseId) {
        const toolCall = toolCallMap.get(toolUseId);
        const inputBuffer = inputBuffers.get(toolUseId);

        if (toolCall) {
          // If we have accumulated input from input_json_delta, parse and merge it
          if (inputBuffer && inputBuffer.trim().length > 0) {
            try {
              const parsedInput = JSON.parse(inputBuffer);
              // Merge with any initial input from content_block_start
              toolCall.input = {
                ...(toolCall.input as Record<string, unknown> || {}),
                ...(parsedInput as Record<string, unknown>),
              };
            } catch (parseError) {
              // If parsing fails, log warning but keep original input
              console.warn(
                `[LLM] Failed to parse accumulated input_json_delta for tool ${toolUseId}:`,
                parseError instanceof Error ? parseError.message : String(parseError)
              );
            }
          }

          // Validate and add to results
          if (toolCall.id && toolCall.name && toolCall.input) {
            toolCalls.push({
              id: toolCall.id,
              name: toolCall.name,
              input: toolCall.input as Record<string, unknown>,
            });
          }

          // Cleanup
          toolCallMap.delete(toolUseId);
          inputBuffers.delete(toolUseId);
          if (index !== undefined) {
            indexToToolUseId.delete(index);
          }
        }
      }
    }
  }

  // Handle any remaining tool calls (incomplete, but we'll include them)
  for (const [, toolCall] of toolCallMap.entries()) {
    if (toolCall.id && toolCall.name && toolCall.input) {
      toolCalls.push({
        id: toolCall.id,
        name: toolCall.name,
        input: toolCall.input as Record<string, unknown>,
      });
    }
  }

  return toolCalls;
}

/**
 * Build a message array from multiple messages
 * 
 * Helper function to build and validate message arrays for conversation history.
 * Useful for appending tool results to existing conversation.
 * 
 * @param messages - Variable number of LLMMessage objects
 * @returns Array of LLMMessage objects
 * @throws Error if any message is invalid
 * 
 * @example
 * ```typescript
 * const userMsg = buildUserMessage('What are the top states?');
 * const toolResults = [formatToolResult('tool_123', { data: [...] })];
 * const assistantMsg = buildAssistantMessageWithToolResults(toolResults);
 * const messages = buildMessageArray(userMsg, assistantMsg);
 * // Returns: [userMsg, assistantMsg]
 * ```
 */
export function buildMessageArray(...messages: LLMMessage[]): LLMMessage[] {
  if (messages.length === 0) {
    throw new Error('Message array must contain at least one message');
  }

  // Validate each message
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (!message || typeof message !== 'object') {
      throw new Error(`Message at index ${i} must be an object`);
    }
    if (!message.role || !['user', 'assistant', 'system'].includes(message.role)) {
      throw new Error(`Message at index ${i} must have a valid role (user, assistant, or system)`);
    }
    if (message.content === undefined || message.content === null) {
      throw new Error(`Message at index ${i} must have content`);
    }
    if (typeof message.content === 'string' && message.content.trim().length === 0) {
      throw new Error(`Message at index ${i} must have non-empty content`);
    }
    if (Array.isArray(message.content) && message.content.length === 0) {
      throw new Error(`Message at index ${i} must have non-empty content array`);
    }
  }

  return messages;
}

