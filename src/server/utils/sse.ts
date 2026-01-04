/**
 * Server-Sent Events (SSE) utility functions
 * Phase 1, Task 5: SSE infrastructure setup
 * 
 * Provides helper functions for:
 * - Setting up SSE response headers
 * - Sending SSE events with custom event types
 * - Formatting SSE messages (data, event type, id)
 * - Connection keep-alive handling
 */

import { Response } from 'express';

/**
 * WeakMap to track if SSE events have been sent for a response
 * Used to determine if error events should be sent in catch blocks
 */
const sseEventSentMap = new WeakMap<Response, boolean>();

/**
 * Sets up proper SSE response headers
 * @param res - Express response object
 */
export function setupSSEHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  // CORS headers are handled by cors middleware, but we ensure they're set
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
  // Expose x-session-id header for client-side session persistence
  res.setHeader('Access-Control-Expose-Headers', 'x-session-id');
}

/**
 * Sends an SSE event with custom event type
 * @param res - Express response object
 * @param event - Event type (e.g., 'reasoning_start', 'tool_call_start', 'answer_chunk')
 * @param data - Event data (will be JSON stringified)
 * @param id - Optional event ID for reconnection support
 */
export function sendSSEEvent(
  res: Response,
  event: string,
  data: unknown,
  id?: string
): void {
  try {
    if (id) {
      res.write(`id: ${id}\n`);
    }
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    // Set flag after successful write to ensure bytes were actually written
    sseEventSentMap.set(res, true);
  } catch (error) {
    // Handle write errors (e.g., client disconnected)
    console.error('Error sending SSE event:', error);
  }
}

/**
 * Check if any SSE events have been sent for this response
 * @param res - Express response object
 * @returns true if at least one SSE event has been successfully written
 */
export function hasSSEEventBeenSent(res: Response): boolean {
  return sseEventSentMap.get(res) ?? false;
}

/**
 * Sends a keep-alive comment to maintain connection
 * @param res - Express response object
 */
export function sendKeepAlive(res: Response): void {
  try {
    res.write(': keep-alive\n\n');
  } catch (error) {
    // Handle write errors (e.g., client disconnected)
    console.error('Error sending keep-alive:', error);
  }
}

/**
 * SSE event types used throughout the application
 */
export type SSEEventType =
  | 'connected'
  | 'reasoning_start'
  | 'tool_call_start'
  | 'tool_call_complete'
  | 'answer_start'
  | 'answer_chunk'
  | 'answer_complete'
  | 'error';

