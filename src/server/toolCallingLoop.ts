/**
 * Tool-Calling Loop
 * Phase 4, Task 2: Implement main orchestration loop
 * Phase 4, Task 3: Implement multi-turn tool calling
 * Phase 4, Task 4: Add progress event streaming
 * 
 * This module handles:
 * - Main orchestration loop: user query → context → LLM → tool calls → MCP execution → tool results → LLM synthesis → answer
 * - Multi-turn tool calling: supports multiple tool call cycles until final answer or max iterations
 * - Progress event streaming: streams SSE events for reasoning, tool calls, and answer generation
 * - Connecting LLM tool decisions to MCP execution
 * - Error handling at each step
 * 
 * CRITICAL: Never hard-code datasource LUIDs, workbook IDs, or view IDs
 * Always use dynamic parameters from function arguments or config
 */

import type { Response } from 'express';
import type { LLMMessage } from './llmClient.js';
import { LLMClient } from './llmClient.js';
import { MCPClient } from './mcpClient.js';
import { buildContextEnvelope } from './utils/contextEnvelope.js';
import { getMCPToolDefinitions } from './utils/toolDefinitions.js';
import {
  buildUserMessage,
  buildUserMessageWithToolResults,
  buildAssistantMessageWithToolCalls,
  formatToolResult,
  parseToolCallsFromChunks,
  type ToolCall,
  type ToolResult,
} from './utils/toolCallingFormat.js';
import { extractAnswerText } from './utils/streamingResponseHandler.js';
import { sendSSEEvent } from './utils/sse.js';
import { config } from './config.js';
import { extractCitations } from './grounding.js';
import type { Citation } from './grounding.js';
import { conversationStateManager } from './conversationState.js';
import { mapErrorToUserFriendly, logError, suggestSimilarFields } from './utils/errorMapping.js';
import { detectFieldCorrections, buildCorrectionNote } from './utils/fieldCorrection.js';
import type { MCPError } from './mcpClient.js';
import type { DatasourceMetadata } from './mcpClient.js';

/**
 * Default maximum number of tool call cycles
 * Prevents infinite loops while allowing complex multi-step queries
 */
const DEFAULT_MAX_ITERATIONS = 5;

/**
 * Helper to check if environment variable is truthy
 * @param name - Environment variable name
 * @returns true if variable is set and not '0' or 'false'
 */
function envTruthy(name: string): boolean {
  const v = process.env[name];
  return !!v && v !== '0' && v.toLowerCase() !== 'false';
}

/**
 * Tool-Calling Loop class
 * 
 * Orchestrates the complete tool-calling flow with multi-turn support and progress event streaming:
 * 1. Takes user query
 * 2. Builds context envelope (system message) with datasource description and workbook/view tags
 * 3. Sends user query + context + tool definitions to LLM
 * 4. Streams `reasoning_start` event (if SSE enabled)
 * 5. Parses tool calls from LLM response
 * 6. If no tool calls: Streams `answer_start`, streams `answer_chunk` events, streams `answer_complete`, returns answer
 * 7. If tool calls found:
 *    a. Streams `tool_call_start` for each tool call
 *    b. Executes tool calls via MCP
 *    c. Streams `tool_call_complete` for each tool call
 *    d. Formats tool results
 *    e. Sends tool results back to LLM
 *    f. Checks if LLM generates additional tool calls (multi-turn)
 *    g. Repeats steps 4-7 until final answer (no tool calls) or max iterations reached
 * 8. Gets final synthesized answer
 * 9. Returns answer to caller
 */
export class ToolCallingLoop {
  private mcpClient: MCPClient;
  private llmClient: LLMClient;

  /**
   * Create a new ToolCallingLoop instance
   * 
   * @param mcpClient - Optional MCP client instance (creates new if not provided)
   * @param llmClient - Optional LLM client instance (creates new if not provided)
   */
  constructor(mcpClient?: MCPClient, llmClient?: LLMClient) {
    this.mcpClient = mcpClient ?? new MCPClient();
    this.llmClient = llmClient ?? new LLMClient();
  }

