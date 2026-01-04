/**
 * Main Express server
 * Phase 1, Task 6: Enhanced with Heroku deployment support
 * 
 * This file handles:
 * - Express server setup
 * - CORS configuration
 * - Request logging
 * - Error handling
 * - Environment variable validation
 * - Graceful shutdown
 * - Health check endpoints
 * - SSE endpoint for streaming progress updates
 * - Static file serving in production (for Heroku deployment)
 * - SPA routing support (serve index.html for non-API routes)
 * 
 * Chat API endpoint will be implemented in Phase 4/5
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { requestLogger } from './middleware/requestLogger.js';
import { contentTypeValidator, jsonValidator } from './middleware/validator.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createNotFoundResponse } from './utils/errors.js';
import { config } from './config.js';
import { setupSSEHeaders, sendSSEEvent, sendKeepAlive, hasSSEEventBeenSent } from './utils/sse.js';
import { MCPClient } from './mcpClient.js';
import { ToolCallingLoop } from './toolCallingLoop.js';
import { conversationStateManager } from './conversationState.js';
import { needsClarification } from './utils/clarification.js';
import { appendFileSync } from 'fs';
import { join } from 'path';
import { mapErrorToUserFriendly, logError } from './utils/errorMapping.js';

/**
 * Helper to check if environment variable is truthy
 * @param name - Environment variable name
 * @returns true if variable is set and not '0' or 'false'
 */
function envTruthy(name: string): boolean {
  const v = process.env[name];
  return !!v && v !== '0' && v.toLowerCase() !== 'false';
}

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * MCP client instance (singleton pattern)
 * Created lazily on first use
 */
let mcpClientInstance: MCPClient | null = null;

/**
 * Get or create MCP client instance
 * 
 * @returns MCPClient instance
 */
function getMCPClient(): MCPClient {
  if (!mcpClientInstance) {
    mcpClientInstance = new MCPClient();
  }
  return mcpClientInstance;
}

/**
 * Datasources cache entry structure
 */
interface DatasourcesCache {
  value: unknown;
  expiresAt: number;
}

/**
 * Cache expiration time (30 seconds in milliseconds)
 */
const DATASOURCES_CACHE_TTL_MS = 30_000; // 30 seconds

/**
 * In-memory cache for datasources list
 */
let datasourcesCache: DatasourcesCache | null = null;

/**
 * In-flight promise for datasources fetch (deduplication)
 */
let datasourcesInflight: Promise<unknown> | null = null;

// Configuration is loaded and validated in config.ts
// If validation fails, the module will throw and server won't start

const app = express();
const PORT = config.server.port;
const NODE_ENV = config.server.nodeEnv;

// Trust proxy for accurate IP addresses
app.set('trust proxy', true);

// Middleware: Request logging (before other middleware)
app.use(requestLogger);

// Middleware: CORS
app.use(cors());

