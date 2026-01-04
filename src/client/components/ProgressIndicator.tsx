/**
 * ProgressIndicator component
 * Phase 5, Task 5: Progress indicator with phase-based display
 * 
 * This component displays progress states during query processing:
 * - "Thinking..." (reasoning phase)
 * - "Querying data..." (tool call phase)
 * - "Processing results..." (LLM synthesis phase)
 * 
 * This is a presentational component only. It receives the current phase as a prop.
 * Real SSE-driven progress will be wired in Phase 5 Task 6.
 */

import React from 'react';
import './ProgressIndicator.css';

export type ProgressPhase = 'reasoning' | 'tool_call' | 'processing' | null;

export interface ProgressIndicatorProps {
  phase: ProgressPhase;
}

const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({ phase }) => {
  // Get progress message based on phase
  const getProgressMessage = (): string => {
    switch (phase) {
      case 'reasoning':
        return 'Thinking...';
      case 'tool_call':
        return 'Querying data...';
      case 'processing':
        return 'Processing results...';
      case null:
      default:
        return '';
    }
  };

  const message = getProgressMessage();

  // Don't render if no active phase
  if (!phase || !message) {
    return null;
  }

  return (
    <div className="progress-indicator">
      <div className="progress-indicator-spinner">
        <div className="progress-indicator-dot"></div>
        <div className="progress-indicator-dot"></div>
        <div className="progress-indicator-dot"></div>
      </div>
      <span className="progress-indicator-message">{message}</span>
    </div>
  );
};

export default ProgressIndicator;
