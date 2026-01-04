/**
 * Grounding Module
 * Phase 6, Task 1: Citation extraction from tool calls
 * Phase 6, Task 2: Citation formatting
 * 
 * This module handles:
 * - Citation extraction from tool calls
 * - Citation formatting
 * - Attaching citations to answers (Phase 6 Task 3)
 * - Citation validation (Phase 6 Task 4)
 */

import type { ToolCall, ToolResult } from './utils/toolCallingFormat.js';
import type { VizQLQuery, DatasourceMetadata } from './mcpClient.js';
import { MCPClient } from './mcpClient.js';

/**
 * Citation interface matching spec format
 * 
 * Represents a citation extracted from a tool call, containing:
 * - Datasource information (LUID and optional name)
 * - Workbook information (optional, ID and optional name)
 * - View information (optional, ID and optional name)
 * - Fields used in the query (name, aggregation, role)
 * - Filters applied to the query
 * - Query timestamp
 * - Tool reference (for debugging/tracking)
 */
export interface Citation {
  /** Datasource information */
  datasource: {
    /** Datasource name (optional, can be populated from context) */
    name?: string;
    /** Datasource LUID (required) */
    luid: string;
  };
  /** Workbook information (optional, can be populated from context) */
  workbook?: {
    /** Workbook name (optional) */
    name?: string;
    /** Workbook ID (required if workbook is present) */
    id: string;
  };
  /** View information (optional, can be populated from context) */
  view?: {
    /** View name (optional) */
    name?: string;
    /** View ID (required if view is present) */
    id: string;
  };
  /** Fields used in the query */
  fields: Array<{
    /** Field name (from fieldCaption) */
    name: string;
    /** Aggregation function (SUM, COUNT, AVG, etc.) */
    aggregation?: string;
    /** Field role (measure, dimension) - optional, can be inferred from metadata */
    role?: string;
  }>;
  /** Filters applied to the query (optional) */
  filters?: Array<{
    /** Field name being filtered */
    field: string;
    /** Filter type (SET, TOP, MATCH, QUANTITATIVE_NUMERICAL, etc.) */
    type?: string;
    /** Additional filter properties (values, min, max, etc.) */
    [key: string]: unknown;
  }>;
  /** Query timestamp (ISO 8601) */
  queryTimestamp: string;
  /** Tool name (for reference) */
  tool: string;
  /** Tool parameters (for reference) */
  parameters: Record<string, unknown>;
  /** Tool result (optional, for reference) */
  result?: unknown;
}

/**
 * Extract citations from tool calls
 * 
 * Extracts citation data from query-datasource tool calls, including:
 * - Datasource LUID and optional name
 * - Fields with aggregations
 * - Filters
 * - Query timestamp
 * 
 * Only query-datasource tool calls generate citations (other tools are metadata/helper tools).
 * 
 * @param toolCalls - Array of tool calls to extract citations from
 * @param toolResults - Array of tool results (matched by tool_use_id)
 * @returns Array of Citation objects extracted from query-datasource tool calls
 * 
 * @example
 * ```typescript
 * const toolCalls: ToolCall[] = [
 *   {
 *     id: 'tool_123',
 *     name: 'query-datasource',
 *     input: {
 *       datasourceLuid: 'abc-123',
 *       query: {
 *         fields: [{ fieldCaption: 'Sales', function: 'SUM' }],
 *         filters: [{ field: { fieldCaption: 'Order Date' }, filterType: 'DATE', ... }]
 *       }
 *     }
 *   }
 * ];
 * const toolResults: ToolResult[] = [
 *   { tool_use_id: 'tool_123', content: '{"data":[...]}', isError: false }
 * ];
 * const citations = extractCitations(toolCalls, toolResults);
 * // Returns: [{ datasource: { luid: 'abc-123' }, fields: [{ name: 'Sales', aggregation: 'SUM' }], ... }]
 * ```
 */
