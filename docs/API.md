# API Documentation

This document describes the API endpoints available in the Tableau AI Assistant Chatbot.

## What is an API?

An API (Application Programming Interface) is how different parts of the app talk to each other. Think of it like a menu at a restaurant - it tells you what you can order and what you'll get back.

## Understanding the Terms

- **Endpoint:** A specific URL where you can send requests (like `/api/chat`)
- **Request:** What you send to the server (your question or command)
- **Response:** What the server sends back (the answer or data)
- **Session ID (conversation ID):** A unique identifier that keeps track of your conversation. The app uses this to remember what you've asked before.
- **Live updates (SSE):** Real-time updates that stream to your browser as they happen, like watching a live feed.

## Endpoints

### Health Check Endpoints

These endpoints let you check if the server is running and healthy.

#### GET /health

Check if the server is running.

**Request:** None (just visit the URL)

**Response:**
```json
{
  "status": "ok",
  "phase": "Phase 1: Backend infrastructure setup",
  "timestamp": "2026-01-04T10:00:00.000Z",
  "uptime": 12345
}
```

#### GET /api/health

Same as `/health`, but with the `/api` prefix. Use this if you prefer consistency with other API endpoints.

**Request:** None

**Response:** Same as `/health`

---

### Data Sources

#### GET /api/datasources

Get a list of all available data sources from Tableau.

**Request:** None (just visit the URL)

**Response:**
```json
[
  {
    "id": "datasource-luid-123",
    "name": "Sales Data",
    "type": "tableau"
  }
]
```

**Note:** Results are cached for 30 seconds to improve performance.

---

### Chat Endpoints

#### POST /api/chat

Send a chat message and receive live updates as the app processes your question.

**Request:**
```json
{
  "message": "What are my total sales?",
  "sessionId": "optional-conversation-id",
  "datasourceLuid": "optional-datasource-id",
  "workbookId": "optional-workbook-id",
  "viewId": "optional-view-id"
}
```

**Response:** Live updates stream (Server-Sent Events)

The response comes as live updates (SSE) with these event types:

- **reasoning_start:** The app is thinking about your question
- **tool_call_start:** The app is fetching data from Tableau
- **tool_call_complete:** Data fetch completed
- **answer_start:** The app is generating your answer
- **answer_chunk:** A piece of the answer (you'll see multiple of these)
- **answer_complete:** The final answer with citations
- **error:** Something went wrong (includes helpful suggestions)

**Example response events:**
```
event: reasoning_start
data: {"timestamp": "2026-01-04T10:00:00.000Z"}

event: tool_call_start
data: {"tool": "query-datasource", "timestamp": "2026-01-04T10:00:01.000Z"}

event: answer_chunk
data: {"text": "Your total sales are ", "timestamp": "2026-01-04T10:00:05.000Z"}

event: answer_complete
data: {
  "text": "Your total sales are $1,234,567.",
  "citations": [...],
  "timestamp": "2026-01-04T10:00:10.000Z"
}
```

**Response Headers:**
- `x-session-id`: Your conversation ID (use this for follow-up questions)

**Note:** The `sessionId` (conversation ID) helps the app remember your conversation. If you don't provide one, the app will create a new conversation. Use the `x-session-id` header from the response for follow-up messages.

---

#### GET /api/chat/history

Get the conversation history for a specific conversation.

**Request:**
Query parameter: `sessionId` (your conversation ID)

**Example:** `GET /api/chat/history?sessionId=abc-123-def`

**Response:**
```json
{
  "messages": [
    {
      "role": "user",
      "content": "What are my total sales?",
      "timestamp": "2026-01-04T10:00:00.000Z"
    },
    {
      "role": "assistant",
      "content": "Your total sales are $1,234,567.",
      "timestamp": "2026-01-04T10:00:10.000Z"
    }
  ]
}
```

**Note:** If no `sessionId` is provided or the conversation doesn't exist, returns an empty messages array.

---

### Live Updates (Server-Sent Events)

#### GET /api/events

Connect to a live updates stream. This endpoint sends real-time events to your browser.

**Request:** None (just connect to the URL)

**Response:** Live updates stream (Server-Sent Events)

**Event types:**
- **connected:** Connection established

**Note:** This endpoint is mainly for testing. The main chat endpoint (`POST /api/chat`) also provides live updates.

---

### Developer/Test Only

#### GET /api/events/test

Test endpoint that streams sample events to demonstrate how live updates work. This is for developers testing the SSE functionality.

**Request:** None

**Response:** Live updates stream with sample events

**Note:** This endpoint is for testing only. Use `POST /api/chat` for actual chat functionality.

---

## Error Responses

If something goes wrong, you'll receive an error response:

```json
{
  "error": "Error type",
  "message": "Human-readable error message",
  "recoverySuggestions": [
    "Try rephrasing your query",
    "Wait a moment and try again"
  ]
}
```

## Authentication

All endpoints require proper authentication tokens configured in your `.env` file:
- `MCP_AUTH_TOKEN`: For Tableau MCP access
- `ANTHROPIC_AUTH_TOKEN`: For AI responses

These tokens are not sent in API requests - they're configured on the server side.

## Rate Limiting

Currently, there are no rate limits. However, the datasources endpoint caches results for 30 seconds to improve performance.

## Support

For more information, see:
- [README.md](../README.md) - Setup and usage instructions
- [docs/spec.md](spec.md) - Complete product specification

