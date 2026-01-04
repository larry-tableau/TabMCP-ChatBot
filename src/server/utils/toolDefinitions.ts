/**
 * Tool Definitions for MCP Tools
 * Phase 3, Task 4: Add tool definitions for MCP tools
 * 
 * This module provides tool definitions in Anthropic API format for all MCP tools.
 * These definitions enable the LLM to understand available tools and make tool-calling decisions.
 * 
 * CRITICAL: Never hard-code tool names, field names, or values (only in JSDoc examples)
 * Always use dynamic parameters from function arguments
 */

import type { LLMTool } from '../llmClient.js';

/**
 * Get tool definition for list-datasources
 * 
 * Lists available Tableau datasources. Use this to enumerate datasources
 * or find a datasource by name or filter.
 * 
 * @returns LLMTool definition for list-datasources
 * 
 * @example
 * ```typescript
 * const tool = getListDatasourcesTool();
 * // Returns: { name: 'list-datasources', description: '...', input_schema: {...} }
 * ```
 */
export function getListDatasourcesTool(): LLMTool {
  return {
    name: 'list-datasources',
    description: 'List available Tableau datasources. Use this to enumerate datasources or find a datasource by name or filter.',
    input_schema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description: 'Optional filter expression to filter datasources (e.g., "name:eq:My Datasource")',
        },
        pageSize: {
          type: 'number',
          description: 'Optional number of datasources per page',
        },
        limit: {
          type: 'number',
          description: 'Optional maximum number of datasources to return',
        },
      },
      // No required parameters - all are optional
    },
  };
}

/**
 * Get tool definition for get-datasource-metadata
 * 
 * Get metadata for a datasource including field names, types, roles, and aggregations.
 * Use this to validate field names before querying or to understand datasource structure.
 * 
 * @returns LLMTool definition for get-datasource-metadata
 * 
 * @example
 * ```typescript
 * const tool = getGetDatasourceMetadataTool();
 * // Returns: { name: 'get-datasource-metadata', description: '...', input_schema: {...} }
 * ```
 */
export function getGetDatasourceMetadataTool(): LLMTool {
  return {
    name: 'get-datasource-metadata',
    description: 'Get metadata for a datasource including field names, types, roles, and aggregations. Use this to validate field names before querying or to understand datasource structure.',
    input_schema: {
      type: 'object',
      properties: {
        datasourceLuid: {
          type: 'string',
          description: 'The LUID (Locally Unique Identifier) of the datasource to get metadata for',
        },
      },
      required: ['datasourceLuid'],
    },
  };
}

/**
 * Get tool definition for query-datasource
 * 
 * Execute a VizQL query against a Tableau datasource. This is the primary tool
 * for answering user questions by querying data. The query includes fields (with aggregations),
 * filters, sorting, and limits.
 * 
 * @returns LLMTool definition for query-datasource
 * 
 * @example
 * ```typescript
 * const tool = getQueryDatasourceTool();
 * // Returns: { name: 'query-datasource', description: '...', input_schema: {...} }
 * ```
 */
