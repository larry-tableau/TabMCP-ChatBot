/**
 * CitationPopup component
 * Phase 5, Task 2: Citation popup with summary/JSON toggle
 * 
 * This component handles:
 * - Display citations in modal overlay
 * - Summary view (default) - formatted citation information
 * - JSON view (toggle) - full citation object as JSON
 * - Toggle between summary and JSON views
 * - Close functionality (button and overlay click)
 * 
 * Future enhancements (separate tasks):
 * - Citation extraction (Phase 6)
 * - Citation badge display in ChatInterface (can be added separately)
 */

import React, { useState, useEffect } from 'react';
import './CitationPopup.css';

export interface CitationObject {
  datasource: {
    name: string;
    luid: string;
  };
  workbook?: {
    name: string;
    id: string;
  };
  view?: {
    name: string;
    id: string;
  };
  fields: Array<{
    name: string;
    aggregation?: string;
    role: string;
  }>;
  filters: Array<{
    field: string;
    type: string;
    [key: string]: unknown;
  }>;
  queryTimestamp: string;
}

interface CitationPopupProps {
  citation: CitationObject;
  onClose: () => void;
}

const CitationPopup: React.FC<CitationPopupProps> = ({ citation, onClose }) => {
  const [viewMode, setViewMode] = useState<'summary' | 'json'>('summary');

  // Datasource lookup map for resolving friendly names
  type Datasource = { id: string; name: string };
  const [datasourceNameById, setDatasourceNameById] = useState<Record<string, string>>({});
  
  // Loading state for datasource fetch (Phase 8, Task 3)
  const [isLoadingDatasources, setIsLoadingDatasources] = useState<boolean>(true);

  // Handle Escape key to close popup
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Fetch datasources to build lookup map
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/datasources');
        if (!res.ok) return;

        const datasources = (await res.json()) as Datasource[];
        if (cancelled) return;

        const map: Record<string, string> = {};
        for (const ds of datasources) {
          if (ds?.id && ds?.name) map[ds.id] = ds.name;
        }
        setDatasourceNameById(map);
      } catch {
        // Graceful fallback: keep existing citation display
      } finally {
        // Always set loading to false when fetch completes (Phase 8, Task 3)
        if (!cancelled) {
          setIsLoadingDatasources(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Format timestamp to readable format
  const formatTimestamp = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return timestamp;
    }
  };

  // Format field display with aggregation
  const formatField = (field: { name: string; aggregation?: string; role: string }): string => {
    if (field.aggregation) {
      return `${field.name} (${field.aggregation})`;
    }
    return field.name;
  };

  // Format filter display
  const formatFilter = (filter: { field: string; type: string; [key: string]: unknown }): string => {
    const { field, type, ...rest } = filter;
    if (type === 'date_range' && rest.min && rest.max) {
      return `${field} (${rest.min} to ${rest.max})`;
    }
    if (type === 'set' && Array.isArray(rest.values)) {
      return `${field} (${rest.values.join(', ')})`;
    }
    // Generic filter display
    const details = Object.entries(rest)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(', ');
    return `${field} (${type}${details ? `, ${details}` : ''})`;
  };

  // Compute displayCitation with resolved datasource name
  const shouldOverrideName =
    !citation.datasource.name || citation.datasource.name === citation.datasource.luid;

  const lookedUpName = datasourceNameById[citation.datasource.luid];

  const displayCitation: CitationObject =
    shouldOverrideName && lookedUpName
      ? { ...citation, datasource: { ...citation.datasource, name: lookedUpName } }
      : citation;

  // Render summary view
  const renderSummary = () => {
    return (
      <div className="citation-summary">
        <div className="citation-section">
          <h3 className="citation-section-title">📊 Source</h3>
          <div className="citation-section-content">
            <div className="citation-item">
              <span className="citation-label">Datasource:</span>
              <span className="citation-value">{displayCitation.datasource.name}</span>
            </div>
            {citation.workbook && (
              <div className="citation-item">
                <span className="citation-label">Workbook:</span>
                <span className="citation-value">{citation.workbook.name}</span>
              </div>
            )}
            {citation.view && (
              <div className="citation-item">
                <span className="citation-label">View:</span>
                <span className="citation-value">{citation.view.name}</span>
              </div>
            )}
          </div>
        </div>

        {citation.fields.length > 0 && (
          <div className="citation-section">
            <h3 className="citation-section-title">Fields</h3>
            <div className="citation-section-content">
              <ul className="citation-list">
                {citation.fields.map((field, index) => (
                  <li key={index}>{formatField(field)}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {citation.filters.length > 0 && (
          <div className="citation-section">
            <h3 className="citation-section-title">Filters</h3>
            <div className="citation-section-content">
              <ul className="citation-list">
                {citation.filters.map((filter, index) => (
                  <li key={index}>{formatFilter(filter)}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="citation-section">
          <h3 className="citation-section-title">Query Time</h3>
          <div className="citation-section-content">
            <div className="citation-item">
              <span className="citation-value">{formatTimestamp(citation.queryTimestamp)}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Render JSON view
  const renderJSON = () => {
    const jsonString = JSON.stringify(displayCitation, null, 2);
    return (
      <div className="citation-json">
        <pre className="citation-json-pre">
          <code className="citation-json-code">{jsonString}</code>
        </pre>
      </div>
    );
  };

  const handleToggleView = () => {
    setViewMode((prev) => (prev === 'summary' ? 'json' : 'summary'));
  };

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="citation-popup-overlay" onClick={handleOverlayClick}>
      <div className="citation-popup-modal" onClick={(e) => e.stopPropagation()}>
        <div className="citation-popup-header">
          <h2 className="citation-popup-title">Citation</h2>
          <div className="citation-popup-actions">
            <button
              type="button"
              className="citation-popup-toggle"
              onClick={handleToggleView}
              aria-label={viewMode === 'summary' ? 'Show JSON' : 'Show Summary'}
            >
              {viewMode === 'summary' ? 'Show JSON' : 'Show Summary'}
            </button>
            <button
              type="button"
              className="citation-popup-close"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>
        <div className="citation-popup-content">
          {isLoadingDatasources ? (
            <div className="citation-popup-skeleton" aria-busy="true" aria-label="Loading citation details...">
              <div className="skeleton skeleton-line"></div>
              <div className="skeleton skeleton-line skeleton-line-medium"></div>
              <div className="skeleton skeleton-line"></div>
              <div className="skeleton skeleton-line skeleton-line-short"></div>
            </div>
          ) : (
            viewMode === 'summary' ? renderSummary() : renderJSON()
          )}
        </div>
      </div>
    </div>
  );
};

export default CitationPopup;
