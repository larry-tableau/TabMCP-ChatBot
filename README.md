# Tableau AI Assistant Chatbot MVP

A natural language interface for querying Tableau data sources, powered by LLM tool-calling and Tableau MCP integration.

## Overview

This chatbot enables business users to ask natural language questions about their data and receive answers with citations. It integrates with Tableau via the Model Context Protocol (MCP) and uses LLM tool-calling to dynamically query datasources.

## What This App Does

This app lets you ask questions about your data in plain English. You type a question like "What are my total sales?" and the app finds the answer in your Tableau data. It shows you where the answer came from with citations, so you can see which data sources were used. The app remembers your conversation, so you can ask follow-up questions and it will understand the context.

## Features

- Natural language query interface
- Dynamic datasource selection
- Tool-calling loop with LLM integration
- Citation generation for answers
- Lineage tracking (datasource → workbook → view)
- Real-time progress indicators
- Session-based conversation state

## Tech Stack

- **Frontend:** React + Vite + TypeScript
- **Backend:** Node.js + Express + TypeScript
- **LLM:** Anthropic Claude via LLM Gateway
- **Integration:** Tableau MCP
- **Deployment:** Heroku

## Quick Start (Simple)

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Copy the example environment file:**
   ```bash
   cp .env.example .env
   ```

3. **Fill in your tokens:**
   Open the `.env` file and add your authentication tokens. You'll need:
   - MCP URL and token (for Tableau access)
   - LLM Gateway URL and token (for AI responses)

4. **Run the app (development):**
   ```bash
   npm run dev
   ```

The app will start. Open your browser to `http://localhost:3000` to use it.

## Prerequisites

- Node.js 18+ and npm
- Access to Tableau MCP endpoint
- LLM Gateway credentials
- Tableau datasource access

## Setup Instructions

### 1. Clone and Install

```bash
# Install dependencies
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env` with your actual values:
- `MCP_URL`: Your Tableau MCP endpoint URL
- `MCP_AUTH_TOKEN`: Your MCP authentication token
- `LLM_GATEWAY_URL`: LLM Gateway endpoint
- `ANTHROPIC_AUTH_TOKEN`: Your Anthropic API token
- `DEFAULT_DATASOURCE_LUID`: Default datasource LUID (optional, can be set at runtime)
- `DEFAULT_DATASOURCE_NAME`: Default datasource name (optional)
- `DEFAULT_WORKBOOK_ID`: Default workbook ID (optional)
- `DEFAULT_WORKBOOK_NAME`: Default workbook name (optional)
- `DEFAULT_VIEW_ID`: Default view ID (optional)
- `DEFAULT_VIEW_NAME`: Default view name (optional)
- `PORT`: Server port (default: 4001)
- `NODE_ENV`: Environment (development/production)

**Important:** Never hard-code datasource LUIDs, workbook IDs, or view IDs in the code. Always use environment variables or dynamic retrieval from Tableau MCP.

### 3. Run in Development

```bash
# Start development server (runs both frontend and backend)
npm run dev
```

The frontend will be available at `http://localhost:3000` and the backend API at `http://localhost:4001`.

### 4. Run in Production

```bash
# Build both frontend and backend
npm run build

# Start production server (serves the built frontend)
npm start
```

**Note:** `npm start` only runs the server. It does not run the Vite dev client.  
If you skip `npm run build`, the UI will not be available.

To explicitly run in production mode:
```bash
NODE_ENV=production npm start
```

## Project Structure

```
TabMCP_ChatBot_v3/
├── src/
│   ├── client/          # React frontend
│   │   ├── components/  # React components
│   │   └── hooks/       # React hooks
│   └── server/          # Express backend
│       ├── server.ts    # Main server file
│       ├── mcpClient.ts # MCP client integration
│       ├── llmClient.ts # LLM gateway client
│       └── ...
├── docs/                # Documentation
└── dist/                # Build output (generated)
```

## Development Guidelines

