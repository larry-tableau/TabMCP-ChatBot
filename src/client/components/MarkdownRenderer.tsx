/**
 * MarkdownRenderer component
 * Phase 8: Markdown rendering for assistant messages
 * 
 * Renders markdown content using react-markdown with remark-gfm for GitHub Flavored Markdown support.
 * Security: No rehype-raw (raw HTML disabled for XSS prevention).
 * 
 * Features:
 * - Tables with scroll container (mobile-friendly)
 * - Headings (h1, h2, h3)
 * - Bold, italic, lists, code blocks
 * - Links with security attributes (target="_blank" rel="noopener noreferrer")
 * - Matches e-bikes demo aesthetics
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './MarkdownRenderer.css';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  return (
    <div className={`markdown-content ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // NO rehypePlugins - security: don't enable raw HTML (XSS prevention)
        components={{
          // Custom table styling with scroll container for mobile
          table: ({ children }) => (
            <div className="markdown-table-wrapper">
              <table className="markdown-table">{children}</table>
            </div>
          ),
          // Custom heading styling
          h1: ({ children }) => <h1 className="markdown-h1">{children}</h1>,
          h2: ({ children }) => <h2 className="markdown-h2">{children}</h2>,
          h3: ({ children }) => <h3 className="markdown-h3">{children}</h3>,
          // Security: links open in new tab with noopener noreferrer
          a: ({ href, children }) => (
            <a 
              href={href} 
              className="markdown-link" 
              target="_blank" 
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer;