export function extractCitations(
  toolCalls: ToolCall[],
  toolResults: ToolResult[]
): Citation[] {
  const citations: Citation[] = [];
  const timestamp = new Date().toISOString();

  // Create a map of tool results by tool_use_id for quick lookup
  const resultMap = new Map<string, ToolResult>();
  for (const result of toolResults) {
    if (result.tool_use_id) {
      resultMap.set(result.tool_use_id, result);
    }
  }

  // Filter for query-datasource tool calls only
  for (const toolCall of toolCalls) {
    if (toolCall.name !== 'query-datasource') {
      continue; // Skip non-query-datasource tool calls
    }

    try {
      // Extract datasource LUID
      const datasourceLuid = toolCall.input.datasourceLuid;
      if (!datasourceLuid || typeof datasourceLuid !== 'string' || datasourceLuid.trim().length === 0) {
        // Skip if datasource LUID is missing or invalid
        continue;
      }

      // Extract query object
      const queryInput = toolCall.input.query;
      if (!queryInput || typeof queryInput !== 'object' || Array.isArray(queryInput)) {
        // Skip if query is missing or invalid
        continue;
      }

      // Type assertion: query should match VizQLQuery structure
      const query = queryInput as VizQLQuery;

      // Extract fields from query.fields
      const fields: Citation['fields'] = [];
      if (Array.isArray(query.fields)) {
        for (const field of query.fields) {
          if (field && typeof field === 'object' && !Array.isArray(field)) {
            const fieldCaption = field.fieldCaption;
            if (fieldCaption && typeof fieldCaption === 'string') {
              fields.push({
                name: fieldCaption,
                aggregation: typeof field.function === 'string' ? field.function : undefined,
                role: typeof field.role === 'string' ? field.role : undefined,
              });
            }
          }
        }
      }

      // Extract filters from query.filters
      const filters: NonNullable<Citation['filters']> = [];
      if (Array.isArray(query.filters)) {
        for (const filter of query.filters) {
          if (filter && typeof filter === 'object' && !Array.isArray(filter)) {
            // Extract field name from filter.field.fieldCaption
            const filterField = filter.field;
            let fieldName: string | undefined;
            if (filterField && typeof filterField === 'object' && !Array.isArray(filterField)) {
              fieldName = typeof filterField.fieldCaption === 'string' ? filterField.fieldCaption : undefined;
            }

            if (fieldName) {
              // Store filter with field name and filter type
              const citationFilter: {
                field: string;
                type?: string;
                [key: string]: unknown;
              } = {
                field: fieldName,
                type: typeof filter.filterType === 'string' ? filter.filterType : undefined,
              };

              // Copy other filter properties (values, min, max, etc.)
              for (const [key, value] of Object.entries(filter)) {
                if (key !== 'field' && key !== 'filterType') {
                  citationFilter[key] = value;
                }
              }

              filters.push(citationFilter);
            }
          }
        }
      }

      // Get tool result if available
      const toolResult = resultMap.get(toolCall.id);
      let parsedResult: unknown | undefined;
      if (toolResult && toolResult.content) {
        try {
          parsedResult = JSON.parse(toolResult.content);
        } catch {
          // If parsing fails, keep result as string
          parsedResult = toolResult.content;
        }
      }

      // Create Citation object
      const citation: Citation = {
        datasource: {
          luid: datasourceLuid.trim(),
          // name is optional, can be populated from context later
        },
        fields,
        queryTimestamp: timestamp,
        tool: toolCall.name,
        parameters: toolCall.input,
      };

      // Add filters if present
      if (filters.length > 0) {
        citation.filters = filters;
      }

      // Add result if available
      if (parsedResult !== undefined) {
        citation.result = parsedResult;
      }

      // workbook and view are optional, can be populated from context later

      citations.push(citation);
    } catch (error) {
      // Handle errors gracefully - log and skip this citation
      console.warn(
        `[grounding] Error extracting citation from tool call ${toolCall.id}:`,
        error instanceof Error ? error.message : String(error)
      );
      // Continue with next tool call
    }
  }

  return citations;
}

/**
 * Format a single field with aggregation
 * 
 * Formats a field as "Name" or "Name (AGGREGATION)" if aggregation is present.
 * Matches CitationPopup component formatting for consistency.
 * 
 * @param field - Field object with name and optional aggregation
 * @returns Formatted field string
 */
function formatField(field: { name: string; aggregation?: string }): string {
  if (field.aggregation) {
    return `${field.name} (${field.aggregation})`;
  }
  return field.name;
}

