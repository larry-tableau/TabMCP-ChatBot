/**
 * Field Correction Detection Utilities
 * Phase 8: Detect when LLM auto-corrects field name typos in successful queries
 * 
 * This module provides utilities to:
 * - Tokenize user messages
 * - Detect field name corrections by comparing tool call fields against user message tokens
 * - Build correction notes for successful answers
 */

import { normalizeString, scoreSimilarity } from './stringSimilarity.js';
import type { ToolCall } from './toolCallingFormat.js';

/**
 * Correction detected between user message token and field caption
 */
export interface FieldCorrection {
  /** Original token from user message (preserves casing) */
  originalToken: string;
  /** Normalized token (for matching) */
  token: string;
  /** Field caption that the token was interpreted as */
  fieldCaption: string;
  /** Similarity score (for sorting/prioritization) */
  score: number;
}

/**
 * Common stop words that should not trigger correction notes
 * These are common words that could cause false positives when matching against field names
 * Note: We exclude action verbs like "show", "get", "find" as they may be part of field names
 */
const STOP_WORDS = new Set([
  'for', 'the', 'and', 'with', 'all', 'any',
  'are', 'was', 'were', 'has', 'have', 'had', 'can', 'may', 'not', 'but',
  'from', 'into', 'onto', 'over', 'under', 'this', 'that', 'these', 'those',
]);

/**
 * Token with original casing preserved
 */
interface TokenWithCasing {
  /** Original token (preserves user's casing) */
  original: string;
  /** Normalized token (for matching) */
  normalized: string;
}

/**
 * Tokenize user message into alphanumeric tokens with original casing preserved
 * 
 * Splits message on non-alphanumeric characters, keeps alphanumeric tokens,
 * normalizes each token, and filters out:
 * - Tokens shorter than 3 characters
 * - Common stop words (to prevent false positives)
 * 
 * @param message - User message to tokenize
 * @returns Array of tokens with original and normalized forms
 * 
 * @example
 * ```typescript
 * tokenizeMessage("Show me total Salez for last month")
 * // Returns: [
 * //   { original: "Show", normalized: "show" },
 * //   { original: "total", normalized: "total" },
 * //   { original: "Salez", normalized: "salez" },
 * //   { original: "last", normalized: "last" },
 * //   { original: "month", normalized: "month" }
 * // ]
 * // Note: "me" (< 3 chars) and "for" (stop word) are filtered out
 * ```
 */
export function tokenizeMessage(message: string): TokenWithCasing[] {
  if (!message || typeof message !== 'string') {
    return [];
  }

  // Split on non-alphanumeric characters (keep alphanumeric + spaces)
  // This handles punctuation, quotes, etc.
  // First split on non-alphanumeric, then split each part on whitespace
  const parts = message.split(/[^a-zA-Z0-9\s]+/);
  const tokens: TokenWithCasing[] = [];
  
  for (const part of parts) {
    const words = part.split(/\s+/);
    for (const word of words) {
      if (word.trim().length === 0) {
        continue;
      }
      const normalized = normalizeString(word);
      // Filter: length >= 3 and not a stop word
      if (normalized.length >= 3 && !STOP_WORDS.has(normalized)) {
        tokens.push({
          original: word.trim(),
          normalized,
        });
      }
    }
  }

  return tokens;
}

/**
 * Detect field name corrections from user message and tool calls
 * 
 * Compares field captions from query-datasource tool calls against tokens
 * in the user message to detect when LLM auto-corrected a typo.
 * 
 * Algorithm:
 * 1. Filter tool calls for query-datasource
 * 2. Extract field captions from query.fields
 * 3. Tokenize user message
 * 4. For each field caption:
 *    - Skip if normalized fieldCaption is contained in normalized userMessage
 *    - Otherwise, compare against each token using similarity scoring
 *    - If score >= 0.8 and token length >= 3, record as correction
 * 5. Return array of corrections (highest score per field)
 * 
 * @param userMessage - Original user message
 * @param toolCalls - Array of all tool calls from the conversation
 * @returns Array of detected corrections
 * 
 * @example
 * ```typescript
 * const corrections = detectFieldCorrections(
 *   "Show me total Salez",
 *   [{ name: 'query-datasource', input: { query: { fields: [{ fieldCaption: 'Sales' }] } } }]
 * );
 * // Returns: [{ token: 'salez', fieldCaption: 'Sales', score: 0.8 }]
 * ```
 */
