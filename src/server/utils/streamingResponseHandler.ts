/**
 * Streaming Response Handler Utilities
 * Phase 3, Task 3: Implement streaming response handling
 * 
 * This module provides utility functions for:
 * - Detecting response phases (reasoning, tool calls, answer)
 * - Extracting answer text from streaming chunks
 * - Tracking state transitions through streaming responses
 * - Processing different chunk types appropriately
 * - Aggregating chunks into meaningful information
 * 
 * CRITICAL: Never hard-code tool names, field names, or values
 * Always use dynamic parameters from function arguments
 */

import type { LLMResponseChunk } from '../llmClient.js';
import type { ToolCall } from './toolCallingFormat.js';
import { extractToolCallFromChunk } from './toolCallingFormat.js';

/**
 * Response phase type
 * Represents the current phase of the LLM response stream
 */
export type ResponsePhase = 'reasoning' | 'tool_calls' | 'answer' | 'complete';

/**
 * Chunk processing result
 * Contains extracted information from a processed chunk
 */
export interface ChunkProcessingResult {
  /** Current phase detected from chunk */
  phase?: ResponsePhase | null;
  /** Whether this chunk represents a phase transition */
  phaseTransition?: boolean;
  /** Tool call extracted from chunk (if applicable) */
  toolCall?: ToolCall | null;
  /** Answer text extracted from chunk (if applicable) */
  answerText?: string | null;
  /** Whether the response is complete */
  isComplete?: boolean;
}

/**
 * Response state tracker
 * Tracks the current state of a streaming response
 */
export interface ResponseState {
  /** Current phase */
  phase: ResponsePhase | null;
  /** Accumulated answer text */
  answerText: string;
  /** Tool calls detected so far */
  toolCalls: ToolCall[];
  /** Whether response is complete */
  isComplete: boolean;
}

/**
 * Detect response phase from chunk type
 * 
 * Determines the current phase of the LLM response based on chunk type:
 * - 'reasoning': message_start (LLM is thinking/deciding)
 * - 'tool_calls': content_block_start with tool_use (LLM is calling tools)
 * - 'answer': content_block_delta with text_delta (LLM is generating answer)
 * - 'complete': message_stop (response is complete)
 * 
 * @param chunk - LLM response chunk to analyze
 * @returns Detected phase or null if chunk doesn't indicate a phase
 * 
 * @example
 * ```typescript
 * const chunk: LLMResponseChunk = { type: 'message_start', ... };
 * const phase = detectPhase(chunk);
 * // Returns: 'reasoning'
 * 
 * const toolChunk: LLMResponseChunk = {
 *   type: 'content_block_start',
 *   content_block: { type: 'tool_use', id: 'tool_123', name: 'query-datasource', ... }
 * };
 * const toolPhase = detectPhase(toolChunk);
 * // Returns: 'tool_calls'
 * ```
 */
export function detectPhase(chunk: LLMResponseChunk): ResponsePhase | null {
  if (!chunk || typeof chunk !== 'object') {
    return null;
  }

  // Reasoning phase: message_start (LLM is thinking)
  if (chunk.type === 'message_start') {
    return 'reasoning';
  }

  // Tool calls phase: content_block_start with tool_use
  if (chunk.type === 'content_block_start' && chunk.content_block?.type === 'tool_use') {
    return 'tool_calls';
  }

  // Answer phase: content_block_delta with text_delta
  if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
    return 'answer';
  }

  // Answer phase: content_block_start with text
  if (chunk.type === 'content_block_start' && chunk.content_block?.type === 'text') {
    return 'answer';
  }

  // Complete phase: message_stop
  if (chunk.type === 'message_stop') {
    return 'complete';
  }

  // Unknown phase
  return null;
}

/**
 * Extract answer text from chunk
 * 
 * Extracts text content from text_delta chunks. Returns null if chunk
 * doesn't contain text content.
 * 
 * @param chunk - LLM response chunk to extract from
 * @returns Extracted text string or null
 * 
 * @example
 * ```typescript
 * const chunk: LLMResponseChunk = {
 *   type: 'content_block_delta',
 *   delta: { type: 'text_delta', text: 'Based on the data...' }
 * };
 * const text = extractAnswerText(chunk);
 * // Returns: 'Based on the data...'
 * ```
 */