/**
 * Format a single filter
 * 
 * Formats a filter based on its type:
 * - Date range: "Field (min to max)"
 * - Set: "Field (value1, value2, ...)"
 * - Generic: "Field (type, details)"
 * 
 * Matches CitationPopup component formatting for consistency.
 * 
 * @param filter - Filter object with field, type, and additional properties
 * @returns Formatted filter string
 */
function formatFilter(filter: {
  field: string;
  type?: string;
  [key: string]: unknown;
}): string {
  const { field, type, ...rest } = filter;

  // Date range filter
  if (type === 'date_range' && rest.min && rest.max) {
    return `${field} (${String(rest.min)} to ${String(rest.max)})`;
  }

  // Set filter
  if (type === 'set' && Array.isArray(rest.values)) {
    return `${field} (${rest.values.map(String).join(', ')})`;
  }

  // Generic filter display
  const details = Object.entries(rest)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(', ');
  return `${field} (${type || 'unknown'}${details ? `, ${details}` : ''})`;
}

/**
 * Cached formatter for deterministic timestamp formatting
 * Uses explicit locale (en-US) and timezone (UTC) to ensure consistent output
 * across all environments (dev, CI, production).
 */
const CITATION_TS_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/**
 * Format an ISO timestamp to readable format
 * 
 * Formats an ISO 8601 timestamp to a human-readable format like "Jan 15, 2024 10:30 AM".
 * Uses deterministic formatting (en-US locale, UTC timezone) to ensure consistent output
 * across all environments. Matches spec format exactly.
 * 
 * @param timestamp - ISO 8601 timestamp string
 * @returns Formatted timestamp string, or original string if parsing fails
 */
function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      // Invalid date, return original string
      return timestamp;
    }

    // Use formatToParts to assemble exact string format
    const parts = CITATION_TS_FORMATTER.formatToParts(date);
    
    // Extract parts by type
    const month = parts.find(p => p.type === 'month')?.value || '';
    const day = parts.find(p => p.type === 'day')?.value || '';
    const year = parts.find(p => p.type === 'year')?.value || '';
    const hour = parts.find(p => p.type === 'hour')?.value || '';
    const minute = parts.find(p => p.type === 'minute')?.value || '';
    const dayPeriod = parts.find(p => p.type === 'dayPeriod')?.value || '';

    // Assemble: "Jan 15, 2024 10:30 AM" (single space between date and time, no comma before time)
    return `${month} ${day}, ${year} ${hour}:${minute} ${dayPeriod}`;
  } catch {
    // If parsing fails, return original timestamp
    return timestamp;
  }
}

/**
 * Format a single citation into summary format
 * 
 * Formats a single citation into a human-readable summary format matching the spec.
 * 
 * @param citation - Citation object to format
 * @returns Formatted citation string in summary format
 */
function formatSingleCitation(citation: Citation): string {
  const lines: string[] = ['📊 Source:'];

  // Datasource (name if available, otherwise LUID)
  const datasourceDisplay = citation.datasource.name || citation.datasource.luid;
  lines.push(`• Datasource: ${datasourceDisplay}`);

  // Workbook (if present, name if available)
  if (citation.workbook) {
    const workbookDisplay = citation.workbook.name || citation.workbook.id;
    lines.push(`• Workbook: ${workbookDisplay}`);
  }

  // View (if present, name if available)
  if (citation.view) {
    const viewDisplay = citation.view.name || citation.view.id;
    lines.push(`• View: ${viewDisplay}`);
  }

  // Fields (formatted with aggregations)
  const formattedFields = citation.fields.map(formatField).join(', ');
  lines.push(`• Fields: ${formattedFields}`);

  // Filters (if present)
  if (citation.filters && citation.filters.length > 0) {
    const formattedFilters = citation.filters.map(formatFilter).join(', ');
    lines.push(`• Filters: ${formattedFilters}`);
  }

  // Query timestamp
  const formattedTimestamp = formatTimestamp(citation.queryTimestamp);
  lines.push(`• Query Time: ${formattedTimestamp}`);

  return lines.join('\n');
}

