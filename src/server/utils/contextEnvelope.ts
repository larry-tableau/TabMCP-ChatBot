/**
 * Context Envelope Utilities
 * Phase 4, Task 1: Build and maintain an LLM context envelope
 * 
 * This module provides utilities for:
 * - Building LLM context envelopes with complete datasource metadata (fields, types, roles, descriptions)
 * - Formatting metadata as a context string that is sent to the LLM as a system message
 * - Caching context to avoid repeated MCP calls
 * - Invalidating and refreshing cache on selection changes
 * - Building metadata indices (aliasIndex, metricFields, timeFields) for clarification logic
 * 
 * **How Metadata is Used:**
 * The formatted context string is sent to the LLM in every query as part of the system message.
 * The LLM uses this metadata to:
 * - Understand available fields and their data types
 * - Know which fields are dimensions vs measures
 * - Generate accurate tool calls with correct field names
 * - Provide context-aware answers about the data structure
 * 
 * **Implementation Flow:**
 * 1. `buildContextEnvelope()` fetches metadata from MCP and formats it
 * 2. Context string is cached per datasource (5-minute expiration)
 * 3. `toolCallingLoop.ts` retrieves context and includes it in LLM system message
 * 4. LLM receives metadata and uses it for query understanding and tool-calling
 * 
 * CRITICAL: Never hard-code datasource LUIDs, workbook IDs, or view IDs
 * Always use dynamic parameters from function arguments or config
 */

import type {
  DatasourceMetadata,
} from '../mcpClient.js';
import { MCPClient } from '../mcpClient.js';
import { config } from '../config.js';

/**
 * Context cache entry structure
 */
interface ContextCache {
  /** Datasource LUID (cache key) */
  datasourceLuid: string;
  /** Datasource name (from metadata or config) */
  datasourceName?: string;
  /** Datasource description (from metadata) */
  datasourceDescription?: string;
  /** Datasource metadata (fields, parameters) */
  datasourceMetadata?: DatasourceMetadata;
  /** Workbook ID (for lineage tags) */
  workbookId?: string;
  /** Workbook name (for lineage tags) */
  workbookName?: string;
  /** View ID (for lineage tags) */
  viewId?: string;
  /** View name (for lineage tags) */
  viewName?: string;
  /** Formatted context string */
  contextString?: string;
  /** Alias index: token → list of candidate field names */
  aliasIndex?: Record<string, string[]>;
  /** Metric fields: fields that are measures or quantitative numeric fields */
  metricFields?: string[];
  /** Time fields: fields with DATE dataType (primary) or time-related descriptions (fallback) */
  timeFields?: string[];
  /** Cache timestamp (milliseconds since epoch) */
  timestamp: number;
}

/**
 * Cache expiration time (5 minutes in milliseconds)
 */
const CACHE_EXPIRATION_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Maximum cache size (LRU eviction if exceeded)
 */
const MAX_CACHE_SIZE = 10;

/**
 * In-memory cache for context envelopes
 * Key: datasourceLuid
 * Value: ContextCache entry
 */
const contextCache = new Map<string, ContextCache>();

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
 * Sanitize description text by trimming whitespace and limiting length
 * 
 * @param desc - Description text to sanitize
 * @param maxLength - Maximum length (default: 300)
 * @returns Sanitized description or undefined if empty
 */
function sanitizeDescription(desc?: string, maxLength = 300): string | undefined {
  if (!desc?.trim()) return undefined;
  const cleaned = desc.replace(/\s+/g, ' ').trim();
  return cleaned.length <= maxLength ? cleaned : cleaned.slice(0, maxLength) + '...';
}

/**
 * Build indices from datasource metadata for clarification logic
 * Single source of truth - import/use elsewhere if needed
 * 
 * @param metadata - Datasource metadata (fields, parameters)
 * @returns Object with aliasIndex, metricFields, and timeFields
 */