  /**
   * Execute tool call via MCP client
   * 
   * Maps tool call names to MCP client methods and executes them.
   * Handles errors gracefully by formatting them as error tool results.
   * 
   * @param toolCall - Tool call to execute
   * @returns Tool result (success or error)
   * 
   * @internal
   */
  private normalizeDatasourceQuery(query: import('./mcpClient.js').VizQLQuery): import('./mcpClient.js').VizQLQuery {
    // Create a copy to avoid mutating the original
    const normalized = { ...query };

    // Remove disallowed query.limit (defensive guard against LLM-generated queries)
    if ('limit' in normalized) {
      delete normalized.limit;
      if (config.server.nodeEnv === 'development') {
        console.log('[ToolCallingLoop] Removed query.limit (not supported by MCP)');
      }
    }

    // Normalize fields: convert aggregation → function
    if (Array.isArray(normalized.fields)) {
      normalized.fields = normalized.fields.map((field): import('./mcpClient.js').QueryField => {
        if (!field || typeof field !== 'object' || Array.isArray(field)) {
          return field as import('./mcpClient.js').QueryField;
        }

        const fieldObj = { ...field } as Record<string, unknown>;
        
        // If aggregation exists and function doesn't, rename aggregation → function
        if ('aggregation' in fieldObj && !('function' in fieldObj)) {
          fieldObj.function = fieldObj.aggregation;
          delete fieldObj.aggregation;
          if (config.server.nodeEnv === 'development') {
            console.log('[ToolCallingLoop] Converted field.aggregation → field.function');
          }
        }
        // If both aggregation and function exist, delete aggregation (favor function)
        else if ('aggregation' in fieldObj && 'function' in fieldObj) {
          delete fieldObj.aggregation;
          if (config.server.nodeEnv === 'development') {
            console.log('[ToolCallingLoop] Removed field.aggregation (function already present)');
          }
        }

        return fieldObj as import('./mcpClient.js').QueryField;
      });
    }

    // Normalize filters if present
    if (Array.isArray(normalized.filters)) {
      normalized.filters = normalized.filters.map((filter) => {
        if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
          return filter;
        }

        const filterObj = { ...filter } as Record<string, unknown>;
        const filterType = filterObj.filterType;

        // Check if this is a date filter that needs normalization
        const hasMinMax = 'min' in filterObj || 'max' in filterObj;
        const isQuantitativeDate = filterType === 'QUANTITATIVE_DATE';
        const isDate = filterType === 'DATE';

        if ((isQuantitativeDate || isDate) && hasMinMax) {
          // Convert QUANTITATIVE_DATE to DATE
          if (isQuantitativeDate) {
            filterObj.filterType = 'DATE';
            // Remove quantitativeFilterType if present
            delete filterObj.quantitativeFilterType;
          }

          // Map min -> minDate, max -> maxDate
          if ('min' in filterObj) {
            filterObj.minDate = filterObj.min;
            delete filterObj.min;
          }
          if ('max' in filterObj) {
            filterObj.maxDate = filterObj.max;
            delete filterObj.max;
          }

          // Set dateRangeType to RANGE if bounds are present
          if (filterObj.minDate !== undefined || filterObj.maxDate !== undefined) {
            filterObj.dateRangeType = 'RANGE';
          }
        }

        return filterObj as import('./mcpClient.js').QueryFilter;
      });
    }