export function getQueryDatasourceTool(): LLMTool {
  return {
    name: 'query-datasource',
    description: 'Execute a VizQL query against a Tableau datasource. This is the primary tool for answering user questions by querying data. The query includes fields (with aggregations), filters, and sorting. Do not include "limit" in the query object.',
    input_schema: {
      type: 'object',
      properties: {
        datasourceLuid: {
          type: 'string',
          description: 'The LUID (Locally Unique Identifier) of the datasource to query',
        },
        query: {
          type: 'object',
          description: 'VizQL query object specifying fields, filters, sorting, and limits',
          properties: {
            fields: {
              type: 'array',
              description: 'Array of field specifications (required). Each field specifies the field name, aggregation function, alias, and optional sorting.',
              items: {
                type: 'object',
                properties: {
                  fieldCaption: {
                    type: 'string',
                    description: 'Field caption/name (required)',
                  },
                  function: {
                    type: 'string',
                    description: 'Optional aggregation function (SUM, COUNT, AVG, MEDIAN, MIN, MAX, COUNTD, STDEV, VAR, etc.)',
                  },
                  fieldAlias: {
                    type: 'string',
                    description: 'Optional field alias for output',
                  },
                  sortDirection: {
                    type: 'string',
                    enum: ['ASC', 'DESC'],
                    description: 'Optional sort direction',
                  },
                  sortPriority: {
                    type: 'number',
                    description: 'Optional sort priority (1 = highest priority)',
                  },
                },
                required: ['fieldCaption'],
                additionalProperties: true,
              },
            },
            filters: {
              type: 'array',
              description: 'Optional array of filter specifications to filter query results',
              items: {
                type: 'object',
                properties: {
                  field: {
                    type: 'object',
                    description: 'Field to filter on',
                    properties: {
                      fieldCaption: {
                        type: 'string',
                        description: 'Field caption/name (required)',
                      },
                      function: {
                        type: 'string',
                        description: 'Optional aggregation function for the field',
                      },
                    },
                    required: ['fieldCaption'],
                    additionalProperties: true,
                  },
                  filterType: {
                    type: 'string',
                    description: 'Filter type (SET, TOP, MATCH, QUANTITATIVE_NUMERICAL, QUANTITATIVE_DATE, DATE, etc.)',
                  },
                },
                required: ['field', 'filterType'],
                additionalProperties: true,
              },
            },
            sort: {
              description: 'Optional sort specifications (object or array)',
            },
          },
          required: ['fields'],
          additionalProperties: true,
        },
      },
      required: ['datasourceLuid', 'query'],
    },
  };
}

/**
 * Get tool definition for get-workbook
 * 
 * Get workbook metadata including name, ID, project information, and views.
 * Use this for lineage display to show the relationship between datasource, workbook, and view.
 * 
 * @returns LLMTool definition for get-workbook
 * 
 * @example
 * ```typescript
 * const tool = getGetWorkbookTool();
 * // Returns: { name: 'get-workbook', description: '...', input_schema: {...} }
 * ```
 */
export function getGetWorkbookTool(): LLMTool {
  return {
    name: 'get-workbook',
    description: 'Get workbook metadata including name, ID, project information, and views. Use this for lineage display to show the relationship between datasource, workbook, and view.',
    input_schema: {
      type: 'object',
      properties: {
        workbookId: {
          type: 'string',
          description: 'The ID of the workbook to get metadata for',
        },
      },
      required: ['workbookId'],
    },
  };
}

/**
 * Get tool definition for list-views
 * 
 * List views from Tableau. Use this to enumerate views or find views by workbook ID,
 * view ID, or name. Useful for lineage display.
 * 
 * @returns LLMTool definition for list-views
 * 
 * @example
 * ```typescript
 * const tool = getListViewTool();
 * // Returns: { name: 'list-views', description: '...', input_schema: {...} }
 * ```
 */
export function getListViewTool(): LLMTool {
  return {
    name: 'list-views',
    description: 'List views from Tableau. Use this to enumerate views or find views by workbook ID, view ID, or name. Useful for lineage display.',
    input_schema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description: 'Optional filter expression to filter views (e.g., "workbookName:eq:My Workbook")',
        },
        pageSize: {
          type: 'number',
          description: 'Optional number of views per page',
        },
        limit: {
          type: 'number',
          description: 'Optional maximum number of views to return',
        },
      },
      // No required parameters - all are optional
    },
  };
}

/**
 * Get all MCP tool definitions
 * 
 * Returns an array of all MCP tool definitions ready to be sent to the LLM Gateway.
 * This is the main function used by Phase 4 (Tool-Calling Loop) to provide tool
 * definitions to the LLM.
 * 
 * @returns Array of LLMTool definitions for all MCP tools
 * 
 * @example
 * ```typescript
 * const tools = getMCPToolDefinitions();
 * // Returns: [
 * //   { name: 'list-datasources', ... },
 * //   { name: 'get-datasource-metadata', ... },
 * //   { name: 'query-datasource', ... },
 * //   { name: 'get-workbook', ... },
 * //   { name: 'list-views', ... }
 * // ]
 * 
 * // Use with LLM Gateway
 * const stream = await llmClient.streamToolCalling(messages, tools);
 * ```
 */
export function getMCPToolDefinitions(): LLMTool[] {
  return [
    getListDatasourcesTool(),
    getGetDatasourceMetadataTool(),
    getQueryDatasourceTool(),
    getGetWorkbookTool(),
    getListViewTool(),
  ];
}

