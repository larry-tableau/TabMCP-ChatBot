/**
 * ChatInterface component
 * Phase 5, Task 1: Chat interface with message bubbles
 * Phase 5, Task 5: Progress indicators integration
 * Phase 5, Task 6: SSE-driven progress integration
 * 
 * This component handles:
 * - Message input and display
 * - Message bubbles (user/assistant)
 * - Auto-scroll to latest message
 * - Progress indicators (Task 5)
 * - SSE-driven progress (Task 6)
 * 
 * Future enhancements (separate tasks):
 * - Streaming response display (Task 2)
 * - Citation popup (Task 2)
 * - Error message display (Task 7)
 */

import React, { useState, useRef, useEffect } from 'react';
import ProgressIndicator from './ProgressIndicator';
import ErrorMessage, { type ErrorData } from './ErrorMessage';
import CitationPopup, { type CitationObject } from './CitationPopup';
import MarkdownRenderer from './MarkdownRenderer';
import { useChatSSE } from '../hooks/useChatSSE';
import './ChatInterface.css';

// Citation interface matching CitationForSSE from useChatSSE
interface CitationForDisplay {
  datasource: {
    name?: string;
    luid: string;
  };
  workbook?: {
    name?: string;
    id: string;
  };
  view?: {
    name?: string;
    id: string;
  };
  fields: Array<{
    name: string;
    aggregation?: string;
    role?: string;
  }>;
  filters?: Array<{
    field: string;
    type?: string;
    [key: string]: unknown;
  }>;
  queryTimestamp: string;
  tool: string;
  parameters: Record<string, unknown>;
}

interface Message {
  role: 'user' | 'assistant' | 'error';
  content: string;
  timestamp?: string;
  errorData?: ErrorData; // For error messages
  citations?: CitationForDisplay[]; // Citations for assistant messages
}