    return normalized;
  }

  private async executeToolCall(toolCall: ToolCall, lockedDatasourceLuid?: string): Promise<ToolResult> {
    const { id, name, input } = toolCall;

    try {
      // Validate datasource restriction for datasource-specific tools
      if (lockedDatasourceLuid) {
        if (name === 'query-datasource' || name === 'get-datasource-metadata') {
          const toolDatasourceLuid = String(input.datasourceLuid || '').trim();
          if (toolDatasourceLuid !== lockedDatasourceLuid) {
            throw new Error(
              `Tool call attempted to use datasource "${toolDatasourceLuid}" but session is locked to "${lockedDatasourceLuid}". ` +
              `You must use the locked datasource for this session.`
            );
          }
        }
        // Prevent list-datasources when datasource is locked (should be filtered from tools, but double-check)
        if (name === 'list-datasources') {
          throw new Error(
            `Tool "list-datasources" is not available when a datasource is selected. ` +
            `The session is locked to datasource "${lockedDatasourceLuid}".`
          );
        }
      }

      let result: unknown;

      // Map tool call name to MCP client method
      switch (name) {
        case 'list-datasources': {
          const options: {
            filter?: string;
            pageSize?: number;
            limit?: number;
          } = {};
          if (input.filter !== undefined) {
            options.filter = String(input.filter);
          }
          if (input.pageSize !== undefined) {
            options.pageSize = Number(input.pageSize);
          }
          if (input.limit !== undefined) {
            options.limit = Number(input.limit);
          }
          result = await this.mcpClient.listDatasources(options);
          break;
        }

        case 'get-datasource-metadata': {
          const datasourceLuid = String(input.datasourceLuid);
          if (!datasourceLuid || datasourceLuid.trim().length === 0) {
            throw new Error('datasourceLuid is required and must be a non-empty string');
          }
          result = await this.mcpClient.getDatasourceMetadata(datasourceLuid.trim());
          break;
        }

        case 'query-datasource': {
          const datasourceLuid = String(input.datasourceLuid);
          const query = input.query;
          if (!datasourceLuid || datasourceLuid.trim().length === 0) {
            throw new Error('datasourceLuid is required and must be a non-empty string');
          }
          if (!query || typeof query !== 'object' || Array.isArray(query)) {
            throw new Error('query is required and must be an object');
          }
          // Normalize query filters before sending to MCP (Fix A: filter normalization)
          const normalizedQuery = this.normalizeDatasourceQuery(query as import('./mcpClient.js').VizQLQuery);
          // Type assertion: normalized query matches VizQLQuery format
          result = await this.mcpClient.queryDatasource(
            datasourceLuid.trim(),
            normalizedQuery
          );
          break;
        }

        case 'get-workbook': {
          const workbookId = String(input.workbookId);
          if (!workbookId || workbookId.trim().length === 0) {
            throw new Error('workbookId is required and must be a non-empty string');
          }
          result = await this.mcpClient.getWorkbook(workbookId.trim());
          break;
        }

        case 'list-views': {
          const options: {
            filter?: string;
            pageSize?: number;
            limit?: number;
          } = {};
          if (input.filter !== undefined) {
            options.filter = String(input.filter);
          }
          if (input.pageSize !== undefined) {
            options.pageSize = Number(input.pageSize);
          }
          if (input.limit !== undefined) {
            options.limit = Number(input.limit);
          }
          result = await this.mcpClient.listViews(options);
          break;
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      // Format successful result
      return formatToolResult(id, result, false);
    } catch (error) {
      // Compute typo suggestions for invalid field names (Phase 8, Tasks 1/2/5: FR-6/AC-6)
      // Only for MCP errors with code -32602 (Invalid Params) and query-datasource tool
      if (
        error &&
        typeof error === 'object' &&
        'isMcpError' in error &&
        (error as MCPError).isMcpError &&
        (error as MCPError).code === -32602 &&
        name === 'query-datasource'
      ) {
        const mcpError = error as MCPError;
        
        // Extract datasourceLuid and query from tool call input
        const datasourceLuid = input.datasourceLuid ? String(input.datasourceLuid).trim() : undefined;
        const query = input.query;
        
        // Validate query structure before accessing fields
        if (
          datasourceLuid &&
          query &&
          typeof query === 'object' &&
          !Array.isArray(query) &&
          Array.isArray((query as { fields?: unknown }).fields)
        ) {
          const queryFields = (query as { fields: Array<{ fieldCaption?: string }> }).fields;
          
          // Fetch metadata and compute suggestions for unmatched fields
          try {
            const metadata: DatasourceMetadata = await this.mcpClient.getDatasourceMetadata(datasourceLuid);
            
            // Validate metadata structure
            if (metadata && Array.isArray(metadata.fields)) {
              // Extract available field names from metadata
              const availableFieldNames = metadata.fields
                .map(field => field.name)
                .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
              
              // Find unmatched fields and compute suggestions
              const typoSuggestions: string[] = [];
              
              for (const queryField of queryFields) {
                const fieldCaption = queryField.fieldCaption;
                if (!fieldCaption || typeof fieldCaption !== 'string') {
                  continue;
                }
                
                // Check if field exists in metadata (case-insensitive exact match)
                const normalizedFieldCaption = fieldCaption.toLowerCase().trim();
                const fieldExists = availableFieldNames.some(
                  name => name.toLowerCase().trim() === normalizedFieldCaption
                );
                
                // If field doesn't exist, compute suggestions
                if (!fieldExists) {
                  const suggestions = suggestSimilarFields(fieldCaption, availableFieldNames);
                  if (suggestions.length > 0) {
                    const suggestionText = `Field "${fieldCaption}" not found. Did you mean: ${suggestions.join(', ')}?`;
                    typoSuggestions.push(suggestionText);
                  }
                }
              }
              
              // Attach typo suggestions to error object (merge with existing suggestions if any)
              if (typoSuggestions.length > 0) {
                const existingSuggestions = (mcpError as any).recoverySuggestions || [];
                (mcpError as any).recoverySuggestions = [...existingSuggestions, ...typoSuggestions];
              }
            }
          } catch (metadataError) {
            // If metadata fetch fails, fall back to generic suggestions
            // Don't let metadata fetch failure break error handling
            if (config.server.nodeEnv === 'development') {
              console.warn('[ToolCallingLoop] Failed to fetch metadata for typo suggestions:', metadataError instanceof Error ? metadataError.message : String(metadataError));
            }
          }
        }
      }
      
      // Map error to user-friendly message with recovery suggestions
      const userFriendlyError = mapErrorToUserFriendly(error);
      logError(userFriendlyError.category, userFriendlyError, `ToolCallingLoop.Tool.${name}`);
      
      // Format error result with user-friendly message
      const errorMessage = userFriendlyError.message;
      return formatToolResult(id, { 
        error: errorMessage,
        recoverySuggestions: userFriendlyError.recoverySuggestions,
      }, true);
    }
  }

  /**
   * Safely send SSE event (handles errors gracefully)
   * 
   * @param sseResponse - Optional SSE response object
   * @param event - Event type
   * @param data - Event data
   * @param id - Optional event ID
   * @internal
   */
  private safeSendSSEEvent(
    sseResponse: Response | undefined,
    event: string,
    data: unknown,
    id?: string
  ): void {
    if (!sseResponse) {
      return; // No SSE response, skip event
    }

    try {
      sendSSEEvent(sseResponse, event, data, id);
    } catch (error) {
      // Log error but don't throw (don't break main flow)
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (config.server.nodeEnv === 'development') {
        console.warn(`[ToolCallingLoop] Failed to send SSE event ${event}: ${errorMessage}`);
      }
    }
  }

  /**
   * Stream answer chunks from LLM response and accumulate answer text
   * 
   * Parses chunks from LLM stream, streams `answer_chunk` events as chunks arrive,
   * and accumulates answer text for final return.
   * 
   * @param stream - LLM response stream
   * @param sseResponse - Optional SSE response object
   * @returns Promise resolving to complete answer text
   * @internal
   */
  private async streamAnswerChunks(
    stream: AsyncIterable<import('./llmClient.js').LLMResponseChunk>,
    sseResponse?: Response
  ): Promise<string> {
    let answerText = '';

    for await (const chunk of stream) {
      const text = extractAnswerText(chunk);
      if (text) {
        answerText += text;
        // Stream answer chunk event
        this.safeSendSSEEvent(
          sseResponse,
          'answer_chunk',
          {
            text,
            timestamp: new Date().toISOString(),
          }
        );
      }
    }

    return answerText;
  }

  /**
   * Execute main orchestration loop with multi-turn tool calling support and progress event streaming
   * 
   * Complete tool-calling flow with multi-turn support and SSE progress events:
   * 1. Validates user message
   * 2. Determines datasourceLuid (from parameter or config.defaults)
   * 3. Builds context envelope using `buildContextEnvelope()` (once, at start)
   * 4. Creates initial messages: `[systemMessage, userMessage]`
   * 5. Gets tool definitions using `getMCPToolDefinitions()`
   * 6. **Loop while `iteration < maxIterations`:**
   *    a. Streams `reasoning_start` event (if SSE enabled)
   *    b. Sends messages to LLM: `llmClient.streamToolCalling(messages, tools)`
   *    c. Parses tool calls using `parseToolCallsFromChunks()`
   *    d. If no tool calls: Streams `answer_start`, streams `answer_chunk` events, streams `answer_complete`, returns (final answer)
   *    e. If tool calls found:
   *       - Streams `tool_call_start` for each tool call (with tool name and parameters)
   *       - Executes tool calls sequentially via MCP client
   *       - Streams `tool_call_complete` for each tool call (with result summary)
   *       - Formats tool results using `formatToolResult()`
   *       - Builds assistant message with tool calls using `buildAssistantMessageWithToolCalls()`
   *       - Builds user message with tool results using `buildUserMessageWithToolResults()`
   *       - Appends to messages array: `messages.push(assistantMessage, toolResultMessage)`
   *       - Increments iteration counter
   *       - Continues loop
   * 7. If max iterations reached: Logs warning, tries to get answer from last response, returns partial answer if available
   * 
   * **Message History:**
   * - Initial: `[systemMessage, userMessage]`
   * - After iteration 1: `[systemMessage, userMessage, assistantMessage1, toolResultMessage1]`
   * - After iteration 2: `[systemMessage, userMessage, assistantMessage1, toolResultMessage1, assistantMessage2, toolResultMessage2]`
   * - Pattern: Append `assistantMessage` and `toolResultMessage` for each iteration
   * 
   * **Stopping Conditions:**
   * - No tool calls detected: LLM provided final answer (most common)
   * - Max iterations reached: Safety mechanism to prevent infinite loops
   * 
   * **Progress Events (if SSE enabled):**
   * - `reasoning_start`: Before each LLM request (with iteration number if multi-turn)
   * - `tool_call_start`: Before each tool execution (with tool name and parameters)
   * - `tool_call_complete`: After each tool execution (with result summary)
   * - `answer_start`: When starting answer generation
   * - `answer_chunk`: As answer text chunks arrive (real-time streaming)
   * - `answer_complete`: When answer is complete (with full answer text)
   * 
   * @param userMessage - User query string (required, non-empty)
   * @param datasourceLuid - Optional datasource LUID (uses config.defaults if not provided)
   * @param workbookId - Optional workbook ID (for context envelope)
   * @param viewId - Optional view ID (for context envelope)
   * @param maxIterations - Optional maximum number of tool call cycles (default: 5)
   * @param sseResponse - Optional Express Response object for SSE event streaming
   * @returns Promise resolving to answer text string (from final iteration)
   * @throws Error if user message is invalid or critical errors occur
   * 
   * @example
   * ```typescript
   * const loop = new ToolCallingLoop();
   * const answer = await loop.execute('What datasources are available?');
   * // Returns: "The available datasources are: ..."
   * 
   * // With specific datasource/workbook/view
   * const answer2 = await loop.execute(
   *   'What fields are in the datasource?',
   *   'datasource-luid-123',
   *   'workbook-id-456',
   *   'view-id-789'
   * );
   * 
   * // With custom max iterations
   * const answer3 = await loop.execute(
   *   'Complex query requiring multiple tool calls',
   *   undefined,
   *   undefined,
   *   undefined,
   *   10 // Allow up to 10 iterations
   * );
   * 
   * // With SSE event streaming
   * const answer4 = await loop.execute(
   *   'What datasources are available?',
   *   undefined,
   *   undefined,
   *   undefined,
   *   undefined,
   *   res // Express Response object for SSE
   * );
   * // Events streamed: reasoning_start, tool_call_start, tool_call_complete, answer_start, answer_chunk, answer_complete
   * ```
   */
  async execute(
    userMessage: string,
    datasourceLuid?: string,
    workbookId?: string,
    viewId?: string,
    maxIterations?: number,
    sseResponse?: Response,
    sessionId?: string
  ): Promise<string> {
    // Test hook: pre-stream throw (for edge case validation)
    if (envTruthy('SSE_TEST_THROW')) {
      throw new Error('pre-stream failure');
    }
    
    // Validate user message
    if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length === 0) {
      throw new Error('User message must be a non-empty string');
    }

    const trimmedMessage = userMessage.trim();

    // Determine datasourceLuid (from parameter or config.defaults)
    const effectiveDatasourceLuid = datasourceLuid ?? config.defaults?.datasourceLuid;
    if (!effectiveDatasourceLuid) {
      if (config.server.nodeEnv === 'development') {
        console.warn('[ToolCallingLoop] No datasourceLuid provided and no config.defaults.datasourceLuid available');
      }
    }

    // Build context envelope (may fail - handle gracefully, continue without context)
    let contextString: string | undefined;
    try {
      if (effectiveDatasourceLuid) {
        if (config.server.nodeEnv === 'development') {
          console.log(`[ToolCallingLoop] Building context for datasource: ${effectiveDatasourceLuid.substring(0, 8)}...`);
        }
        contextString = await buildContextEnvelope(effectiveDatasourceLuid, workbookId, viewId);
      }
    } catch (error) {
      // Log warning but continue without context (partial functionality)
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (config.server.nodeEnv === 'development') {
        console.warn(`[ToolCallingLoop] Failed to build context envelope: ${errorMessage}`);
      }
      // Continue without context
    }

    // Create system message with context (if available)
    const messages: LLMMessage[] = [];
    if (contextString) {
      messages.push({
        role: 'system',
        content: contextString,
      });
    }

    // Inject conversation history from session state (if sessionId provided)
    if (sessionId) {
      const state = conversationStateManager.getState(sessionId);
      if (state && state.messages.length > 0) {
        // Take last 10 messages
        const history = state.messages.slice(-10);
        
        // Exclude last message if it matches current user message (duplicate detection)
        const lastMessage = history[history.length - 1];
        const historyToInclude = (lastMessage?.content === trimmedMessage && lastMessage?.role === 'user')
          ? history.slice(0, -1)
          : history;
        
        // Convert to LLMMessage format (filter only user/assistant, convert roles)
        const historyMessages: LLMMessage[] = historyToInclude
          .filter(msg => msg.role === 'user' || msg.role === 'assistant')
          .map(msg => ({
            role: msg.role as 'user' | 'assistant',
            content: msg.content
          }));
        
        messages.push(...historyMessages);
      }
    }

    // Create user message
    const userMsg = buildUserMessage(trimmedMessage);
    messages.push(userMsg);

    // Get tool definitions (filter based on datasource selection)
    let tools = getMCPToolDefinitions();
    if (effectiveDatasourceLuid) {
      // When datasource is locked, exclude list-datasources to prevent querying other datasources
      tools = tools.filter(tool => tool.name !== 'list-datasources');
    }

    // Initialize iteration counter and max iterations
    const maxIter = maxIterations ?? DEFAULT_MAX_ITERATIONS;
    let iteration = 0;

    // Accumulate all tool calls and results across iterations for citation extraction
    const allToolCalls: ToolCall[] = [];
    const allToolResults: ToolResult[] = [];

    if (config.server.nodeEnv === 'development') {
      console.log(`[ToolCallingLoop] Executing query: "${trimmedMessage.substring(0, 50)}${trimmedMessage.length > 50 ? '...' : ''}" (max iterations: ${maxIter})`);
    }

    // Multi-turn loop: continue until no tool calls or max iterations reached
    while (iteration < maxIter) {
      iteration++;
      if (config.server.nodeEnv === 'development') {
        console.log(`[ToolCallingLoop] Iteration ${iteration} of ${maxIter}`);
      }

      // Stream reasoning_start event (before LLM request)
      this.safeSendSSEEvent(
        sseResponse,
        'reasoning_start',
        {
          message: 'LLM is reasoning about the query',
          timestamp: new Date().toISOString(),
          iteration: maxIter > 1 ? iteration : undefined,
        }
      );

      // Send messages to LLM
      let stream: AsyncIterable<import('./llmClient.js').LLMResponseChunk>;
      try {
        stream = await this.llmClient.streamToolCalling(messages, tools);
      } catch (error) {
        // LLM request errors: cannot continue without LLM
        // Map error to user-friendly message with recovery suggestions
        const userFriendlyError = mapErrorToUserFriendly(error);
        logError(userFriendlyError.category, userFriendlyError, 'ToolCallingLoop.LLM');
        
        // Stream error event if SSE response is available
        if (sseResponse) {
          this.safeSendSSEEvent(
            sseResponse,
            'error',
            {
              message: userFriendlyError.message,
              recoverySuggestions: userFriendlyError.recoverySuggestions,
              code: userFriendlyError.technicalDetails?.code,
              stack: userFriendlyError.technicalDetails?.stack,
              details: userFriendlyError.technicalDetails?.details,
              timestamp: new Date().toISOString(),
            }
          );
          // Re-throw original error (not wrapped) to avoid double-prefix in server.ts
          // Server.ts will check headersSent and won't send duplicate error
          throw error;
        }
        
        // If no SSE response, throw wrapped error (caller will handle)
        throw new Error(`LLM request failed: ${userFriendlyError.message}`);
      }

      // Parse tool calls from LLM response
      let toolCalls: ToolCall[];
      try {
        toolCalls = await parseToolCallsFromChunks(stream);
      } catch (error) {
        // Parsing errors: log and continue with empty tool calls (LLM may have answered directly)
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('[ToolCallingLoop] Failed to parse tool calls:', errorMessage);
        toolCalls = [];
      }

      // If no tool calls, accumulate answer text and return (final answer)
      if (toolCalls.length === 0) {
        if (config.server.nodeEnv === 'development') {
          console.log(`[ToolCallingLoop] No tool calls detected in iteration ${iteration}, final answer`);
        }
        // Stream answer_start event
        this.safeSendSSEEvent(
          sseResponse,
          'answer_start',
          {
            message: 'LLM is generating answer',
            timestamp: new Date().toISOString(),
          }
        );
        // Re-send request to get answer (since we consumed the stream for parsing)
        // This is a limitation: parseToolCallsFromChunks consumes the stream
        // Can be optimized later by accumulating answer while parsing
        try {
          const answerStream = await this.llmClient.streamToolCalling(messages, tools);
          // Stream answer chunks and accumulate answer text
          let answer = await this.streamAnswerChunks(answerStream, sseResponse);
          
          // Detect field name corrections and append note if any (Phase 8: Success-path correction notes)
          if (allToolCalls.length > 0) {
            const corrections = detectFieldCorrections(userMessage, allToolCalls);
            const correctionNote = buildCorrectionNote(corrections);
            if (correctionNote) {
              answer += correctionNote;
            }
          }
          
          // Extract citations from all tool calls before returning answer
          let citations: Citation[] = [];
          try {
            citations = extractCitations(allToolCalls, allToolResults);
            // Strip result field from citations to cap payload size (per addendum requirement)
            const citationsForSSE = citations.map(({ result, ...citation }) => citation);
            // Stream answer_complete event with citations (additive change: add citations field, do not modify existing fields)
            this.safeSendSSEEvent(
              sseResponse,
              'answer_complete',
              {
                text: answer,
                timestamp: new Date().toISOString(),
                citations: citationsForSSE.length > 0 ? citationsForSSE : undefined,
              }
            );
          } catch (citationError) {
            // Log warning but continue without citations
            const errorMessage = citationError instanceof Error ? citationError.message : String(citationError);
            if (config.server.nodeEnv === 'development') {
              console.warn(`[ToolCallingLoop] Failed to extract citations: ${errorMessage}`);
            }
            // Stream answer_complete event without citations
            this.safeSendSSEEvent(
              sseResponse,
              'answer_complete',
              {
                text: answer,
                timestamp: new Date().toISOString(),
              }
            );
          }
          if (config.server.nodeEnv === 'development') {
            console.log(`[ToolCallingLoop] Answer synthesized: ${answer.length} chars`);
          }
          return answer;
        } catch (error) {
          // Map error to user-friendly message with recovery suggestions
          const userFriendlyError = mapErrorToUserFriendly(error);
          logError(userFriendlyError.category, userFriendlyError, 'ToolCallingLoop.Answer');
          
          // Stream error event
          this.safeSendSSEEvent(
            sseResponse,
            'error',
            {
              message: userFriendlyError.message,
              recoverySuggestions: userFriendlyError.recoverySuggestions,
              code: userFriendlyError.technicalDetails?.code,
              stack: userFriendlyError.technicalDetails?.stack,
              details: userFriendlyError.technicalDetails?.details,
              timestamp: new Date().toISOString(),
            }
          );
          throw new Error(`Failed to get answer: ${userFriendlyError.message}`);
        }
      }

      // Tool calls found: execute them and prepare for next iteration
      if (config.server.nodeEnv === 'development') {
        console.log(`[ToolCallingLoop] Detected ${toolCalls.length} tool call(s) in iteration ${iteration}`);
      }

      // Execute tool calls sequentially
      const toolResults: ToolResult[] = [];
      
      // Accumulate tool calls for citation extraction
      allToolCalls.push(...toolCalls);
      
      for (const toolCall of toolCalls) {
        if (config.server.nodeEnv === 'development') {
          console.log(`[ToolCallingLoop] Executing tool: ${toolCall.name} (${toolCall.id.substring(0, 8)}...)`);
        }
        // Stream tool_call_start event
        this.safeSendSSEEvent(
          sseResponse,
          'tool_call_start',
          {
            tool: toolCall.name,
            parameters: toolCall.input,
            timestamp: new Date().toISOString(),
            iteration: maxIter > 1 ? iteration : undefined,
          },
          toolCall.id
        );
        // Execute tool call
        const result = await this.executeToolCall(toolCall, effectiveDatasourceLuid);
        toolResults.push(result);
        
        // Accumulate tool result for citation extraction
        allToolResults.push(result);
        // Stream tool_call_complete event (with result summary)
        // Parse result content to create summary (avoid streaming full data)
        let resultSummary: unknown = { success: !result.isError };
        try {
          if (result.content) {
            const parsedContent = JSON.parse(result.content);
            // Create summary: include success status and basic info, but not full data
            if (typeof parsedContent === 'object' && parsedContent !== null) {
              resultSummary = {
                success: !result.isError,
                // Include top-level keys for context, but not full nested data
                keys: Object.keys(parsedContent).slice(0, 5), // Limit to first 5 keys
                hasData: Array.isArray(parsedContent) ? parsedContent.length > 0 : Object.keys(parsedContent).length > 0,
              };
            } else {
              resultSummary = { success: !result.isError, type: typeof parsedContent };
            }
          }
        } catch {
          // If parsing fails, use simple summary
          resultSummary = { success: !result.isError, hasContent: !!result.content };
        }
        this.safeSendSSEEvent(
          sseResponse,
          'tool_call_complete',
          {
            tool: toolCall.name,
            result: resultSummary,
            timestamp: new Date().toISOString(),
            iteration: maxIter > 1 ? iteration : undefined,
          },
          toolCall.id
        );
      }

      // Build assistant message with tool calls
      const assistantMessage = buildAssistantMessageWithToolCalls(toolCalls);

      // Build user message with tool results
      const toolResultMessage = buildUserMessageWithToolResults(toolResults);

      // Append to messages array for next iteration
      messages.push(assistantMessage, toolResultMessage);

      // Continue loop to check if LLM generates additional tool calls
    }

    // Max iterations reached
    if (config.server.nodeEnv === 'development') {
      console.warn(`[ToolCallingLoop] Max iterations (${maxIter}) reached, attempting to get partial answer`);
    }

    // Stream answer_start event (max iterations reached, attempting to get partial answer)
    this.safeSendSSEEvent(
      sseResponse,
      'answer_start',
      {
        message: 'Max iterations reached, attempting to get partial answer',
        timestamp: new Date().toISOString(),
      }
    );
    // Try to get answer from last response (may have partial answer even if tool calls were generated)
    try {
      const answerStream = await this.llmClient.streamToolCalling(messages, tools);
      // Stream answer chunks and accumulate answer text
      let answer = await this.streamAnswerChunks(answerStream, sseResponse);
      
      // Detect field name corrections and append note if any (Phase 8: Success-path correction notes)
      if (allToolCalls.length > 0) {
        const corrections = detectFieldCorrections(userMessage, allToolCalls);
        const correctionNote = buildCorrectionNote(corrections);
        if (correctionNote) {
          answer += correctionNote;
        }
      }
      
      // Extract citations from all tool calls before returning answer
      let citations: Citation[] = [];
      try {
        citations = extractCitations(allToolCalls, allToolResults);
        // Strip result field from citations to cap payload size (per addendum requirement)
        const citationsForSSE = citations.map(({ result, ...citation }) => citation);
        // Stream answer_complete event with citations (additive change: add citations field, do not modify existing fields)
        this.safeSendSSEEvent(
          sseResponse,
          'answer_complete',
          {
            text: answer,
            timestamp: new Date().toISOString(),
            citations: citationsForSSE.length > 0 ? citationsForSSE : undefined,
          }
        );
      } catch (citationError) {
        // Log warning but continue without citations
        const errorMessage = citationError instanceof Error ? citationError.message : String(citationError);
        if (config.server.nodeEnv === 'development') {
          console.warn(`[ToolCallingLoop] Failed to extract citations: ${errorMessage}`);
        }
        // Stream answer_complete event without citations
        this.safeSendSSEEvent(
          sseResponse,
          'answer_complete',
          {
            text: answer,
            timestamp: new Date().toISOString(),
          }
        );
      }
      if (config.server.nodeEnv === 'development') {
        console.log(`[ToolCallingLoop] Partial answer synthesized: ${answer.length} chars`);
      }
      return answer;
    } catch (error) {
      // If we can't get an answer, map error to user-friendly message
      const userFriendlyError = mapErrorToUserFriendly(error);
      logError(userFriendlyError.category, userFriendlyError, 'ToolCallingLoop.MaxIterations');
      
      // Stream error event with user-friendly message and recovery suggestions
      this.safeSendSSEEvent(
        sseResponse,
        'error',
        {
          message: `Max iterations (${maxIter}) reached. ${userFriendlyError.message}`,
          recoverySuggestions: userFriendlyError.recoverySuggestions,
          code: userFriendlyError.technicalDetails?.code,
          stack: userFriendlyError.technicalDetails?.stack,
          details: userFriendlyError.technicalDetails?.details,
          timestamp: new Date().toISOString(),
        }
      );
      throw new Error(`Max iterations (${maxIter}) reached and failed to get answer: ${userFriendlyError.message}`);
    }
  }
}