export function extractAnswerText(chunk: LLMResponseChunk): string | null {
  if (!chunk || typeof chunk !== 'object') {
    return null;
  }

  // Extract from text_delta
  if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
    return chunk.delta.text || null;
  }

  // Extract from content_block text (initial text block)
  if (chunk.type === 'content_block_start' && chunk.content_block?.type === 'text') {
    return chunk.content_block.text || null;
  }

  return null;
}

/**
 * Detect if chunk represents a phase transition
 * 
 * Determines if the chunk represents a transition from one phase to another.
 * Useful for emitting progress events when phase changes.
 * 
 * @param chunk - LLM response chunk to analyze
 * @param previousPhase - Previous phase (null if no previous phase)
 * @returns true if chunk represents a phase transition
 * 
 * @example
 * ```typescript
 * let currentPhase: ResponsePhase | null = null;
 * 
 * for await (const chunk of chunks) {
 *   if (isPhaseTransition(chunk, currentPhase)) {
 *     const newPhase = detectPhase(chunk);
 *     console.log(`Phase transition: ${currentPhase} -> ${newPhase}`);
 *     currentPhase = newPhase;
 *   }
 * }
 * ```
 */
export function isPhaseTransition(
  chunk: LLMResponseChunk,
  previousPhase: ResponsePhase | null
): boolean {
  const currentPhase = detectPhase(chunk);

  // No phase detected, no transition
  if (!currentPhase) {
    return false;
  }

  // No previous phase, this is the first phase (not a transition)
  if (!previousPhase) {
    return false;
  }

  // Phase changed, this is a transition
  return currentPhase !== previousPhase;
}

/**
 * Process chunk and extract information
 * 
 * Processes a single chunk and extracts all relevant information:
 * - Current phase
 * - Phase transition status
 * - Tool call (if applicable)
 * - Answer text (if applicable)
 * - Completion status
 * 
 * @param chunk - LLM response chunk to process
 * @param state - Optional current state for tracking transitions
 * @returns ChunkProcessingResult with extracted information
 * 
 * @example
 * ```typescript
 * const chunk: LLMResponseChunk = { ... };
 * const result = processChunk(chunk);
 * 
 * if (result.phaseTransition) {
 *   console.log(`Phase changed to: ${result.phase}`);
 * }
 * 
 * if (result.answerText) {
 *   process.stdout.write(result.answerText);
 * }
 * 
 * if (result.toolCall) {
 *   console.log(`Tool call: ${result.toolCall.name}`);
 * }
 * ```
 */
export function processChunk(
  chunk: LLMResponseChunk,
  state?: ResponseState
): ChunkProcessingResult {
  if (!chunk || typeof chunk !== 'object') {
    throw new Error('Chunk must be a valid object');
  }

  const phase = detectPhase(chunk);
  const previousPhase = state?.phase || null;
  const phaseTransition = isPhaseTransition(chunk, previousPhase);

  // Extract tool call if applicable
  let toolCall: ToolCall | null = null;
  if (phase === 'tool_calls') {
    toolCall = extractToolCallFromChunk(chunk);
  }

  // Extract answer text if applicable
  const answerText = extractAnswerText(chunk);

  // Check if complete
  const isComplete = chunk.type === 'message_stop';

  return {
    phase: phase || undefined,
    phaseTransition,
    toolCall: toolCall || undefined,
    answerText: answerText || undefined,
    isComplete,
  };
}

/**
 * Accumulate answer text from streaming chunks
 * 
 * Processes a stream of chunks and aggregates all text_delta chunks
 * into a complete answer text. Useful for getting the final answer
 * after streaming completes.
 * 
 * @param chunks - AsyncIterable of LLM response chunks
 * @returns Promise resolving to complete answer text
 * 
 * @example
 * ```typescript
 * const stream = await llmClient.streamToolCalling(messages, tools);
 * const answerText = await accumulateAnswerText(stream);
 * console.log('Complete answer:', answerText);
 * ```
 */
export async function accumulateAnswerText(
  chunks: AsyncIterable<LLMResponseChunk>
): Promise<string> {
  let answerText = '';

  for await (const chunk of chunks) {
    const text = extractAnswerText(chunk);
    if (text) {
      answerText += text;
    }
  }

  return answerText;
}

