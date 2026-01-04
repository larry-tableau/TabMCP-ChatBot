/**
 * Main App component
 * Phase 1, Task 2: Basic structure with styling foundation
 * Full UI implementation will be completed in Phase 5
 */

import React, { useState, useEffect } from 'react';
import ChatInterface from './components/ChatInterface';
import DatasourceSelector from './components/DatasourceSelector';
import LineageContextBar from './components/LineageContextBar';
import './App.css';

const App: React.FC = () => {
  // State for current datasource LUID
  // Initial value: undefined (will be set from API or config after datasources load)
  const [currentDatasourceLuid, setCurrentDatasourceLuid] = useState<string | undefined>(undefined);
  const [currentDatasourceName, setCurrentDatasourceName] = useState<string | undefined>(undefined);
  // Workbook and view state (will be populated when available)
  const [currentWorkbookId, setCurrentWorkbookId] = useState<string | undefined>(undefined);
  const [currentWorkbookName, setCurrentWorkbookName] = useState<string | undefined>(undefined);
  const [currentViewId, setCurrentViewId] = useState<string | undefined>(undefined);
  const [currentViewName, setCurrentViewName] = useState<string | undefined>(undefined);

  // Fetch datasources on mount to determine default selection
  useEffect(() => {
    const initializeDatasource = async () => {
      try {
        const response = await fetch('/api/datasources');
        if (response.ok) {
          const datasources = await response.json();
          if (Array.isArray(datasources) && datasources.length > 0) {
            // Default: use first datasource from API (per addendum requirement)
            // If config.defaults.datasourceLuid exists and matches a datasource, use that instead
            // But we can't access config from client, so we'll use first from API
            // This ensures we have a default selection without hard-coding
            const firstDatasource = datasources[0];
            setCurrentDatasourceLuid((prev) => {
              // Only set if not already set (allows parent to set initial value)
              return prev ?? firstDatasource.id;
            });
            setCurrentDatasourceName(firstDatasource.name);
          }
        }
      } catch (error) {
        // Silently fail - selector will handle error display
        console.error('[App] Error initializing datasource:', error);
      }
    };

    initializeDatasource();
  }, []); // Only run on mount

  // Fetch datasource name when datasource LUID changes
  useEffect(() => {
    if (!currentDatasourceLuid) {
      setCurrentDatasourceName(undefined);
      return;
    }

    const fetchDatasourceName = async () => {
      try {
        const response = await fetch('/api/datasources');
        if (response.ok) {
          const datasources = await response.json();
          if (Array.isArray(datasources)) {
            const datasource = datasources.find((ds: { id: string; name: string }) => ds.id === currentDatasourceLuid);
            if (datasource) {
              setCurrentDatasourceName(datasource.name);
            }
          }
        }
      } catch (error) {
        // Silently fail - lineage bar will show LUID if name not available
        console.error('[App] Error fetching datasource name:', error);
      }
    };

    fetchDatasourceName();
  }, [currentDatasourceLuid]);

  const handleDatasourceChange = (luid: string) => {
    setCurrentDatasourceLuid(luid);
    // Clear workbook/view when datasource changes (will be populated when available)
    setCurrentWorkbookId(undefined);
    setCurrentWorkbookName(undefined);
    setCurrentViewId(undefined);
    setCurrentViewName(undefined);
    // TODO: Phase 5 Task 4 - Invalidate context cache on backend
    // For now, just update state (context will be rebuilt on next query)
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-top">
          <div className="app-header-title-section">
            <h1 className="app-title">Tableau AI Assistant Chatbot</h1>
            <p className="app-subtitle">Natural language interface for your data</p>
          </div>
          <div className="app-header-controls">
            <DatasourceSelector
              currentDatasourceLuid={currentDatasourceLuid}
              onDatasourceChange={handleDatasourceChange}
            />
          </div>
        </div>
        {currentDatasourceLuid && (
          <LineageContextBar
            datasourceLuid={currentDatasourceLuid}
            datasourceName={currentDatasourceName}
            workbookId={currentWorkbookId}
            workbookName={currentWorkbookName}
            viewId={currentViewId}
            viewName={currentViewName}
          />
        )}
      </header>
      <main className="app-main">
        <ChatInterface
          datasourceLuid={currentDatasourceLuid}
          workbookId={currentWorkbookId}
          viewId={currentViewId}
        />
      </main>
    </div>
  );
};

export default App;

