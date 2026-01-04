/**
 * Clarification Logic
 * Phase 7, Task 3: Implement context-aware follow-ups and clarification prompts
 * 
 * This module handles:
 * - Detecting when user questions need clarification
 * - Generating clarification prompts based on ambiguity type
 * - Checking conversation history for context
 */

import type { ConversationState } from '../conversationState.js';

export interface ClarificationResult {
  needsClarification: boolean;
  question?: string;
  reason?: string;
}

/**
 * Check if user message needs clarification before executing tool calls
 * 
 * Heuristics (aligned with spec.md lines 1004-1007 + extensions):
 * 1. Ambiguous field names (multiple matches) - spec requirement
 * 2. Missing required parameters (date ranges, etc.) - spec requirement
 * 3. Unclear aggregation intent - spec requirement
 * 4. Conflicting filters - spec requirement
 * 5. Pronoun-only follow-ups ("that/it/this/compare") with no clear prior metric - extension
 * 6. Missing datasource/metric context when user asks data-specific questions - extension
 * 7. Missing time granularity for trends (daily/monthly/quarterly) - optional
 * 8. Missing comparison baseline ("compare to what?") when user asks "compare" - optional
 * 9. Ambiguous grouping dimension (e.g., "by region" when multiple region fields exist) - optional
 * 
 * @param userMessage - User's question/message
 * @param state - Current conversation state (for history and context)
 * @returns ClarificationResult with needsClarification flag and optional question
 */
export function needsClarification(
  userMessage: string,
  state?: ConversationState
): ClarificationResult {
  const history = state?.messages || [];
  const lastMessages = history.slice(-4); // Check last 4 messages for context

  // Heuristic 5: Pronoun-only follow-ups with no clear prior metric
  const pronounPattern = /\b(that|it|this|those|these)\b/i;
  const comparePattern = /\b(compare|comparison|vs|versus|compared to)\b/i;
  
  if (pronounPattern.test(userMessage) || comparePattern.test(userMessage)) {
    // Check if there's a clear prior metric/field mentioned in recent history
    const hasPriorMetric = lastMessages.some(msg => {
      const content = msg.content.toLowerCase();
      // Look for common metric indicators
      return /\b(sales|revenue|profit|quantity|count|total|average|sum)\b/i.test(content) ||
             /\b(field|metric|measure|dimension)\b/i.test(content);
    });
    
    if (!hasPriorMetric) {
      return {
        needsClarification: true,
        question: "I need a bit more information to answer your question:\n• What metric or data would you like me to compare or analyze?",
        reason: 'pronoun_followup_no_metric'
      };
    }
  }

  // Heuristic 8: Missing comparison baseline when user asks "compare"
  if (comparePattern.test(userMessage) && !/\b(to|with|against|between)\b/i.test(userMessage)) {
    return {
      needsClarification: true,
      question: "I need a bit more information to answer your question:\n• What would you like me to compare this to? (e.g., 'compare to last year', 'compare to Q1 2024')",
      reason: 'missing_comparison_baseline'
    };
  }

  // Heuristic 2: Missing required parameters (date ranges for trends)
  const trendPattern = /\b(trend|over time|over the|historical|past|recent|last|since|during)\b/i;
  const datePattern = /\b(\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|january|february|march|april|may|june|july|august|september|october|november|december|q1|q2|q3|q4|year|month|week|day)\b/i;
  
  if (trendPattern.test(userMessage) && !datePattern.test(userMessage)) {
    return {
      needsClarification: true,
      question: "I need a bit more information to answer your question:\n• What time period would you like to see? (e.g., 'last month', 'Q1 2024', 'past 6 months')",
      reason: 'missing_time_range'
    };
  }

  // Heuristic 7: Missing time granularity for trends
  if (trendPattern.test(userMessage) && !/\b(daily|monthly|quarterly|yearly|weekly|day|month|quarter|year|week)\b/i.test(userMessage)) {
    // Only ask if they haven't specified granularity and it's a trend question
    return {
      needsClarification: true,
      question: "I need a bit more information to answer your question:\n• What time granularity would you like? (e.g., daily, monthly, quarterly, yearly)",
      reason: 'missing_time_granularity'
    };
  }

  // Heuristic 6: Missing datasource/metric context for data-specific questions
  const dataSpecificPattern = /\b(show|display|list|get|find|what are|which|how many|how much)\b/i;
  const hasDatasourceContext = !!state?.currentDatasourceLuid;
  
  if (dataSpecificPattern.test(userMessage) && !hasDatasourceContext && history.length === 0) {
    // Only ask if this is the first message and no datasource context
    return {
      needsClarification: true,
      question: "I need a bit more information to answer your question:\n• Which datasource would you like me to query? (You can select a datasource from the dropdown or specify it in your question.)",
      reason: 'missing_datasource_context'
    };
  }

  // Heuristic 1: Ambiguous field names (basic check - full implementation would require datasource metadata)
  // This is a simplified check; full implementation would query datasource metadata
  // For MVP, we'll rely on LLM to detect this and ask for clarification via tool calls
  
  // Heuristic 3: Unclear aggregation intent (basic check)
  // This is a simplified check; full implementation would be more sophisticated
  // For MVP, we'll rely on LLM to detect unclear aggregation

  // Heuristic 4: Conflicting filters (would require parsing query structure)
  // This is complex and would require full query parsing
  // For MVP, we'll rely on LLM to detect conflicting filters

  // Heuristic 9: Ambiguous grouping dimension (would require datasource metadata)
  // This would require querying datasource metadata to check for multiple matching fields
  // For MVP, we'll rely on LLM to detect this

  // No clarification needed
  return {
    needsClarification: false
  };
}

/**
 * Build clarification question text based on reason
 * (Currently handled inline, but can be extracted for consistency)
 */
export function buildClarificationQuestion(reason: string): string {
  // Default format from spec.md lines 1010-1015
  const baseQuestion = "I need a bit more information to answer your question:";
  
  switch (reason) {
    case 'pronoun_followup_no_metric':
      return `${baseQuestion}\n• What metric or data would you like me to compare or analyze?`;
    case 'missing_comparison_baseline':
      return `${baseQuestion}\n• What would you like me to compare this to? (e.g., 'compare to last year', 'compare to Q1 2024')`;
    case 'missing_time_range':
      return `${baseQuestion}\n• What time period would you like to see? (e.g., 'last month', 'Q1 2024', 'past 6 months')`;
    case 'missing_time_granularity':
      return `${baseQuestion}\n• What time granularity would you like? (e.g., daily, monthly, quarterly, yearly)`;
    case 'missing_datasource_context':
      return `${baseQuestion}\n• Which datasource would you like me to query? (You can select a datasource from the dropdown or specify it in your question.)`;
    default:
      return `${baseQuestion}\n• Could you provide more details about what you're looking for?`;
  }
}