/**
 * Format citations for display
 * 
 * Formats citations in a human-readable summary format matching the spec.
 * Returns a text string suitable for logging, debugging, or text-based display.
 * 
 * JSON formatting is handled separately by the frontend CitationPopup component
 * or can be generated using JSON.stringify(citations) at the call site.
 * 
 * @param citations - Array of citations to format
 * @returns Formatted citation string in summary format, or empty string if no citations
 * 
 * @example
 * ```typescript
 * const citations: Citation[] = [
 *   {
 *     datasource: { name: 'ACSC - Demo_Dataset', luid: 'abc-123' },
 *     workbook: { name: 'Cyber Demo Workbook', id: 'workbook-123' },
 *     view: { name: 'Salesforce Embed Dash', id: 'view-123' },
 *     fields: [{ name: 'Sales', aggregation: 'SUM' }, { name: 'State' }],
 *     filters: [{ field: 'Order Date', type: 'date_range', min: '2024-01-01', max: '2024-12-31' }],
 *     queryTimestamp: '2024-01-15T10:30:00Z',
 *     tool: 'query-datasource',
 *     parameters: {},
 *   }
 * ];
 * const formatted = formatCitations(citations);
 * // Returns:
 * // 📊 Source:
 * // • Datasource: ACSC - Demo_Dataset
 * // • Workbook: Cyber Demo Workbook
 * // • View: Salesforce Embed Dash
 * // • Fields: Sales (SUM), State
 * // • Filters: Order Date (2024-01-01 to 2024-12-31)
 * // • Query Time: Jan 15, 2024 10:30 AM
 * ```
 */
export function formatCitations(citations: Citation[]): string {
  if (citations.length === 0) {
    return '';
  }

  // Format each citation as a separate section
  const formattedCitations = citations.map(formatSingleCitation);

  // Combine multiple citations (separate sections with blank lines)
  return formattedCitations.join('\n\n');
}

/**
 * Citation validation result for a single citation
 */
export interface CitationValidationResult {
  /** Whether citation is valid */
  valid: boolean;
  /** The citation being validated */
  citation: Citation;
  /** Array of error messages (if invalid) */
  errors?: string[];
  /** Array of warning messages (optional) */
  warnings?: string[];
}

/**
 * Citation validation results for multiple citations
 */
export interface CitationValidationResults {
  /** Validation results for each citation */
  results: CitationValidationResult[];
  /** Whether all citations are valid */
  allValid: boolean;
  /** Number of valid citations */
  validCount: number;
  /** Number of invalid citations */
  invalidCount: number;
}

/**
 * Validate citation structure (required fields, types)
 * 
 * Validates that a citation has all required fields with correct types:
 * - datasource.luid: string (required)
 * - fields: Array (required, non-empty)
 * - queryTimestamp: string (required)
 * - tool: string (required)
 * - parameters: object (required)
 * 
 * @param citation - Citation to validate
 * @returns Array of error messages (empty if valid)
 */
function validateCitationStructure(citation: Citation): string[] {
  const errors: string[] = [];

  // Validate datasource.luid (required)
  if (!citation.datasource || typeof citation.datasource !== 'object') {
    errors.push('Citation datasource is missing or invalid');
  } else if (!citation.datasource.luid || typeof citation.datasource.luid !== 'string' || citation.datasource.luid.trim().length === 0) {
    errors.push('Citation datasource.luid is missing or invalid (must be non-empty string)');
  }

  // Validate fields (required, non-empty array)
  if (!Array.isArray(citation.fields)) {
    errors.push('Citation fields is missing or invalid (must be an array)');
  } else if (citation.fields.length === 0) {
    errors.push('Citation fields array is empty (must contain at least one field)');
  } else {
    // Validate each field has a name
    citation.fields.forEach((field, index) => {
      if (!field || typeof field !== 'object') {
        errors.push(`Citation field at index ${index} is missing or invalid`);
      } else if (!field.name || typeof field.name !== 'string' || field.name.trim().length === 0) {
        errors.push(`Citation field at index ${index} is missing name (must be non-empty string)`);
      }
    });
  }

  // Validate queryTimestamp (required)
  if (!citation.queryTimestamp || typeof citation.queryTimestamp !== 'string' || citation.queryTimestamp.trim().length === 0) {
    errors.push('Citation queryTimestamp is missing or invalid (must be non-empty string)');
  }

  // Validate tool (required)
  if (!citation.tool || typeof citation.tool !== 'string' || citation.tool.trim().length === 0) {
    errors.push('Citation tool is missing or invalid (must be non-empty string)');
  }

  // Validate parameters (required)
  if (!citation.parameters || typeof citation.parameters !== 'object' || Array.isArray(citation.parameters)) {
    errors.push('Citation parameters is missing or invalid (must be an object)');
  }

  return errors;
}

