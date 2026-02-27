# AGENTS.md — tailscale-lm-bridge

## Architecture
Two-project monorepo: a React frontend (Vite, port 3000) and an Express backend proxy (port 3001).
The backend (`backend/server.js`) proxies requests to LM Studio's native `/api/v1/chat` endpoint (default `localhost:7002`, configurable via `LM_STUDIO_URL` env var). This enables stateful chat via `previous_response_id` and MCP tool integration via `integrations`. A legacy `/v1/chat/completions` endpoint is preserved for backwards compatibility. A `/api/health` endpoint tests LM Studio connectivity.
The frontend (`frontend/src/App.jsx`) is a mobile-friendly chat UI with SSE streaming, model selection, MCP server config (including one-tap Unity MCP toggle), reasoning toggle, collapsible tool call display, markdown rendering (`marked`), localStorage session persistence (survives page refresh), token usage display, and a quick-actions toolbar for common Unity operations. Both servers bind `0.0.0.0` for Tailscale network access.

## Build & Run
- **Backend:** `cd backend && npm start` (runs `node server.js`)
- **Frontend dev:** `cd frontend && npm run dev`
- **Frontend build:** `cd frontend && npm run build`
- **Lint:** `cd frontend && npx eslint .`
- No test framework is configured.

## Code Style
- Frontend: React 19 + Vite 8, JSX (not TSX), ES modules, functional components with hooks.
- Backend: Node.js CommonJS (`require`), Express + Axios + CORS, no TypeScript.
- ESLint: `@eslint/js` recommended + `react-hooks` + `react-refresh`; unused vars allowed if capitalized/underscored.
- Use `const` for top-level declarations; arrow functions for callbacks; async/await for fetch/axios.
- Inline styles in JSX are acceptable (existing pattern). CSS goes in `src/index.css` or `src/App.css`.
- Error handling: try/catch with user-facing error messages appended to chat state.