export function detectFieldCorrections(
  userMessage: string,
  toolCalls: ToolCall[]
): FieldCorrection[] {
  if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length === 0) {
    return [];
  }

  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return [];
  }

  // Filter for query-datasource tool calls only
  const queryToolCalls = toolCalls.filter(tc => tc.name === 'query-datasource');
  if (queryToolCalls.length === 0) {
    return [];
  }

  // Normalize user message for containment check
  const normalizedUserMessage = normalizeString(userMessage);

  // Tokenize user message (returns tokens with original casing preserved)
  const tokenData = tokenizeMessage(userMessage);

  if (tokenData.length === 0) {
    return [];
  }

  // Collect all field captions from query-datasource calls
  const fieldCaptions: string[] = [];
  for (const toolCall of queryToolCalls) {
    const query = toolCall.input?.query;
    if (!query || typeof query !== 'object' || Array.isArray(query)) {
      continue;
    }

    const fields = (query as { fields?: unknown }).fields;
    if (!Array.isArray(fields)) {
      continue;
    }

    for (const field of fields) {
      const fieldCaption = (field as { fieldCaption?: unknown }).fieldCaption;
      if (typeof fieldCaption === 'string' && fieldCaption.trim().length > 0) {
        fieldCaptions.push(fieldCaption);
      }
    }
  }

  if (fieldCaptions.length === 0) {
    return [];
  }

  // Detect corrections
  const corrections: FieldCorrection[] = [];

  for (const fieldCaption of fieldCaptions) {
    const normalizedFieldCaption = normalizeString(fieldCaption);

    // Skip if field caption already appears in user message (no correction needed)
    if (normalizedUserMessage.includes(normalizedFieldCaption)) {
      continue;
    }

    // Compare against each token
    let bestMatch: { originalToken: string; token: string; score: number } | null = null;

    for (const tokenInfo of tokenData) {
      const normalizedToken = tokenInfo.normalized;
      // Token length check (already filtered to >= 3 in tokenizeMessage, but double-check)
      if (normalizedToken.length < 3) {
        continue;
      }

      const score = scoreSimilarity(normalizedToken, fieldCaption);

      // Threshold: score >= 0.8 (or >= 0.9 for tokens length <= 3 to reduce false positives)
      const threshold = normalizedToken.length <= 3 ? 0.9 : 0.8;
      if (score >= threshold) {
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = {
            originalToken: tokenInfo.original,
            token: normalizedToken,
            score,
          };
        }
      }
    }

    // If we found a match, record the correction
    if (bestMatch) {
      corrections.push({
        originalToken: bestMatch.originalToken,
        token: bestMatch.token,
        fieldCaption,
        score: bestMatch.score,
      });
    }
  }

  // Sort by score descending (highest confidence first)
  corrections.sort((a, b) => b.score - a.score);

  // Deduplicate: if same token->fieldCaption pair appears multiple times, keep only the highest score
  const seen = new Map<string, FieldCorrection>();
  for (const correction of corrections) {
    const key = `${correction.token}->${correction.fieldCaption}`;
    const existing = seen.get(key);
    if (!existing || correction.score > existing.score) {
      seen.set(key, correction);
    }
  }

  return Array.from(seen.values());
}

/**
 * Build correction note string from detected corrections
 * 
 * Formats corrections into a user-friendly note that will be appended
 * to successful answers.
 * 
 * @param corrections - Array of detected corrections
 * @returns Formatted note string or null if no corrections
 * 
 * @example
 * ```typescript
 * buildCorrectionNote([{ token: 'salez', fieldCaption: 'Sales', score: 0.8 }])
 * // Returns: "\n\nNote: Interpreted "Salez" as "Sales"."
 * 
 * buildCorrectionNote([
 *   { token: 'salez', fieldCaption: 'Sales', score: 0.8 },
 *   { token: 'amout', fieldCaption: 'Amount', score: 0.85 }
 * ])
 * // Returns: "\n\nNote: Interpreted "Salez" as "Sales"; "Amout" as "Amount"."
 * ```
 */
export function buildCorrectionNote(corrections: FieldCorrection[]): string | null {
  if (!Array.isArray(corrections) || corrections.length === 0) {
    return null;
  }

  // Format each correction (use originalToken to preserve user's casing)
  const parts = corrections.map(c => `"${c.originalToken}" as "${c.fieldCaption}"`);

  if (parts.length === 1) {
    return `\n\nNote: Interpreted ${parts[0]}.`;
  } else {
    return `\n\nNote: Interpreted ${parts.join('; ')}.`;
  }
}