// Middleware: JSON body parser with error handling
app.use((req, res, next) => {
  const logData6 = {location:'server.ts:54',message:'express.json() middleware entry',data:{method:req.method,path:req.path,contentType:req.get('Content-Type'),headersSent:res.headersSent},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'};
  // #region agent log
  try { appendFileSync(join(process.cwd(), '.cursor', 'debug.log'), JSON.stringify(logData6) + '\n'); } catch(e) {}
  fetch('http://127.0.0.1:7244/ingest/b9d8e7ea-3287-4df8-9822-82a2acc3f9c2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData6)}).catch(()=>{});
  // #endregion
  express.json()(req, res, (err) => {
    const logData7 = {location:'server.ts:58',message:'express.json() middleware exit',data:{method:req.method,hasError:!!err,errorType:err?.constructor?.name,headersSent:res.headersSent},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'};
    // #region agent log
    try { appendFileSync(join(process.cwd(), '.cursor', 'debug.log'), JSON.stringify(logData7) + '\n'); } catch(e) {}
    fetch('http://127.0.0.1:7244/ingest/b9d8e7ea-3287-4df8-9822-82a2acc3f9c2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData7)}).catch(()=>{});
    // #endregion
    if (err) return next(err);
    next();
  });
});

// Middleware: Content-Type validation for POST/PUT/PATCH
app.use(contentTypeValidator);

// Middleware: JSON parsing error handler
app.use(jsonValidator);

// Track server start time for uptime calculation
const serverStartTime = Date.now();

/**
 * Enhanced health check endpoint
 * Returns server status, phase, timestamp, and uptime
 */
function getHealthResponse(): {
  status: string;
  phase: string;
  timestamp: string;
  uptime: number;
} {
  const uptime = Math.floor((Date.now() - serverStartTime) / 1000); // seconds
  return {
    status: 'ok',
    phase: 'Phase 1: Backend infrastructure setup',
    timestamp: new Date().toISOString(),
    uptime,
  };
}

// Health check routes
app.get('/health', (_req: Request, res: Response) => {
  res.json(getHealthResponse());
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.json(getHealthResponse());
});

// GET /api/datasources endpoint - Fetch available datasources
app.get('/api/datasources', async (_req: Request, res: Response) => {
  try {
    // Check cache first
    const now = Date.now();
    if (datasourcesCache && datasourcesCache.expiresAt > now) {
      // Cache hit - return cached value
      return res.json(datasourcesCache.value);
    }

    // Check if fetch is already in progress
    if (datasourcesInflight) {
      // Wait for in-flight request and return its result
      const result = await datasourcesInflight;
      return res.json(result);
    }

    // Start new fetch
    const fetchPromise = (async () => {
      try {
        const mcpClient = getMCPClient();
    const datasources = await mcpClient.listDatasources();
        
        // Store in cache with expiration
        datasourcesCache = {
          value: datasources,
          expiresAt: now + DATASOURCES_CACHE_TTL_MS,
        };
        
        return datasources;
      } finally {
        // Clear in-flight promise when done
        datasourcesInflight = null;
      }
    })();

    // Set in-flight promise
    datasourcesInflight = fetchPromise;

    // Wait for result and return
    const result = await fetchPromise;
    return res.json(result);
  } catch (error) {
    // Clear in-flight promise on error
    datasourcesInflight = null;
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Server] Error fetching datasources:', errorMessage);
    return res.status(500).json({
      error: 'Failed to fetch datasources',
      message: errorMessage,
    });
  }
});

// SSE endpoint for streaming progress updates
app.get('/api/events', (req: Request, res: Response) => {
  setupSSEHeaders(res);
  
  // Send initial connection event
  sendSSEEvent(res, 'connected', { 
    message: 'SSE connection established',
    timestamp: new Date().toISOString(),
  });
  
  // Keep-alive interval (every 30 seconds)
  const keepAliveInterval = setInterval(() => {
    sendKeepAlive(res);
  }, 30000);
  
  // Cleanup on client disconnect
  req.on('close', () => {
    clearInterval(keepAliveInterval);
    console.log('SSE client disconnected');
  });
  
  req.on('error', (error) => {
    clearInterval(keepAliveInterval);
    console.error('SSE connection error:', error);
  });
});

// Test endpoint for streaming sample events
app.get('/api/events/test', (req: Request, res: Response) => {
  setupSSEHeaders(res);
  
  // Send initial connection event
  sendSSEEvent(res, 'connected', { 
    message: 'Test SSE connection established',
    timestamp: new Date().toISOString(),
  });
  
  // Stream sample events to demonstrate SSE functionality
  setTimeout(() => {
    sendSSEEvent(res, 'reasoning_start', { 
      message: 'Starting reasoning...',
      timestamp: new Date().toISOString(),
    });
  }, 500);
  
  setTimeout(() => {
    sendSSEEvent(res, 'tool_call_start', { 
      tool: 'query-datasource',
      parameters: { datasourceLuid: 'example-luid' },
      timestamp: new Date().toISOString(),
    });
  }, 1500);
  
  setTimeout(() => {
    sendSSEEvent(res, 'tool_call_complete', { 
      tool: 'query-datasource',
      result: { rows: 10, columns: 5 },
      timestamp: new Date().toISOString(),
    });
  }, 2500);
  
  setTimeout(() => {
    sendSSEEvent(res, 'answer_start', { 
      message: 'Generating answer...',
      timestamp: new Date().toISOString(),
    });
  }, 3000);
  
  setTimeout(() => {
    sendSSEEvent(res, 'answer_chunk', { 
      text: 'Based on the data, ',
      timestamp: new Date().toISOString(),
    });
  }, 3500);
  
  setTimeout(() => {
    sendSSEEvent(res, 'answer_chunk', { 
      text: 'the results show ',
      timestamp: new Date().toISOString(),
    });
  }, 4000);
  
  setTimeout(() => {
    sendSSEEvent(res, 'answer_chunk', { 
      text: 'significant growth.',
      timestamp: new Date().toISOString(),
    });
  }, 4500);
  
  setTimeout(() => {
    sendSSEEvent(res, 'answer_complete', { 
      text: 'Based on the data, the results show significant growth.',
      citations: [],
      timestamp: new Date().toISOString(),
    });
    res.end();
  }, 5000);
  
  // Cleanup on client disconnect
  req.on('close', () => {
    console.log('Test SSE client disconnected');
  });
  
  req.on('error', (error) => {
    console.error('Test SSE connection error:', error);
  });
});

// GET /api/chat/history endpoint - Fetch conversation history
app.get('/api/chat/history', (req: Request, res: Response) => {
  try {
    const sessionId = req.query.sessionId as string | undefined;
    
    // If no sessionId provided, return empty history
    if (!sessionId || typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      return res.json({ messages: [] });
    }

    // Get session state
    const state = conversationStateManager.getState(sessionId.trim());
    
    // If session not found, return empty history (graceful degradation)
    if (!state) {
      return res.json({ messages: [] });
    }

    // Return messages from session state
    return res.json({ messages: state.messages });
  } catch (error) {
    // On any error, return empty history (graceful degradation)
    if (config.server.nodeEnv === 'development') {
      console.error('[GET /api/chat/history] Error:', error);
    }
    return res.json({ messages: [] });
  }
});

// POST /api/chat endpoint - Chat API with SSE streaming
interface ChatRequest {
  message: string;
  sessionId?: string;
  datasourceLuid?: string;
  workbookId?: string;
  viewId?: string;
}

app.post('/api/chat', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validate request body
    const body = req.body as ChatRequest;
    if (!body || typeof body.message !== 'string' || body.message.trim().length === 0) {
      res.status(400).json({
        error: 'Invalid request',
        message: 'Request body must contain a non-empty "message" field',
      });
      return;
    }

    const { message, sessionId, datasourceLuid, workbookId, viewId } = body;

    // Get or create session state
    const state = conversationStateManager.getOrCreate(sessionId, {
      currentDatasourceLuid: datasourceLuid,
      currentWorkbookId: workbookId,
      currentViewId: viewId,
    });

    // Set up SSE headers
    setupSSEHeaders(res);
    
    // Set session ID header immediately after SSE headers (before any SSE events)
    res.setHeader('x-session-id', state.sessionId);
    
    // Test hook: flushHeaders (for edge case validation - headers sent before SSE events)
    if (envTruthy('SSE_TEST_FLUSH')) {
      (res as any).flushHeaders?.();
    }

    // Update context if request provides datasource/workbook/view fields
    if (datasourceLuid || workbookId || viewId) {
      conversationStateManager.updateContext(state.sessionId, {
        currentDatasourceLuid: datasourceLuid,
        currentWorkbookId: workbookId,
        currentViewId: viewId,
      });
    }

    // Add user message to session state
    conversationStateManager.addMessage(state.sessionId, 'user', message.trim());

    // Check if clarification is needed before executing tool calls
    const clarification = needsClarification(message.trim(), state);
    if (clarification.needsClarification && clarification.question) {
      // Stream clarification as assistant response
      sendSSEEvent(res, 'answer_start', {
        timestamp: new Date().toISOString(),
      });
      
      // Stream clarification text as answer chunks
      const clarificationText = clarification.question;
      sendSSEEvent(res, 'answer_chunk', {
        text: clarificationText,
        timestamp: new Date().toISOString(),
      });
      
      // Complete clarification response
      sendSSEEvent(res, 'answer_complete', {
        text: clarificationText,
        timestamp: new Date().toISOString(),
        citations: [],
      });
      
      // Store clarification in session state
      conversationStateManager.addMessage(state.sessionId, 'assistant', clarificationText);
      
      // End response
      if (!res.writableEnded) {
        res.end();
      }
      return;
    }

    // Resolve context for this turn (use request values or fall back to session state)
    const resolvedDatasourceLuid = datasourceLuid ?? state.currentDatasourceLuid;
    const resolvedWorkbookId = workbookId ?? state.currentWorkbookId;
    const resolvedViewId = viewId ?? state.currentViewId;

    // Create ToolCallingLoop instance
    const toolCallingLoop = new ToolCallingLoop();

    // Execute with SSE response and sessionId
    try {
      const answer = await toolCallingLoop.execute(
        message.trim(),
        resolvedDatasourceLuid,
        resolvedWorkbookId,
        resolvedViewId,
        undefined, // maxIterations (use default)
        res, // SSE response
        state.sessionId // sessionId for context-aware responses
      );

      // Add assistant message to session state
      conversationStateManager.addMessage(state.sessionId, 'assistant', answer);

      // Note: answer_complete event is already sent by ToolCallingLoop
      // Connection will be closed by ToolCallingLoop or we can close it here
      // For now, let ToolCallingLoop handle the complete event
      // End the response after execution completes (only if not already ended)
      if (!res.writableEnded) {
        res.end();
      }
    } catch (error) {
      // Error events are already streamed by ToolCallingLoop if streaming has started
      // Only send error event if nothing has been streamed yet (safety net for failures before streaming)
      // Map error to user-friendly message with recovery suggestions
      const userFriendlyError = mapErrorToUserFriendly(error);
      
      // Merge typo suggestions from error object if present (Phase 8, Tasks 1/2/5: FR-6/AC-6)
      // Typo suggestions are computed in toolCallingLoop and attached to error.recoverySuggestions
      if (error && typeof error === 'object' && 'recoverySuggestions' in error) {
        const errorSuggestions = (error as { recoverySuggestions?: string[] }).recoverySuggestions;
        if (Array.isArray(errorSuggestions) && errorSuggestions.length > 0) {
          // Merge and deduplicate suggestions
          const existing = userFriendlyError.recoverySuggestions || [];
          const merged = [...new Set([...existing, ...errorSuggestions])];
          userFriendlyError.recoverySuggestions = merged;
        }
      }
      
      logError(userFriendlyError.category, userFriendlyError, 'Server./api/chat');
      
      // Only send error event if no SSE events have been sent yet (ToolCallingLoop hasn't streamed anything)
      // Guard against destroyed connections and already-ended responses
      if (!hasSSEEventBeenSent(res) && !res.writableEnded && !res.destroyed) {
        // Only set headers if they haven't been sent yet (prevents ERR_HTTP_HEADERS_SENT)
        if (!res.headersSent) {
          setupSSEHeaders(res);
        }
        sendSSEEvent(res, 'error', {
          message: userFriendlyError.message,
          recoverySuggestions: userFriendlyError.recoverySuggestions,
          code: userFriendlyError.technicalDetails?.code,
          stack: userFriendlyError.technicalDetails?.stack,
          details: userFriendlyError.technicalDetails?.details,
          timestamp: new Date().toISOString(),
        });
      }
      
      // Session state persists after errors (session is not deleted)
      // User message was already added to session state before error occurred
      // This ensures conversation context is maintained even after errors
      
      // End response only if not already ended
      if (!res.writableEnded) {
        res.end();
      }
    }
  } catch (error) {
    // Handle request parsing or other errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('[Server] Error in /api/chat:', errorMessage);
    next(error); // Pass to global error handler
  }
});

// In production, serve static files from dist/client
if (NODE_ENV === 'production') {
  const clientDistPath = path.join(__dirname, '../client');
  
  // Serve static files (CSS, JS, images, etc.)
  app.use(express.static(clientDistPath, {
    maxAge: '1y', // Cache static assets for 1 year
    etag: true,
  }));
  
  // Serve index.html for all non-API routes (SPA routing)
  // This must come after API routes but before 404 handler
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    // Skip API routes and SSE routes (already handled above)
    // Pass to next middleware (404 handler) for API routes
    if (req.path.startsWith('/api/') || req.path.startsWith('/events')) {
      return next();
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// 404 handler for unknown routes (must be after all routes)
app.use((req: Request, res: Response) => {
  const logData8 = {location:'server.ts:96',message:'404 handler reached',data:{method:req.method,path:req.path,headersSent:res.headersSent},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'};
  // #region agent log
  try { appendFileSync(join(process.cwd(), '.cursor', 'debug.log'), JSON.stringify(logData8) + '\n'); } catch(e) {}
  fetch('http://127.0.0.1:7244/ingest/b9d8e7ea-3287-4df8-9822-82a2acc3f9c2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData8)}).catch(()=>{});
  // #endregion
  const errorResponse = createNotFoundResponse(req.path);
  res.status(404).json(errorResponse);
});

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} (${NODE_ENV} mode)`);
});

/**
 * Graceful shutdown handler
 * Handles SIGTERM and SIGINT signals for clean server shutdown
 */
function gracefulShutdown(signal: string): void {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  
  server.close(() => {
    console.log('HTTP server closed.');
    console.log('Graceful shutdown complete.');
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10000);
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: unknown) => {
  console.error('Unhandled Rejection:', reason);
  gracefulShutdown('unhandledRejection');
});