/**
 * Validate that cited fields exist in datasource metadata
 * 
 * Fetches datasource metadata and validates that all cited field names
 * exist in the datasource. Also validates datasource LUID by attempting
 * to fetch metadata.
 * 
 * @param citation - Citation to validate
 * @param mcpClient - MCP client instance (optional, creates new if not provided)
 * @returns Array of error messages (empty if valid)
 */
async function validateCitationFields(
  citation: Citation,
  mcpClient?: MCPClient
): Promise<string[]> {
  const errors: string[] = [];

  // Validate datasource LUID is present
  if (!citation.datasource?.luid) {
    errors.push('Cannot validate fields: datasource LUID is missing');
    return errors;
  }

  const datasourceLuid = citation.datasource.luid.trim();

  // Create MCP client if not provided
  const client = mcpClient ?? new MCPClient();

  // Fetch datasource metadata (validates datasource LUID and provides field list)
  let metadata: DatasourceMetadata;
  try {
    metadata = await client.getDatasourceMetadata(datasourceLuid);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(`Failed to fetch datasource metadata: ${errorMessage}`);
    errors.push(`Datasource LUID may be invalid: ${datasourceLuid.substring(0, 8)}...`);
    return errors;
  }

  // Validate metadata structure
  if (!metadata || typeof metadata !== 'object') {
    errors.push('Datasource metadata is invalid (not an object)');
    return errors;
  }

  if (!Array.isArray(metadata.fields)) {
    errors.push('Datasource metadata fields is invalid (not an array)');
    return errors;
  }

  // Create a set of field names from metadata for efficient lookup
  const fieldNames = new Set(metadata.fields.map(field => field.name?.toLowerCase().trim()).filter((name): name is string => !!name));

  // Validate each cited field exists in metadata
  citation.fields.forEach((field, index) => {
    const fieldName = field.name?.trim();
    if (!fieldName) {
      errors.push(`Field at index ${index} has empty name`);
      return;
    }

    const normalizedFieldName = fieldName.toLowerCase();
    if (!fieldNames.has(normalizedFieldName)) {
      errors.push(`Field "${fieldName}" not found in datasource metadata`);
    }
  });

  return errors;
}

/**
 * Validate citations
 * 
 * Validates citation structure, verifies that cited fields exist in datasource
 * metadata, and validates datasource LUIDs. Returns detailed validation results
 * with reasons for invalid citations.
 * 
 * @param citations - Array of citations to validate
 * @param mcpClient - Optional MCP client instance (creates new if not provided)
 * @returns Promise resolving to CitationValidationResults with validation results
 * 
 * @example
 * ```typescript
 * const citations = extractCitations(toolCalls, toolResults);
 * const validation = await validateCitations(citations);
 * 
 * if (!validation.allValid) {
 *   console.warn(`Found ${validation.invalidCount} invalid citations`);
 *   validation.results.forEach(result => {
 *     if (!result.valid) {
 *       console.error(`Citation errors: ${result.errors?.join(', ')}`);
 *     }
 *   });
 * }
 * ```
 */
export async function validateCitations(
  citations: Citation[],
  mcpClient?: MCPClient
): Promise<CitationValidationResults> {
  const results: CitationValidationResult[] = [];

  for (const citation of citations) {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate structure (required fields, types)
    const structureErrors = validateCitationStructure(citation);
    errors.push(...structureErrors);

    // If structure valid, validate fields and datasource LUID
    if (structureErrors.length === 0) {
      const fieldErrors = await validateCitationFields(citation, mcpClient);
      errors.push(...fieldErrors);
    }

    results.push({
      valid: errors.length === 0,
      citation,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  }

  const validCount = results.filter(r => r.valid).length;
  const invalidCount = results.filter(r => !r.valid).length;

  return {
    results,
    allValid: results.every(r => r.valid),
    validCount,
    invalidCount,
  };
}
