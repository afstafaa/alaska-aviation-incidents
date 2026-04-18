import { env } from "cloudflare:workers";
import { createMcpAgent } from "@cloudflare/playwright-mcp";

export const PlaywrightMCP = createMcpAgent(env.BROWSER, {
  // Keep screenshots available in clients that can render image responses.
  imageResponses: "allow",
});

export interface Env {
  BROWSER: Fetcher;
  MCP_OBJECT: DurableObjectNamespace;
}

export default {
  fetch(request: Request, workerEnv: Env, ctx: ExecutionContext) {
    const { pathname } = new URL(request.url);

    switch (pathname) {
      case "/sse":
      case "/sse/message":
        return PlaywrightMCP.serveSSE("/sse").fetch(request, workerEnv, ctx);
      case "/mcp":
        return PlaywrightMCP.serve("/mcp").fetch(request, workerEnv, ctx);
      default:
        return new Response(
          JSON.stringify({
            ok: true,
            service: "cloudflare-playwright-mcp-worker",
            endpoints: ["/sse", "/mcp"],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
          },
        );
    }
  },
};
