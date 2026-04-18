# Cloudflare Playwright MCP Worker

Smallest practical MCP server on Cloudflare Workers using Browser Rendering + Durable Objects.

## 1) Exact file contents

This project includes exact starter contents for:

- `package.json`
- `wrangler.jsonc`
- `src/index.ts`
- `tsconfig.json`

## 2) Deploy

```bash
npm install
npx wrangler login
npx wrangler deploy
```

## 3) Public URL to paste into ChatGPT Developer Mode

After `wrangler deploy`, Wrangler prints your Worker hostname:

- `https://<your-worker-name>.<your-subdomain>.workers.dev`

Use this MCP endpoint URL in ChatGPT:

- `https://<your-worker-name>.<your-subdomain>.workers.dev/sse`

And keep this alternate endpoint available:

- `https://<your-worker-name>.<your-subdomain>.workers.dev/mcp`

Where it comes from:
- `<your-worker-name>` is `name` in `wrangler.jsonc`.
- `<your-subdomain>` is your Cloudflare account workers.dev subdomain.

## 4) Test locally / test remotely

### Local

```bash
npx wrangler dev
curl -i http://127.0.0.1:8787/mcp
curl -i http://127.0.0.1:8787/sse
```

### Remote

```bash
curl -i https://<your-worker-name>.<your-subdomain>.workers.dev/mcp
curl -i https://<your-worker-name>.<your-subdomain>.workers.dev/sse
```

Expected:
- `/mcp` returns an MCP-capable response.
- `/sse` opens an SSE stream (or returns method/handshake guidance depending on client).

## 5) Connect to ChatGPT

1. Open ChatGPT **Developer Mode** MCP server configuration.
2. Add a **remote** MCP server.
3. Paste: `https://<your-worker-name>.<your-subdomain>.workers.dev/sse`
4. Save and connect.
5. Confirm browser tools appear.

> Do not use localhost in ChatGPT; use the deployed workers.dev URL.

## 6) Tool descriptions (action-oriented, optimized for selection)

Use prompts that explicitly ask for one action at a time:

- **Open a page**: "Open <URL> and wait for it to finish loading."
- **Snapshot the page**: "Capture an accessibility snapshot of the current page."
- **Click an element**: "Click the '<element name>' control."
- **Type into a field**: "Fill '<field>' with '<value>'."
- **Navigate**: "Go to <URL>."
- **Wait for content**: "Wait until '<text/selector>' is visible."
- **Take screenshot**: "Take a screenshot of the current page."

Practical tip: one clear action per message improves tool selection reliability.

## 7) Cloudflare dashboard checklist

- Workers enabled for your account.
- workers.dev subdomain created.
- **Browser Rendering (Browser Run) enabled** for the account.
- Worker has Browser binding (`BROWSER`) configured via Wrangler file.
- Worker has Durable Object binding (`MCP_OBJECT`) configured.
- Durable Object migration exists and has been deployed.
- Compatibility flag includes `nodejs_compat`.
- Compatibility date is `2026-04-18` or newer.

## 8) Browser Rendering prerequisites

- Cloudflare account with Browser Rendering entitlement enabled.
- Worker deployed with:
  - `[browser].binding = "BROWSER"` (JSONC equivalent in this repo).
  - Durable Object class + binding + migration.
- Use `@cloudflare/playwright-mcp` and route `/sse` + `/mcp`.

## 9) Troubleshooting

### A) MCP endpoint not connecting

- Confirm URL uses `https://...workers.dev/sse` (not `/mcp`, not localhost).
- Confirm Worker deploy succeeded and route is public.
- Check Worker logs:

```bash
npx wrangler tail
```

### B) No tools showing in ChatGPT

- Ensure ChatGPT MCP connection points to `/sse`.
- Reconnect the server after deploy.
- Verify the Worker exports `/sse` and `/sse/message` routes.

### C) Deploy succeeds but browser actions fail

- Check Browser binding name is exactly `BROWSER`.
- Confirm Browser Rendering is enabled on your Cloudflare account.
- Confirm Durable Object binding/class/migration names match:
  - binding `MCP_OBJECT`
  - class `PlaywrightMCP`
  - migration includes `PlaywrightMCP`
- Tail runtime logs for binding errors.

## 10) Final project tree

```text
cloudflare-playwright-mcp/
├─ package.json
├─ README.md
├─ tsconfig.json
├─ wrangler.jsonc
└─ src/
   └─ index.ts
```

## 11) Exact terminal commands to run

```bash
cd cloudflare-playwright-mcp
npm install
npx wrangler login
npx wrangler deploy
npx wrangler dev
```

## 12) Exact ChatGPT MCP URL format to paste

```text
https://<your-worker-name>.<your-subdomain>.workers.dev/sse
```
