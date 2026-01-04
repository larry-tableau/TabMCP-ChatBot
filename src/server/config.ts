/**
 * Centralized application configuration
 * Phase 1, Task 4: Centralized configuration module
 * 
 * Loads and validates environment variables
 * Provides typed access to all configuration values
 * 
 * This module:
 * - Loads environment variables from .env file (via dotenv)
 * - Validates required environment variables
 * - Provides typed configuration object
 * - Exports configuration interfaces for type safety
 */

import dotenv from 'dotenv';
import { validateEnvironment } from './utils/envValidation.js';

// Load environment variables from .env file
const envResult = dotenv.config();
if (envResult.error) {
  console.warn('Warning: .env file not found. Using environment variables from system.');
}

/**
 * Default maximum tokens for LLM requests
 * Used as fallback when LLM_MAX_TOKENS environment variable is not set
 */
export const DEFAULT_LLM_MAX_TOKENS = 1024;

/**
 * MCP (Model Context Protocol) configuration
 */
export interface MCPConfig {
  /** Tableau MCP endpoint URL */
  url: string;
  /** Authentication token for MCP requests */
  authToken: string;
}

/**
 * LLM (Large Language Model) configuration
 */
export interface LLMConfig {
  /** LLM Gateway endpoint URL */
  gatewayUrl: string;
  /** Anthropic API authentication token */
  authToken: string;
  /** LLM model identifier (default: 'claude-sonnet-4-5-20250929') */
  model: string;
  /** Default maximum tokens for requests (default: DEFAULT_LLM_MAX_TOKENS) */
  defaultMaxTokens: number;
}

/**
 * Default datasource/workbook/view configuration
 * All fields are optional - used as defaults when user hasn't selected a datasource
 * CRITICAL: These are defaults only, never hard-coded. Can be overridden at runtime.
 */
export interface DefaultConfig {
  /** Default datasource LUID (optional) */
  datasourceLuid?: string;
  /** Default datasource name (optional) */
  datasourceName?: string;
  /** Default workbook ID (optional) */
  workbookId?: string;
  /** Default workbook name (optional) */
  workbookName?: string;
  /** Default view ID (optional) */
  viewId?: string;
  /** Default view name (optional) */
  viewName?: string;
}

/**
 * Server configuration
 */
export interface ServerConfig {
  /** Server port (default: 4001) */
  port: number;
  /** Node environment (default: 'development') */
  nodeEnv: string;
}

/**
 * Complete application configuration
 */
export interface Config {
  /** MCP configuration (required) */
  mcp: MCPConfig;
  /** LLM configuration (required) */
  llm: LLMConfig;
  /** Default datasource/workbook/view configuration (optional) */
  defaults?: DefaultConfig;
  /** Server configuration */
  server: ServerConfig;
}

/**
 * Helper function to create a config object from current environment variables
 */
function createConfig(): Config {
  return {
    mcp: {
      url: process.env.MCP_URL || '',
      authToken: process.env.MCP_AUTH_TOKEN || '',
    },
    llm: {
      gatewayUrl: process.env.LLM_GATEWAY_URL || '',
      authToken: process.env.ANTHROPIC_AUTH_TOKEN || '',
      model: process.env.LLM_MODEL || 'claude-sonnet-4-5-20250929',
      defaultMaxTokens: (() => {
        const envValue = process.env.LLM_MAX_TOKENS;
        if (!envValue) {
          return DEFAULT_LLM_MAX_TOKENS;
        }
        const parsed = parseInt(envValue, 10);
        if (isNaN(parsed) || parsed < 1) {
          throw new Error(
            `Invalid LLM_MAX_TOKENS: "${envValue}". Must be an integer >= 1.`
          );
        }
        return parsed;
      })(),
    },
    defaults: {
      datasourceLuid: process.env.DEFAULT_DATASOURCE_LUID,
      datasourceName: process.env.DEFAULT_DATASOURCE_NAME,
      workbookId: process.env.DEFAULT_WORKBOOK_ID,
      workbookName: process.env.DEFAULT_WORKBOOK_NAME,
      viewId: process.env.DEFAULT_VIEW_ID,
      viewName: process.env.DEFAULT_VIEW_NAME,
    },
    server: {
      port: parseInt(process.env.PORT || '4001', 10),
      nodeEnv: process.env.NODE_ENV || 'development',
    },
  };
}

/**
 * Application configuration loaded from environment variables
 * 
 * This object provides typed access to all configuration values.
 * Environment variables are validated on module load.
 * 
 * Required environment variables:
 * - MCP_URL: Tableau MCP endpoint URL
 * - MCP_AUTH_TOKEN: MCP authentication token
 * - LLM_GATEWAY_URL: LLM Gateway endpoint URL
 * - ANTHROPIC_AUTH_TOKEN: Anthropic API authentication token
 * 
 * Optional environment variables:
 * - LLM_MODEL: LLM model identifier (default: 'claude-sonnet-4-5-20250929')
 * - LLM_MAX_TOKENS: Default maximum tokens for requests (default: DEFAULT_LLM_MAX_TOKENS, must be >= 1)
 * - DEFAULT_DATASOURCE_LUID: Default datasource LUID
 * - DEFAULT_DATASOURCE_NAME: Default datasource name
 * - DEFAULT_WORKBOOK_ID: Default workbook ID
 * - DEFAULT_WORKBOOK_NAME: Default workbook name
 * - DEFAULT_VIEW_ID: Default view ID
 * - DEFAULT_VIEW_NAME: Default view name
 * - PORT: Server port (default: 4001)
 * - NODE_ENV: Node environment (default: 'development')
 * 
 * @throws Error if required environment variables are missing
 */
export const config: Config = createConfig();

/**
 * Reloads the .env file and updates the config object
 * 
 * This function:
 * 1. Re-runs dotenv.config() to reload the .env file
 * 2. Updates the config object with new values
 * 3. Re-validates the environment variables
 * 
 * @returns The updated config object
 * @throws Error if required environment variables are missing after reload
 * 
 * @example
 * ```typescript
 * import { reloadConfig } from './config.js';
 * 
 * // After modifying .env file
 * const updatedConfig = reloadConfig();
 * console.log('Config reloaded:', updatedConfig);
 * ```
 */
export function reloadConfig(): Config {
  console.log('Reloading .env file...');
  
  // Reload environment variables from .env file
  const envResult = dotenv.config({ override: true });
  if (envResult.error) {
    console.warn('Warning: .env file not found. Using environment variables from system.');
  } else {
    console.log('Successfully reloaded .env file');
  }
  
  // Create new config from updated environment variables
  const newConfig = createConfig();
  
  // Update the config object (including nested objects)
  config.mcp.url = newConfig.mcp.url;
  config.mcp.authToken = newConfig.mcp.authToken;
  config.llm.gatewayUrl = newConfig.llm.gatewayUrl;
  config.llm.authToken = newConfig.llm.authToken;
  config.llm.model = newConfig.llm.model;
  config.llm.defaultMaxTokens = newConfig.llm.defaultMaxTokens;
  config.defaults = newConfig.defaults;
  config.server.port = newConfig.server.port;
  config.server.nodeEnv = newConfig.server.nodeEnv;
  
  // Re-validate configuration
  try {
    validateEnvironment();
    console.log('Configuration validation passed');
  } catch (error) {
    console.error('Configuration validation failed:', error instanceof Error ? error.message : String(error));
    throw error;
  }
  
  return config;
}

// Validate configuration on module load
// This will throw if required variables are missing
try {
  validateEnvironment();
} catch (error) {
  console.error('Configuration validation failed:', error instanceof Error ? error.message : String(error));
  throw error;
}