export function buildIndicesFromMetadata(metadata: DatasourceMetadata): {
  aliasIndex: Record<string, string[]>;
  metricFields: string[];
  timeFields: string[];
} {
  const aliasIndex: Record<string, string[]> = {};
  const metricFields: string[] = [];
  const timeFields: string[] = [];

  for (const field of metadata.fields) {
    const fieldName = field.name;
    
    // Build alias index: token → list of candidate field names
    // Split field name and description on whitespace/underscore, lowercase, map to field name
    const tokens = new Set<string>();
    
    // Add tokens from field name
    const nameTokens = fieldName.split(/[\s_]+/).map(t => t.toLowerCase().trim()).filter(t => t.length > 0);
    for (const token of nameTokens) {
      tokens.add(token);
    }
    
    // Add tokens from description if available
    if (field.description) {
      const descTokens = field.description.split(/[\s_]+/).map(t => t.toLowerCase().trim()).filter(t => t.length > 0);
      for (const token of descTokens) {
        tokens.add(token);
      }
    }
    
    // Map each token to field name (add to list if multiple fields share token)
    for (const token of tokens) {
      if (!aliasIndex[token]) {
        aliasIndex[token] = [];
      }
      if (!aliasIndex[token].includes(fieldName)) {
        aliasIndex[token].push(fieldName);
      }
    }
    
    // Build metricFields: role='MEASURE' OR (dataType in ['REAL', 'INTEGER'] AND dataCategory='QUANTITATIVE')
    // Note: dataType in ['REAL', 'INTEGER'] is a fallback using standard Tableau metadata enum values (not domain-specific hard-coding)
    const isMeasure = field.role === 'MEASURE';
    const isQuantitativeNumeric = (field.dataType === 'REAL' || field.dataType === 'INTEGER') && field.dataCategory === 'QUANTITATIVE';
    if (isMeasure || isQuantitativeNumeric) {
      metricFields.push(fieldName);
    }
    
    // Build timeFields: dataType='DATE' (primary), or description matches time patterns (fallback)
    if (field.dataType === 'DATE') {
      timeFields.push(fieldName);
    } else if (field.description && /\b(date|time|year|month|quarter|day)\b/i.test(field.description)) {
      // Fallback: only if no DATE fields found (will be checked during usage)
      timeFields.push(fieldName);
    }
  }

  return { aliasIndex, metricFields, timeFields };
}

/**
 * Format context metadata into readable string for LLM
 * 
 * @param metadata - Datasource metadata (fields, parameters)
 * @param datasourceLuid - Datasource LUID (for context)
 * @param datasourceName - Optional datasource name
 * @param datasourceDescription - Optional datasource description
 * @param workbookInfo - Optional workbook information (id, name)
 * @param viewInfo - Optional view information (id, name)
 * @returns Formatted context string ready for LLM system message
 * 
 * @example
 * ```typescript
 * const context = formatContextString(
 *   metadata,
 *   'datasource-luid-123',
 *   'Sales Data',
 *   'Sales data from Q4 2023',
 *   { id: 'workbook-123', name: 'Sales Dashboard' },
 *   { id: 'view-123', name: 'Overview' }
 * );
 * // Returns formatted string with datasource, workbook, view, and fields
 * ```
 */
export function formatContextString(
  metadata: DatasourceMetadata,
  datasourceLuid: string,
  datasourceName?: string,
  datasourceDescription?: string,
  workbookInfo?: { id?: string; name?: string },
  viewInfo?: { id?: string; name?: string }
): string {
  const lines: string[] = [];
  
  // Header
  lines.push('Current Context:');
  
  // Datasource information
  const dsName = datasourceName || 'Unknown Datasource';
  lines.push(`- Datasource: ${dsName} (${datasourceLuid})`);
  if (datasourceDescription) {
    lines.push(`  Description: ${datasourceDescription}`);
  }
  lines.push(`- IMPORTANT: This session is locked to the datasource above. You MUST use this datasource for all queries.`);
  lines.push(`- The "list-datasources" tool is not available. Use only "query-datasource" and "get-datasource-metadata" with this datasource.`);
  
  // Workbook information (if provided)
  if (workbookInfo?.id && workbookInfo?.name) {
    lines.push(`- Workbook: ${workbookInfo.name} (${workbookInfo.id})`);
  }
  
  // View information (if provided)
  if (viewInfo?.id && viewInfo?.name) {
    lines.push(`- View: ${viewInfo.name} (${viewInfo.id})`);
  }
  
  // Available fields section
  lines.push('');
  lines.push('Available Fields:');
  
  if (metadata.fields && metadata.fields.length > 0) {
    // Format each field: name (dataType, role) with optional description
    for (const f of metadata.fields) {
      const desc = sanitizeDescription(f.description, 100);
      const role = f.role || 'UNKNOWN';
      const dataType = f.dataType || 'UNKNOWN';
      if (desc) {
        lines.push(`  - ${f.name} (${dataType}, ${role}): ${desc}`);
      } else {
        lines.push(`  - ${f.name} (${dataType}, ${role})`);
      }
    }
  } else {
    lines.push('  (No fields available)');
  }
  
  return lines.join('\n');
}

