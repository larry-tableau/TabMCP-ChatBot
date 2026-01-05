/**
 * Environment variable validation
 * Validates required environment variables on startup
 */

import { DEFAULT_LLM_MAX_TOKENS } from '../config.js';

interface EnvConfig {
  required: string[];
  optional: string[];
}

const ENV_CONFIG: EnvConfig = {
  required: [
    'MCP_URL',
    'MCP_AUTH_TOKEN',
    'LLM_GATEWAY_URL',
    'ANTHROPIC_AUTH_TOKEN',
  ],
  optional: [
    'LLM_MODEL',
    'LLM_MAX_TOKENS',
    'DEFAULT_DATASOURCE_LUID',
    'DEFAULT_DATASOURCE_NAME',
    'DEFAULT_WORKBOOK_ID',
    'DEFAULT_WORKBOOK_NAME',
    'DEFAULT_VIEW_ID',
    'DEFAULT_VIEW_NAME',
    'PORT',
    'NODE_ENV',
    'MAX_TOOL_RESULT_SIZE_BYTES',
    'MAX_QUERY_RESULT_ROWS',
  ],
};

/**
 * Validates environment variables
 * @throws Error if required variables are missing
 */
export function validateEnvironment(): void {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Check required variables
  for (const key of ENV_CONFIG.required) {
    if (!process.env[key] || process.env[key]?.trim() === '') {
      missing.push(key);
    }
  }

  // Check optional variables (log warnings)
  for (const key of ENV_CONFIG.optional) {
    if (!process.env[key] || process.env[key]?.trim() === '') {
      warnings.push(key);
    }
  }

  // Fail fast if required variables are missing
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }

  // Log warnings for missing optional variables
  // Special handling for LLM_MAX_TOKENS - log as info with default value
  const llmMaxTokensMissing = warnings.includes('LLM_MAX_TOKENS');
  const otherWarnings = warnings.filter(w => w !== 'LLM_MAX_TOKENS');
  
  if (llmMaxTokensMissing && process.env.NODE_ENV !== 'test') {
    console.info(
      `Info: LLM_MAX_TOKENS not set, using default: ${DEFAULT_LLM_MAX_TOKENS}`
    );
  }
  
  if (otherWarnings.length > 0 && process.env.NODE_ENV !== 'test') {
    console.warn(
      `Warning: Missing optional environment variables: ${otherWarnings.join(', ')}`
    );
  }
}

