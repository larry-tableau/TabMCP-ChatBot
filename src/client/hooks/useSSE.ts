/**
 * useSSE hook
 * Phase 1, Task 5: Basic SSE connection implementation
 * 
 * This hook handles:
 * - Server-Sent Events (SSE) connection
 * - Streaming response handling
 * - Event parsing and state management
 * - Connection error handling
 * 
 * Full event handling will be implemented in Phase 5
 */

import { useEffect, useState, useRef } from 'react';

export interface SSEEventData {
  [key: string]: unknown;
}

export const useSSE = (url: string) => {
  const [data, setData] = useState<string>('');
  const [error, setError] = useState<Error | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Create EventSource connection
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;
    
    // Connection opened
    eventSource.onopen = () => {
      setIsConnected(true);
      setError(null);
      console.log('SSE connection established:', url);
    };
    
    // Default message handler (for events without custom type)
    eventSource.onmessage = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.text) {
          setData((prev) => prev + parsed.text);
        }
      } catch (err) {
        // If not JSON, treat as plain text
        setData((prev) => prev + event.data);
      }
    };
    
    // Custom event handlers for different event types
    eventSource.addEventListener('connected', (event: MessageEvent) => {
      console.log('SSE connected event:', event.data);
      setIsConnected(true);
    });
    
    eventSource.addEventListener('reasoning_start', (event: MessageEvent) => {
      console.log('Reasoning started:', event.data);
      // Will be handled in Phase 5 with progress indicators
    });
    
    eventSource.addEventListener('tool_call_start', (event: MessageEvent) => {
      console.log('Tool call started:', event.data);
      // Will be handled in Phase 5 with progress indicators
    });
    
    eventSource.addEventListener('tool_call_complete', (event: MessageEvent) => {
      console.log('Tool call completed:', event.data);
      // Will be handled in Phase 5 with progress indicators
    });
    
    eventSource.addEventListener('answer_start', (event: MessageEvent) => {
      console.log('Answer started:', event.data);
      setData(''); // Clear previous answer
    });
    
    eventSource.addEventListener('answer_chunk', (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data) as SSEEventData;
        if (parsed.text && typeof parsed.text === 'string') {
          setData((prev) => prev + parsed.text);
        }
      } catch (err) {
        console.error('Error parsing answer_chunk:', err);
      }
    });
    
    eventSource.addEventListener('answer_complete', (event: MessageEvent) => {
      console.log('Answer completed:', event.data);
      // Will be handled in Phase 5 with citation display
    });
    
    eventSource.addEventListener('error', (event: MessageEvent) => {
      console.error('SSE error event:', event.data);
      setError(new Error('SSE error event received'));
    });
    
    // Connection error handler
    eventSource.onerror = (err) => {
      console.error('SSE connection error:', err);
      setError(new Error('SSE connection error'));
      setIsConnected(false);
      
      // Close connection on error
      eventSource.close();
      eventSourceRef.current = null;
    };
    
    // Cleanup on unmount
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        setIsConnected(false);
        console.log('SSE connection closed');
      }
    };
  }, [url]);

  return { data, error, isConnected };
};