/**
 * Answer Accumulator class
 * 
 * Stateful accumulator for processing streaming LLM response chunks.
 * Tracks current phase, accumulates answer text, detects phase transitions,
 * and collects tool calls.
 * 
 * Useful for Phase 4 (tool-calling loop) where state tracking is needed.
 * 
 * @example
 * ```typescript
 * const accumulator = new AnswerAccumulator();
 * 
 * for await (const chunk of chunks) {
 *   accumulator.processChunk(chunk);
 *   
 *   if (accumulator.hasPhaseTransition()) {
 *     console.log(`Phase: ${accumulator.getPhase()}`);
 *   }
 *   
 *   if (accumulator.getLatestAnswerText()) {
 *     process.stdout.write(accumulator.getLatestAnswerText());
 *   }
 * }
 * 
 * const finalAnswer = accumulator.getAnswerText();
 * const toolCalls = accumulator.getToolCalls();
 * ```
 */
export class AnswerAccumulator {
  private _phase: ResponsePhase | null = null;
  private _previousPhase: ResponsePhase | null = null;
  private _answerText: string = '';
  private _latestAnswerChunk: string = '';
  private _toolCalls: ToolCall[] = [];
  private _isComplete: boolean = false;
  private _hasTransition: boolean = false;

  /**
   * Process a chunk and update internal state
   * 
   * @param chunk - LLM response chunk to process
   */
  processChunk(chunk: LLMResponseChunk): void {
    if (!chunk || typeof chunk !== 'object') {
      return;
    }

    // Reset transition flag
    this._hasTransition = false;

    // Detect phase
    const detectedPhase = detectPhase(chunk);
    if (detectedPhase) {
      this._previousPhase = this._phase;
      this._phase = detectedPhase;
      this._hasTransition = this._previousPhase !== this._phase;
    }

    // Extract and accumulate answer text
    const text = extractAnswerText(chunk);
    if (text) {
      this._answerText += text;
      this._latestAnswerChunk = text;
    } else {
      this._latestAnswerChunk = '';
    }

    // Extract tool call
    if (detectedPhase === 'tool_calls') {
      const toolCall = extractToolCallFromChunk(chunk);
      if (toolCall) {
        // Avoid duplicates (check if tool call with same ID already exists)
        const existingIndex = this._toolCalls.findIndex((tc) => tc.id === toolCall.id);
        if (existingIndex >= 0) {
          // Update existing tool call (may have more complete input)
          this._toolCalls[existingIndex] = toolCall;
        } else {
          // Add new tool call
          this._toolCalls.push(toolCall);
        }
      }
    }

    // Check if complete
    if (chunk.type === 'message_stop') {
      this._isComplete = true;
    }
  }

  /**
   * Get current phase
   * 
   * @returns Current response phase or null
   */
  getPhase(): ResponsePhase | null {
    return this._phase;
  }

  /**
   * Get previous phase
   * 
   * @returns Previous response phase or null
   */
  getPreviousPhase(): ResponsePhase | null {
    return this._previousPhase;
  }

  /**
   * Check if there was a phase transition in the last processed chunk
   * 
   * @returns true if last chunk caused a phase transition
   */
  hasPhaseTransition(): boolean {
    return this._hasTransition;
  }

  /**
   * Get accumulated answer text
   * 
   * @returns Complete answer text accumulated so far
   */
  getAnswerText(): string {
    return this._answerText;
  }

  /**
   * Get latest answer text chunk
   * 
   * Returns the text from the most recently processed chunk (if it was a text chunk).
   * Useful for streaming updates without re-accumulating.
   * 
   * @returns Latest answer text chunk or empty string
   */
  getLatestAnswerText(): string {
    return this._latestAnswerChunk;
  }

  /**
   * Get all tool calls detected so far
   * 
   * @returns Array of tool calls
   */
  getToolCalls(): ToolCall[] {
    return [...this._toolCalls]; // Return copy to prevent external mutation
  }

  /**
   * Check if response is complete
   * 
   * @returns true if message_stop chunk was processed
   */
  isComplete(): boolean {
    return this._isComplete;
  }

  /**
   * Reset accumulator state
   * 
   * Clears all accumulated data and resets to initial state.
   * Useful for processing multiple responses with the same accumulator.
   */
  reset(): void {
    this._phase = null;
    this._previousPhase = null;
    this._answerText = '';
    this._latestAnswerChunk = '';
    this._toolCalls = [];
    this._isComplete = false;
    this._hasTransition = false;
  }
}


