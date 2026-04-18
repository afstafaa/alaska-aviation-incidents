# Node.js Playwright MCP Server (Container-hosted)

Minimal remote MCP server for ChatGPT using **Node.js + TypeScript + Playwright**.  
No Cloudflare Workers required.

## Features

- Public MCP endpoint for ChatGPT on normal container hosts.
- Streamable HTTP MCP endpoint: `POST /mcp`.
- SSE endpoint available: `GET /sse`.
- Tools included:
  - `open_page`
  - `click`
  - `type`
  - `wait_for`
  - `screenshot`
  - `extract_text`
  - `extract_links`
  - `get_html`
  - `set_cookies`
  - `get_cookies`
- Session persistence via `x-session-id` header (defaults to `default` if not supplied).

## Project files

- `package.json`
- `tsconfig.json`
- `src/server.ts`
- `Dockerfile`

## Run locally

```bash
cd node-playwright-mcp
npm install
npm run build
npm run start
```

Server defaults to `http://0.0.0.0:8080`.

## MCP endpoint details

- Streamable HTTP: `POST /mcp`
- SSE (optional transport/helper): `GET /sse`
- Health: `GET /health`

For ChatGPT remote MCP, use the streamable endpoint URL:

```text
https://<your-public-host>/mcp
```

## Docker

Build and run:

```bash
docker build -t node-playwright-mcp .
docker run --rm -p 8080:8080 node-playwright-mcp
```

## Deploy on Render

1. Push this folder to GitHub.
2. In Render, create a **Web Service** from that repo.
3. Configure:
   - Runtime: **Docker**
   - Port: `8080`
4. Deploy.
5. Your MCP URL:
   - `https://<render-service>.onrender.com/mcp`

## Deploy on Railway

1. Create a new Railway project from your GitHub repo.
2. Railway detects Dockerfile automatically.
3. Ensure service exposes port `8080`.
4. Deploy.
5. Your MCP URL:
   - `https://<railway-domain>/mcp`

## Deploy on Fly.io

1. Install `flyctl` and login.
2. From this folder:

```bash
fly launch --no-deploy
fly deploy
```

3. Confirm app is healthy:

```bash
fly status
curl -i https://<fly-app-name>.fly.dev/health
```

4. Your MCP URL:
   - `https://<fly-app-name>.fly.dev/mcp`

## Notes for logged-in JavaScript-heavy browsing

- Uses full Playwright Chromium in a persistent in-memory browser context per session ID.
- Set auth/session cookies with `set_cookies`, then navigate with `open_page`.
- Keep the same `x-session-id` value between calls to preserve login state.
- Use `wait_for` before extraction when dynamic content is still rendering.

## Minimal MCP test with curl

```bash
curl -s http://127.0.0.1:8080/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'

curl -s http://127.0.0.1:8080/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```