### Critical Rules: NO HARD-CODING

**NEVER hard-code:**
- Datasource LUIDs
- Workbook IDs
- View IDs
- Datasource/workbook/view names

**ALWAYS use:**
- Environment variables for defaults
- Dynamic retrieval from Tableau MCP
- Runtime configuration
- Session state for user selections

### Code Style

- TypeScript strict mode enabled
- Follow `.cursorrules` guidelines
- Document architectural decisions
- Write self-documenting code

### Dependencies Notes

- `@types/cors` was added to devDependencies to satisfy TypeScript strict mode requirements for the cors middleware
- `concurrently` was added to devDependencies to run both frontend and backend together with `npm run dev`

## API Endpoints

For detailed API documentation, see [docs/API.md](docs/API.md).

Quick reference:
- `POST /api/chat` - Send chat message and receive live updates
- `GET /api/events` - Live updates stream (Server-Sent Events)

## Heroku Deployment

### Prerequisites
- Heroku CLI installed
- Heroku account with app created

### Deployment Steps

1. **Create Heroku App:**
   ```bash
   heroku create your-app-name
   ```

2. **Configure Buildpacks:**
   Heroku will auto-detect the Node.js buildpack from `package.json`. If needed, explicitly set it:
   ```bash
   heroku buildpacks:set heroku/nodejs
   ```

3. **Set Environment Variables:**
   ```bash
   heroku config:set MCP_URL=your-mcp-url
   heroku config:set MCP_AUTH_TOKEN=your-token
   heroku config:set LLM_GATEWAY_URL=your-gateway-url
   heroku config:set ANTHROPIC_AUTH_TOKEN=your-token
   heroku config:set LLM_MODEL=claude-sonnet-4-5-20250929
   heroku config:set NODE_ENV=production
   # Optional defaults:
   heroku config:set DEFAULT_DATASOURCE_LUID=your-luid
   heroku config:set DEFAULT_DATASOURCE_NAME=your-name
   heroku config:set DEFAULT_WORKBOOK_ID=your-workbook-id
   heroku config:set DEFAULT_WORKBOOK_NAME=your-workbook-name
   heroku config:set DEFAULT_VIEW_ID=your-view-id
   heroku config:set DEFAULT_VIEW_NAME=your-view-name
   ```

4. **Deploy:**
   ```bash
   git push heroku main
   ```

5. **Verify:**
   ```bash
   heroku open
   heroku logs --tail
   ```

### Build Process
- Heroku runs `npm install` (installs dependencies)
- Heroku runs `npm run build` (builds TypeScript and Vite frontend)
- Heroku runs `web: npm start` (from Procfile, starts the server)

### Notes
- Heroku automatically provides `PORT` environment variable
- Server reads `PORT` from environment via config module
- Frontend is served by Express server in production
- All non-API routes serve `index.html` for SPA routing
- Static assets are cached for 1 year with ETag support

## Common Issues

**Problem: Missing tokens error**
- **Solution:** Make sure you've copied `.env.example` to `.env` and filled in all required tokens (MCP_AUTH_TOKEN, ANTHROPIC_AUTH_TOKEN, etc.)

**Problem: Server not running**
- **Solution:** Run `npm run dev` to start both the frontend and backend. The server should be available at `http://localhost:4001`. Check the terminal for error messages.

**Problem: Can't connect to Tableau**
- **Solution:** Verify your MCP_URL and MCP_AUTH_TOKEN in the `.env` file are correct. Make sure the Tableau MCP endpoint is accessible from your network.

**Problem: App shows errors in browser**
- **Solution:** Check that both frontend (port 3000) and backend (port 4001) are running. Open browser developer tools (F12) to see detailed error messages.

## Documentation

- `docs/API.md` - API endpoint documentation
- `docs/spec.md` - Complete product specification
- `docs/Coding_Workflow_Assistant.md` - Coding guidelines
- `plan.md` - Project plan and status tracking

## License

MIT