/**
 * Get cached context string synchronously (no MCP calls)
 * 
 * @param datasourceLuid - Datasource LUID to get cached context for
 * @returns Cached context string or null if not cached or expired
 * 
 * @example
 * ```typescript
 * const cached = getCachedContext('datasource-luid-123');
 * if (cached) {
 *   // Use cached context
 * } else {
 *   // Need to build context (call buildContextEnvelope)
 * }
 * ```
 */
export function getCachedContext(datasourceLuid: string): string | null {
  if (!datasourceLuid || typeof datasourceLuid !== 'string') {
    return null;
  }
  
  const cached = contextCache.get(datasourceLuid);
  
  if (!cached) {
    return null;
  }
  
  // Check if cache is expired
  const now = Date.now();
  const age = now - cached.timestamp;
  
  if (age > CACHE_EXPIRATION_MS) {
    // Cache expired, remove it
    contextCache.delete(datasourceLuid);
    return null;
  }
  
  // Return cached context string if available
  return cached.contextString || null;
}

/**
 * Invalidate context cache for specific datasource or all caches
 * 
 * @param datasourceLuid - Optional datasource LUID to invalidate. If not provided, clears all cache entries
 * 
 * @example
 * ```typescript
 * // Invalidate specific datasource
 * invalidateContextCache('datasource-luid-123');
 * 
 * // Clear all caches
 * invalidateContextCache();
 * ```
 */
export function invalidateContextCache(datasourceLuid?: string): void {
  if (datasourceLuid) {
    // Invalidate specific cache entry
    if (contextCache.has(datasourceLuid)) {
      contextCache.delete(datasourceLuid);
      if (config.server.nodeEnv === 'development') {
        console.log(`[Context] Invalidated cache for datasource: ${datasourceLuid.substring(0, 8)}...`);
      }
    }
  } else {
    // Clear all cache entries
    const count = contextCache.size;
    contextCache.clear();
    if (config.server.nodeEnv === 'development') {
      console.log(`[Context] Cleared all cache entries (${count} entries)`);
    }
  }
}

/**
 * Evict oldest cache entry if cache size exceeds limit (LRU eviction)
 * 
 * @internal
 */
function evictOldestCacheEntry(): void {
  if (contextCache.size <= MAX_CACHE_SIZE) {
    return;
  }
  
  // Find oldest entry (lowest timestamp)
  let oldestKey: string | null = null;
  let oldestTimestamp = Infinity;
  
  for (const [key, entry] of contextCache.entries()) {
    if (entry.timestamp < oldestTimestamp) {
      oldestTimestamp = entry.timestamp;
      oldestKey = key;
    }
  }
  
  // Remove oldest entry
  if (oldestKey) {
    contextCache.delete(oldestKey);
    if (config.server.nodeEnv === 'development') {
      console.log(`[Context] Evicted oldest cache entry: ${oldestKey.substring(0, 8)}...`);
    }
  }
}

/**
 * Build context envelope string from datasource metadata and workbook/view tags
 * 
 * This function implements a cache-first approach:
 * 1. Checks cache for datasourceLuid
 * 2. If cached and fresh, returns cached context string
 * 3. If not cached or stale, fetches datasource metadata via MCP
 * 4. Fetches workbook/view info if provided (optional, for tags)
 * 5. Formats context string with datasource description and workbook/view tags
 * 6. Caches result with timestamp
 * 7. Returns context string
 * 
 * @param datasourceLuid - Datasource LUID (required)
 * @param workbookId - Optional workbook ID (for lineage tags)
 * @param viewId - Optional view ID (for lineage tags)
 * @returns Promise resolving to formatted context string ready for LLM system message
 * @throws Error if datasourceLuid is invalid or MCP call fails critically
 * 
 * @example
 * ```typescript
 * // Build context with datasource only
 * const context1 = await buildContextEnvelope('datasource-luid-123');
 * 
 * // Build context with datasource, workbook, and view
 * const context2 = await buildContextEnvelope(
 *   'datasource-luid-123',
 *   'workbook-id-456',
 *   'view-id-789'
 * );
 * 
 * // Use in LLM system message
 * const systemMessage = {
 *   role: 'system',
 *   content: context2
 * };
 * ```
 */
