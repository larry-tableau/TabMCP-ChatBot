/**
 * Conversation State Management
 * Phase 7, Task 1: Implement session state management (persist for chat session)
 * 
 * This file handles:
 * - Session state management (persist for chat session)
 * - Conversation history
 * - Context-aware follow-ups
 * - Current datasource/workbook/view context
 * 
 * CRITICAL: Never hard-code datasource LUIDs, workbook IDs, or view IDs
 * Store them in session state dynamically
 */

import { randomUUID } from 'node:crypto';

export interface ConversationState {
  sessionId: string;
  messages: Array<{ role: string; content: string }>;
  currentDatasourceLuid?: string;
  currentDatasourceName?: string;
  currentWorkbookId?: string;
  currentWorkbookName?: string;
  currentViewId?: string;
  currentViewName?: string;
  lastAccessAt?: number; // Optional timestamp for TTL cleanup
}

export class ConversationStateManager {
  private sessions: Map<string, ConversationState> = new Map();

  /**
   * Create a new session with optional initial context
   * Never accepts caller-provided sessionId or messages (server-generated only)
   */
  createSession(initial?: Partial<ConversationState>): ConversationState {
    const sessionId = randomUUID();
    const now = Date.now();
    
    const state: ConversationState = {
      sessionId,
      messages: [], // Always fresh, do not accept initial.messages
      lastAccessAt: now,
      // Copy only context fields from initial
      currentDatasourceLuid: initial?.currentDatasourceLuid,
      currentDatasourceName: initial?.currentDatasourceName,
      currentWorkbookId: initial?.currentWorkbookId,
      currentWorkbookName: initial?.currentWorkbookName,
      currentViewId: initial?.currentViewId,
      currentViewName: initial?.currentViewName,
    };
    
    this.sessions.set(sessionId, state);
    return state;
  }

  /**
   * Get existing state or create new session
   * Unknown/invalid sessionId is treated as "start a new session", not an error
   */
  getOrCreate(sessionId?: string, initial?: Partial<ConversationState>): ConversationState {
    if (sessionId && this.sessions.has(sessionId)) {
      // Existing session: touch it and merge context if provided
      const state = this.sessions.get(sessionId)!;
      state.lastAccessAt = Date.now();
      
      if (initial) {
        this.updateContext(sessionId, initial);
      }
      
      return state;
    } else {
      // Create new session
      return this.createSession(initial);
    }
  }

  /**
   * Get session state by ID
   * Touches the session (updates lastAccessAt) if found
   */
  getState(sessionId: string): ConversationState | undefined {
    const state = this.sessions.get(sessionId);
    if (state) {
      state.lastAccessAt = Date.now();
    }
    return state;
  }

  /**
   * Update only context fields (whitelist approach)
   * Ignores sessionId, messages, and caller-supplied lastAccessAt
   */
  updateContext(
    sessionId: string,
    context: Partial<Pick<ConversationState, 'currentDatasourceLuid' | 'currentDatasourceName' | 'currentWorkbookId' | 'currentWorkbookName' | 'currentViewId' | 'currentViewName'>>
  ): void {
    const state = this.sessions.get(sessionId);
    if (!state) {
      return; // No-op if session not found
    }

    // Whitelist: only update context fields
    if (context.currentDatasourceLuid !== undefined) {
      state.currentDatasourceLuid = context.currentDatasourceLuid;
    }
    if (context.currentDatasourceName !== undefined) {
      state.currentDatasourceName = context.currentDatasourceName;
    }
    if (context.currentWorkbookId !== undefined) {
      state.currentWorkbookId = context.currentWorkbookId;
    }
    if (context.currentWorkbookName !== undefined) {
      state.currentWorkbookName = context.currentWorkbookName;
    }
    if (context.currentViewId !== undefined) {
      state.currentViewId = context.currentViewId;
    }
    if (context.currentViewName !== undefined) {
      state.currentViewName = context.currentViewName;
    }

    // Touch the session
    state.lastAccessAt = Date.now();
    this.sessions.set(sessionId, state);
  }

  /**
   * Add a message to session state
   * Bounds stored history to 50 messages (keeps last 49, then appends new one)
   */
  addMessage(sessionId: string, role: string, content: string): void {
    const state = this.getState(sessionId);
    if (!state) {
      return; // No-op if session not found
    }

    // Bound stored history: if length >= 50, keep last 49 then append new one
    if (state.messages.length >= 50) {
      state.messages = state.messages.slice(-49);
    }
    
    state.messages.push({ role, content });
    state.lastAccessAt = Date.now();
    this.sessions.set(sessionId, state);
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Cleanup expired sessions (TTL-based)
   * Removes sessions idle for longer than ttlMs
   */
  cleanupExpired(ttlMs: number): void {
    const now = Date.now();
    const expiredSessionIds: string[] = [];

    for (const [sessionId, state] of this.sessions.entries()) {
      const lastAccess = state.lastAccessAt ?? now; // Treat missing as "now" for safety
      if (now - lastAccess > ttlMs) {
        expiredSessionIds.push(sessionId);
      }
    }

    for (const sessionId of expiredSessionIds) {
      this.sessions.delete(sessionId);
    }
  }
}

// Export singleton instance for use across the application
export const conversationStateManager = new ConversationStateManager();

// Optional: Start TTL cleanup interval (60 minutes idle, check every 5 minutes)
// Defer this if you don't expect lots of demo sessions over long uptime
// Uncomment to enable:
// setInterval(() => {
//   conversationStateManager.cleanupExpired(60 * 60 * 1000); // 60 minutes
// }, 5 * 60 * 1000); // Every 5 minutes

