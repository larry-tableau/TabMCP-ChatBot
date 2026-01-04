/**
 * LineageContextBar component
 * Phase 5, Task 4: Lineage context bar (datasource → workbook → view)
 * 
 * This component displays the lineage chain:
 * Datasource → Workbook → View
 * 
 * CRITICAL: Never hard-code datasource LUIDs, workbook IDs, view IDs, or names
 * All values come from props
 */

import React from 'react';
import './LineageContextBar.css';

export interface LineageContextBarProps {
  datasourceLuid: string;
  datasourceName?: string;
  workbookId?: string;
  workbookName?: string;
  viewId?: string;
  viewName?: string;
}

const LineageContextBar: React.FC<LineageContextBarProps> = ({
  datasourceLuid,
  datasourceName,
  workbookId,
  workbookName,
  viewId,
  viewName,
}) => {
  // Format lineage string from props
  const formatLineage = (): string => {
    const parts: string[] = [];

    // Datasource (required)
    if (datasourceName) {
      parts.push(datasourceName);
    } else if (datasourceLuid) {
      // Fallback to LUID if name not provided (truncated for display)
      parts.push(`${datasourceLuid.substring(0, 8)}...`);
    } else {
      parts.push('Unknown Datasource');
    }

    // Workbook (optional)
    if (workbookName) {
      parts.push(workbookName);
    } else if (workbookId) {
      // Fallback to ID if name not provided (truncated for display)
      parts.push(`${workbookId.substring(0, 8)}...`);
    }

    // View (optional)
    if (viewName) {
      parts.push(viewName);
    } else if (viewId) {
      // Fallback to ID if name not provided (truncated for display)
      parts.push(`${viewId.substring(0, 8)}...`);
    }

    // Join with arrow separator
    return parts.join(' → ');
  };

  const lineageText = formatLineage();

  // Don't render if no datasource LUID
  if (!datasourceLuid) {
    return null;
  }

  return (
    <div className="lineage-context-bar">
      <span className="lineage-context-bar-prefix">📊 Context:</span>
      <span className="lineage-context-bar-text">{lineageText}</span>
    </div>
  );
};

export default LineageContextBar;