export async function buildContextEnvelope(
  datasourceLuid: string,
  workbookId?: string,
  viewId?: string
): Promise<string> {
  // Validate required parameter
  if (!datasourceLuid || typeof datasourceLuid !== 'string' || datasourceLuid.trim().length === 0) {
    throw new Error('datasourceLuid is required and must be a non-empty string');
  }
  
  const trimmedLuid = datasourceLuid.trim();
  
  // Check cache first, but also verify workbook/view haven't changed
  const cachedEntry = contextCache.get(trimmedLuid);
  if (cachedEntry) {
    // Check if cache is expired
    const now = Date.now();
    const age = now - cachedEntry.timestamp;
    if (age <= CACHE_EXPIRATION_MS) {
      // Cache is valid - check if workbook/view selection changed
      const workbookChanged = (cachedEntry.workbookId ?? undefined) !== (workbookId ?? undefined);
      const viewChanged = (cachedEntry.viewId ?? undefined) !== (viewId ?? undefined);
      
      if (!workbookChanged && !viewChanged) {
        // Cache hit - selection unchanged
        if (config.server.nodeEnv === 'development') {
          console.log(`[Context] Cache hit for datasource: ${trimmedLuid.substring(0, 8)}...`);
        }
        return cachedEntry.contextString || '';
      } else {
        // Selection changed - invalidate cache entry
        if (config.server.nodeEnv === 'development') {
          console.log(`[Context] Cache invalidated - selection changed (datasource: ${trimmedLuid.substring(0, 8)}...)`);
        }
        contextCache.delete(trimmedLuid);
      }
    } else {
      // Cache expired - remove it
      contextCache.delete(trimmedLuid);
    }
  }
  
  // Cache miss - fetch metadata
  if (config.server.nodeEnv === 'development') {
    console.log(`[Context] Cache miss - fetching metadata for datasource: ${trimmedLuid.substring(0, 8)}...`);
  }
  
  const mcpClient = getMCPClient();
  
  try {
    // Fetch datasource metadata
    const datasourceMetadata = await mcpClient.getDatasourceMetadata(trimmedLuid);
    
    // Get datasource name (try to find from list-datasources or use config default)
    // Skip for test/placeholder LUIDs to avoid unnecessary network calls
    let datasourceName: string | undefined;
    const isTestLuid = trimmedLuid.toLowerCase().includes('test-') || 
                       trimmedLuid.toLowerCase().includes('placeholder') || 
                       trimmedLuid.length < 10;
    
    // Get datasource name and description (try to find from list-datasources or use config default)
    let datasourceDescription: string | undefined;
    if (!isTestLuid) {
      try {
        // Try to get datasource name and description from list-datasources
        const datasources = await mcpClient.listDatasources({ limit: 100 });
        const matchingDs = datasources.find((ds) => ds.id === trimmedLuid);
        if (matchingDs) {
          datasourceName = matchingDs.name;
          datasourceDescription = sanitizeDescription(matchingDs.description);
        }
      } catch {
        // If list-datasources fails, try config default
        if (config.defaults?.datasourceLuid === trimmedLuid) {
          datasourceName = config.defaults.datasourceName;
        }
      }
    } else {
      // For test LUIDs, try config default only
      if (config.defaults?.datasourceLuid === trimmedLuid) {
        datasourceName = config.defaults.datasourceName;
      }
    }
    
    // Fetch workbook/view info if provided (optional, errors don't block context building)
    let workbookInfo: { id?: string; name?: string } | undefined;
    let viewInfo: { id?: string; name?: string } | undefined;
    
    if (workbookId) {
      try {
        const workbook = await mcpClient.getWorkbook(workbookId);
        workbookInfo = {
          id: workbook.id,
          name: workbook.name,
        };
      } catch (error) {
        // Log error but continue (workbook info is optional)
        if (config.server.nodeEnv === 'development') {
          console.warn(`[Context] Failed to fetch workbook info for ${workbookId.substring(0, 8)}...:`, error instanceof Error ? error.message : String(error));
        }
        // Try config default if available
        if (config.defaults?.workbookId === workbookId) {
          workbookInfo = {
            id: config.defaults.workbookId,
            name: config.defaults.workbookName,
          };
        }
      }
    }
    
    if (viewId) {
      try {
        // Try to find view by filtering list-views
        const views = await mcpClient.listViews({ limit: 100 });
        const matchingView = views.find((view) => view.id === viewId);
        if (matchingView) {
          viewInfo = {
            id: matchingView.id,
            name: matchingView.name,
          };
        }
      } catch (error) {
        // Log error but continue (view info is optional)
        if (config.server.nodeEnv === 'development') {
          console.warn(`[Context] Failed to fetch view info for ${viewId.substring(0, 8)}...:`, error instanceof Error ? error.message : String(error));
        }
        // Try config default if available
        if (config.defaults?.viewId === viewId) {
          viewInfo = {
            id: config.defaults.viewId,
            name: config.defaults.viewName,
          };
        }
      }
    }
    
    // Build indices from metadata (single source of truth)
    const { aliasIndex, metricFields, timeFields } = buildIndicesFromMetadata(datasourceMetadata);
    
    // Format context string
    const contextString = formatContextString(
      datasourceMetadata,
      trimmedLuid,
      datasourceName,
      datasourceDescription,
      workbookInfo,
      viewInfo
    );
    
    // Cache result
    evictOldestCacheEntry(); // Make room if needed
    
    const cacheEntry: ContextCache = {
      datasourceLuid: trimmedLuid,
      datasourceName,
      datasourceDescription,
      datasourceMetadata,
      workbookId: workbookInfo?.id,
      workbookName: workbookInfo?.name,
      viewId: viewInfo?.id,
      viewName: viewInfo?.name,
      contextString,
      aliasIndex,
      metricFields,
      timeFields,
      timestamp: Date.now(),
    };
    
    contextCache.set(trimmedLuid, cacheEntry);
    
    if (config.server.nodeEnv === 'development') {
      console.log(`[Context] Cached context for datasource: ${trimmedLuid.substring(0, 8)}...`);
    }
    
    return contextString;
  } catch (error) {
    // Handle MCP errors gracefully
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Context] Failed to build context envelope for datasource ${trimmedLuid.substring(0, 8)}...:`, errorMessage);
    
    // Return partial context if datasource name is available from config
    if (config.defaults?.datasourceLuid === trimmedLuid && config.defaults?.datasourceName) {
      const partialContext = formatContextString(
        { fields: [] }, // Empty metadata
        trimmedLuid,
        config.defaults.datasourceName,
        undefined, // No description available in fallback
        workbookId ? { id: workbookId, name: config.defaults.workbookName } : undefined,
        viewId ? { id: viewId, name: config.defaults.viewName } : undefined
      );
      return partialContext;
    }
    
    // If no fallback available, throw error
    throw new Error(`Failed to build context envelope: ${errorMessage}`);
  }
}

/**
 * Get metadata indices from cache (cache-first, synchronous check)
 * Used by clarification logic to access aliasIndex, metricFields, timeFields
 * 
 * @param datasourceLuid - Datasource LUID to look up
 * @returns Metadata indices if cached, undefined if not cached
 */
export function getMetadataIndicesFromCache(datasourceLuid?: string): {
  aliasIndex?: Record<string, string[]>;
  metricFields?: string[];
  timeFields?: string[];
} | undefined {
  if (!datasourceLuid) {
    return undefined;
  }
  
  const trimmedLuid = datasourceLuid.trim();
  const cachedEntry = contextCache.get(trimmedLuid);
  
  if (!cachedEntry) {
    return undefined;
  }
  
  // Check if cache is expired
  const now = Date.now();
  const age = now - cachedEntry.timestamp;
  if (age > CACHE_EXPIRATION_MS) {
    return undefined;
  }
  
  return {
    aliasIndex: cachedEntry.aliasIndex,
    metricFields: cachedEntry.metricFields,
    timeFields: cachedEntry.timeFields,
  };
}

/**
 * Trigger async metadata refresh (non-blocking)
 * Fetches metadata only (lighter than buildContextEnvelope) and rebuilds indices
 * 
 * @param datasourceLuid - Datasource LUID to refresh
 */
export function triggerAsyncMetadataRefresh(datasourceLuid: string): void {
  const trimmedLuid = datasourceLuid.trim();
  
  // Don't block - fire async refresh
  setImmediate(async () => {
    try {
      const mcpClient = getMCPClient();
      const metadata = await mcpClient.getDatasourceMetadata(trimmedLuid);
      
      // Build indices
      const { aliasIndex, metricFields, timeFields } = buildIndicesFromMetadata(metadata);
      
      // Update cache entry if it exists
      const cachedEntry = contextCache.get(trimmedLuid);
      if (cachedEntry) {
        cachedEntry.aliasIndex = aliasIndex;
        cachedEntry.metricFields = metricFields;
        cachedEntry.timeFields = timeFields;
        cachedEntry.datasourceMetadata = metadata;
        cachedEntry.timestamp = Date.now();
        contextCache.set(trimmedLuid, cachedEntry);
        
        if (config.server.nodeEnv === 'development') {
          console.log(`[Context] Refreshed metadata indices for datasource: ${trimmedLuid.substring(0, 8)}...`);
        }
      }
    } catch (error) {
      // Log error but don't throw (non-blocking refresh)
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (config.server.nodeEnv === 'development') {
        console.warn(`[Context] Failed to refresh metadata indices for datasource ${trimmedLuid.substring(0, 8)}...:`, errorMessage);
      }
    }
  });
}