interface ChatInterfaceProps {
  datasourceLuid?: string;
  workbookId?: string;
  viewId?: string;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ datasourceLuid, workbookId, viewId }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Use SSE hook for chat streaming
  const { answer, citations, progressPhase, error, isStreaming, sessionId, sendMessage } = useChatSSE();
  
  // Citation popup state
  const [selectedCitation, setSelectedCitation] = useState<CitationObject | null>(null);
  
  // Helper function to convert CitationForDisplay to CitationObject
  const convertToCitationObject = (citation: CitationForDisplay): CitationObject => {
    return {
      datasource: {
        name: citation.datasource.name || citation.datasource.luid,
        luid: citation.datasource.luid,
      },
      workbook: citation.workbook ? {
        name: citation.workbook.name || citation.workbook.id,
        id: citation.workbook.id,
      } : undefined,
      view: citation.view ? {
        name: citation.view.name || citation.view.id,
        id: citation.view.id,
      } : undefined,
      fields: citation.fields.map(f => ({
        name: f.name,
        aggregation: f.aggregation,
        role: f.role || 'dimension', // Default role if not provided
      })),
      filters: (citation.filters || []).map(f => ({
        field: f.field,
        type: f.type || 'unknown', // Default type if not provided (CitationObject requires type)
        ...Object.fromEntries(
          Object.entries(f).filter(([key]) => key !== 'field' && key !== 'type')
        ),
      })),
      queryTimestamp: citation.queryTimestamp,
    };
  };

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    });
  };

  // Scroll when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Scroll when loading state changes or answer updates
  useEffect(() => {
    if (isStreaming || answer) {
      scrollToBottom();
    }
  }, [isStreaming, answer]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  // Handle answer updates from SSE hook
  useEffect(() => {
    if (answer && !isStreaming) {
      // Answer is complete, add to messages (if not already added)
      setMessages((prev) => {
        // Check if this answer is already in messages (avoid duplicates)
        const lastMessage = prev[prev.length - 1];
        if (lastMessage && lastMessage.role === 'assistant' && lastMessage.content === answer) {
          // Update existing message with citations if they changed
          if (citations.length > 0 && JSON.stringify(lastMessage.citations) !== JSON.stringify(citations)) {
            return prev.map((msg, idx) => 
              idx === prev.length - 1 
                ? { ...msg, citations: citations.length > 0 ? citations : undefined }
                : msg
            );
          }
          return prev;
        }
        const assistantMessage: Message = {
          role: 'assistant',
          content: answer,
          timestamp: new Date().toISOString(),
          citations: citations.length > 0 ? citations : undefined,
        };
        return [...prev, assistantMessage];
      });
      setTimeout(scrollToBottom, 100);
    }
  }, [answer, citations, isStreaming]);

  // Handle errors from SSE hook
  useEffect(() => {
    if (error) {
      console.error('[ChatInterface] Error:', error);
      const errorMessage: Message = {
        role: 'error',
        content: error.message, // User-friendly message
        timestamp: error.timestamp || new Date().toISOString(),
        errorData: error, // Full error data for ErrorMessage component
      };
      setMessages((prev) => [...prev, errorMessage]);
      setTimeout(scrollToBottom, 100);
    }
  }, [error]);

  // Load conversation history on mount (if sessionId exists)
  useEffect(() => {
    if (!sessionId || sessionId.trim().length === 0) {
      return; // No sessionId, skip history loading
    }

    let cancelled = false;

    const loadHistory = async () => {
      try {
        const response = await fetch(`/api/chat/history?sessionId=${encodeURIComponent(sessionId)}`);
        
        if (!response.ok) {
          // Graceful degradation: if history fetch fails, continue without history
          if (import.meta.env.DEV) {
            console.warn('[ChatInterface] Failed to load conversation history:', response.status);
          }
          return;
        }

        const data = await response.json() as { messages?: Array<{ role: string; content: string }> };
        
        if (cancelled) {
          return; // Component unmounted, don't update state
        }

        if (data.messages && Array.isArray(data.messages) && data.messages.length > 0) {
          // Convert history messages to Message[] format
          const historyMessages: Message[] = data.messages.map((msg) => ({
            role: msg.role === 'user' ? 'user' : msg.role === 'assistant' ? 'assistant' : 'error',
            content: msg.content,
            timestamp: new Date().toISOString(), // Use current timestamp if not available
          }));

          // Set messages state with history (only if messages state is empty)
          setMessages((prev) => {
            // Only load history if messages state is empty (avoid overwriting new messages)
            if (prev.length === 0) {
              return historyMessages;
            }
            return prev;
          });
        }
      } catch (err) {
        // Graceful degradation: if history fetch fails, continue without history
        if (import.meta.env.DEV) {
          console.warn('[ChatInterface] Error loading conversation history:', err);
        }
      }
    };

    loadHistory();

    // Cleanup: mark as cancelled if component unmounts
    return () => {
      cancelled = true;
    };
  }, [sessionId]); // Only run when sessionId changes (on mount or when sessionId is set)

  // Handle message submission
  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    
    const trimmedInput = input.trim();
    if (!trimmedInput || isStreaming) {
      return;
    }

    // Add user message
    const userMessage: Message = {
      role: 'user',
      content: trimmedInput,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    // Immediate scroll after user message
    setTimeout(scrollToBottom, 50);

    // Send message via SSE hook
    sendMessage(trimmedInput, {
      datasourceLuid,
      workbookId,
      viewId,
    });
  };

  // Handle Enter key (Shift+Enter for new line)
  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="chat-interface">
      <div className="chat-messages-container">
        {messages.length === 0 && !isStreaming ? (
          <div className="chat-empty-state">
            <div className="chat-empty-state-icon">💬</div>
            <div className="chat-empty-state-text">Start a conversation</div>
            <div className="chat-empty-state-subtext">
              Ask me about your Tableau data sources, fields, or run queries
            </div>
          </div>
        ) : (
          <>
            {messages.map((message, index) => (
              <div
                key={index}
                className={`chat-message ${
                  message.role === 'user'
                    ? 'chat-message-user'
                    : message.role === 'error'
                      ? 'chat-message-error'
                      : 'chat-message-assistant'
                }`}
              >
                <div className="chat-message-content">
                  {message.role === 'error' && message.errorData ? (
                    <ErrorMessage error={message.errorData} timestamp={message.timestamp} />
                  ) : (
                    <>
                      {message.role === 'assistant' ? (
                        <MarkdownRenderer content={message.content} />
                      ) : (
                        message.content
                      )}
                      {message.citations && message.citations.length > 0 && (
                        <div className="chat-message-citations">
                          <button
                            className="chat-citation-badge"
                            onClick={() => {
                              // Convert first citation to CitationObject for CitationPopup
                              const firstCitation = message.citations![0];
                              setSelectedCitation(convertToCitationObject(firstCitation));
                            }}
                            title="View citation details"
                          >
                            📊 {message.citations.length > 1 ? `${message.citations.length} Sources` : 'Source'}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
                {message.timestamp && (
                  <div className="chat-message-timestamp">
                    {new Date(message.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                )}
              </div>
            ))}
            {isStreaming && (
              <div className="chat-message chat-message-assistant chat-message-loading">
                <div className="chat-message-content">
                  {answer ? (
                    // Show streaming answer
                    <>{answer}</>
                  ) : isStreaming && !answer && !progressPhase && !error ? (
                    // Show skeleton while waiting for first progress event (Phase 8, Task 3)
                    <div className="chat-message-skeleton" aria-busy="true" aria-label="Loading answer...">
                      <div className="skeleton skeleton-line"></div>
                      <div className="skeleton skeleton-line skeleton-line-medium"></div>
                      <div className="skeleton skeleton-line skeleton-line-short"></div>
                    </div>
                  ) : (
                    // Show progress indicator when progressPhase is set
                    <ProgressIndicator phase={progressPhase} />
                  )}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      <form className="chat-input-container" onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Type your message here... (Shift+Enter for new line)"
          rows={1}
          disabled={isStreaming}
        />
        <button
          type="submit"
          className="chat-send-button"
          disabled={!input.trim() || isStreaming}
          aria-label="Send message"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M18 2L9 11M18 2L12 18L9 11M18 2L2 8L9 11"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </form>
      
      {/* Citation Popup */}
      {selectedCitation && (
        <CitationPopup
          citation={selectedCitation}
          onClose={() => setSelectedCitation(null)}
        />
      )}
    </div>
  );
};

export default ChatInterface;
