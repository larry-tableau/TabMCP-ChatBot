/**
 * String Similarity Utilities
 * Shared utilities for string normalization and similarity scoring
 * Used by both error-path typo suggestions and success-path correction detection
 */

/**
 * Normalize string for comparison (lowercase, trim, collapse spaces)
 * Used for field name matching to handle case-insensitive comparisons
 */
export function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' '); // Collapse multiple spaces to single space
}

/**
 * Compute Levenshtein distance between two strings
 * Returns the minimum number of single-character edits needed to transform one string into another
 * Used for fuzzy field name matching
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  
  // Create matrix
  const matrix: number[][] = [];
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }
  
  // Fill matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,     // deletion
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j - 1] + 1  // substitution
        );
      }
    }
  }
  
  return matrix[len1][len2];
}

/**
 * Score similarity between input string and candidate string
 * Returns score between 0.0 and 1.0, where 1.0 is exact match
 * Scoring strategy:
 * - Exact match (case-insensitive) → 1.0
 * - Starts with → 0.8
 * - Includes → 0.6
 * - Levenshtein distance ratio → 1 - (distance / maxLen)
 * 
 * @param input - Input string to match
 * @param candidate - Candidate string to compare against
 * @returns Similarity score (0.0 to 1.0)
 */
export function scoreSimilarity(input: string, candidate: string): number {
  const normalizedInput = normalizeString(input);
  const normalizedCandidate = normalizeString(candidate);
  
  // Exact match (case-insensitive)
  if (normalizedInput === normalizedCandidate) {
    return 1.0;
  }
  
  // Starts with
  if (normalizedCandidate.startsWith(normalizedInput)) {
    return 0.8;
  }
  
  // Includes
  if (normalizedCandidate.includes(normalizedInput)) {
    return 0.6;
  }
  
  // Levenshtein distance ratio
  const distance = levenshteinDistance(normalizedInput, normalizedCandidate);
  const maxLen = Math.max(normalizedInput.length, normalizedCandidate.length);
  if (maxLen === 0) {
    return 0.0;
  }
  return 1 - (distance / maxLen);
}

