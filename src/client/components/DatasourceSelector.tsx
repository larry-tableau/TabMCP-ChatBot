/**
 * DatasourceSelector component
 * Phase 5, Task 3: Datasource selector with searchable dropdown
 * 
 * This component handles:
 * - Fetching available datasources from API
 * - Displaying datasources in searchable dropdown
 * - Highlighting current selection
 * - Handling datasource selection
 * - Quick switch without losing conversation context
 * 
 * CRITICAL: Never hard-code datasource LUIDs or names
 * Always retrieve dynamically from API
 */

import React, { useState, useEffect, useRef } from 'react';
import './DatasourceSelector.css';

export interface Datasource {
  id: string; // Datasource LUID
  name: string; // Friendly name
  description?: string; // Optional description
  project?: {
    name: string;
    id: string;
  };
}

interface DatasourceSelectorProps {
  currentDatasourceLuid?: string;
  onDatasourceChange: (luid: string) => void;
}

const DatasourceSelector: React.FC<DatasourceSelectorProps> = ({
  currentDatasourceLuid,
  onDatasourceChange,
}) => {
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  // Fetch datasources on component mount
  useEffect(() => {
    const fetchDatasources = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/datasources');
        if (!response.ok) {
          throw new Error(`Failed to fetch datasources: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        if (!Array.isArray(data)) {
          throw new Error('Invalid response format: expected array');
        }
        setDatasources(data);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
        console.error('[DatasourceSelector] Error fetching datasources:', errorMessage);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDatasources();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Filter datasources by search query
  const filteredDatasources = datasources.filter((ds) =>
    ds.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Get current datasource name
  const currentDatasource = datasources.find((ds) => ds.id === currentDatasourceLuid);

  const handleSelect = (luid: string) => {
    onDatasourceChange(luid);
    setIsOpen(false);
    setSearchQuery('');
  };

  const handleToggle = () => {
    setIsOpen(!isOpen);
    if (!isOpen) {
      setSearchQuery('');
    }
  };

  return (
    <div className="datasource-selector" ref={selectorRef}>
      <button
        type="button"
        className="datasource-selector-button"
        onClick={handleToggle}
        aria-label="Select datasource"
        aria-expanded={isOpen}
        disabled={isLoading}
      >
        <span className="datasource-selector-label">Datasource:</span>
        <span className="datasource-selector-value">
          {isLoading ? (
            <span className="datasource-selector-skeleton" aria-busy="true" aria-label="Loading datasources...">
              <span className="skeleton skeleton-line skeleton-line-medium"></span>
            </span>
          ) : error ? (
            <span className="datasource-selector-error">Error</span>
          ) : currentDatasource ? (
            currentDatasource.name
          ) : (
            'Select datasource'
          )}
        </span>
        <span className="datasource-selector-arrow">{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div className="datasource-selector-dropdown">
          {error ? (
            <div className="datasource-selector-error-message">
              <p>Error loading datasources</p>
              <p className="datasource-selector-error-details">{error}</p>
            </div>
          ) : (
            <>
              <div className="datasource-selector-search">
                <input
                  type="text"
                  className="datasource-selector-search-input"
                  placeholder="Search datasources..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="datasource-selector-list">
                {filteredDatasources.length === 0 ? (
                  <div className="datasource-selector-empty">
                    {searchQuery ? 'No datasources found' : 'No datasources available'}
                  </div>
                ) : (
                  filteredDatasources.map((datasource) => (
                    <button
                      key={datasource.id}
                      type="button"
                      className={`datasource-selector-item ${
                        datasource.id === currentDatasourceLuid
                          ? 'datasource-selector-item-selected'
                          : ''
                      }`}
                      onClick={() => handleSelect(datasource.id)}
                    >
                      <div className="datasource-selector-item-name">{datasource.name}</div>
                      <div className="datasource-selector-item-luid">{datasource.id}</div>
                      {datasource.description && (
                        <div className="datasource-selector-item-description">
                          {datasource.description}
                        </div>
                      )}
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default DatasourceSelector;
