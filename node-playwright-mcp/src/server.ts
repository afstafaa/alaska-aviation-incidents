import express, { type Request, type Response } from "express";
import { chromium, type Browser, type BrowserContext, type Cookie, type Page } from "playwright";
import { randomUUID } from "node:crypto";

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: any;
};

type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async ensurePage(): Promise<Page> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
    }
    if (!this.context) {
      this.context = await this.browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
    }
    if (!this.page || this.page.isClosed()) {
      this.page = await this.context.newPage();
    }
    return this.page;
  }

  async close(): Promise<void> {
    await this.page?.close().catch(() => undefined);
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.page = null;
    this.context = null;
    this.browser = null;
  }

  async setCookies(cookies: Cookie[]): Promise<number> {
    const page = await this.ensurePage();
    const context = page.context();
    await context.addCookies(cookies);
    return cookies.length;
  }

  async getCookies(urls?: string[]): Promise<Cookie[]> {
    const page = await this.ensurePage();
    const context = page.context();
    return context.cookies(urls);
  }
}

const tools: ToolDef[] = [
  {
    name: "open_page",
    description: "Open a URL and wait until the page is loaded.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        waitUntil: { type: "string", enum: ["load", "domcontentloaded", "networkidle"] },
        timeoutMs: { type: "number" },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "click",
    description: "Click an element specified by CSS selector.",
    inputSchema: {
      type: "object",
      properties: { selector: { type: "string" }, timeoutMs: { type: "number" } },
      required: ["selector"],
      additionalProperties: false,
    },
  },
  {
    name: "type",
    description: "Fill or type text into an element by selector.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string" },
        text: { type: "string" },
        pressEnter: { type: "boolean" },
        mode: { type: "string", enum: ["fill", "type"] },
      },
      required: ["selector", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "wait_for",
    description: "Wait for a selector, text, or timeout.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string" },
        text: { type: "string" },
        timeoutMs: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "screenshot",
    description: "Capture a screenshot of the current page and return base64 PNG.",
    inputSchema: {
      type: "object",
      properties: {
        fullPage: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "extract_text",
    description: "Extract text from a selector (defaults to body).",
    inputSchema: {
      type: "object",
      properties: { selector: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "extract_links",
    description: "Extract links from the page.",
    inputSchema: {
      type: "object",
      properties: { selector: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "get_html",
    description: "Get page HTML content.",
    inputSchema: {
      type: "object",
      properties: { selector: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "set_cookies",
    description: "Set cookies in browser context.",
    inputSchema: {
      type: "object",
      properties: {
        cookies: {
          type: "array",
          items: { type: "object" },
        },
      },
      required: ["cookies"],
      additionalProperties: false,
    },
  },
  {
    name: "get_cookies",
    description: "Get cookies in browser context.",
    inputSchema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
        },
      },
      additionalProperties: false,
    },
  },
];

const sessions = new Map<string, BrowserSession>();

function getSession(req: Request): { id: string; session: BrowserSession } {
  const id = String(req.header("x-session-id") || "default");
  let session = sessions.get(id);
  if (!session) {
    session = new BrowserSession();
    sessions.set(id, session);
  }
  return { id, session };
}

function success(id: JsonRpcId, result: any) {
  return { jsonrpc: "2.0", id, result };
}

function failure(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

async function runTool(session: BrowserSession, name: string, args: Record<string, any> = {}) {
  return session.withLock(async () => {
    const page = await session.ensurePage();

    switch (name) {
      case "open_page": {
        const waitUntil = args.waitUntil ?? "domcontentloaded";
        const timeout = args.timeoutMs ?? 45_000;
        const response = await page.goto(args.url, { waitUntil, timeout });
        return {
          url: page.url(),
          status: response?.status() ?? null,
          title: await page.title(),
        };
      }
      case "click": {
        await page.click(args.selector, { timeout: args.timeoutMs ?? 30_000 });
        return { ok: true };
      }
      case "type": {
        if ((args.mode ?? "fill") === "type") {
          await page.click(args.selector, { timeout: 30_000 });
          await page.type(args.selector, args.text);
        } else {
          await page.fill(args.selector, args.text);
        }
        if (args.pressEnter) {
          await page.keyboard.press("Enter");
        }
        return { ok: true };
      }
      case "wait_for": {
        const timeout = args.timeoutMs ?? 30_000;
        if (args.selector) {
          await page.waitForSelector(args.selector, { timeout });
        } else if (args.text) {
          await page.getByText(args.text).first().waitFor({ timeout });
        } else {
          await page.waitForTimeout(timeout);
        }
        return { ok: true };
      }
      case "screenshot": {
        const bytes = await page.screenshot({ fullPage: Boolean(args.fullPage), type: "png" });
        return {
          contentType: "image/png",
          base64: Buffer.from(bytes).toString("base64"),
        };
      }
      case "extract_text": {
        const selector = args.selector ?? "body";
        const text = await page.locator(selector).first().innerText();
        return { selector, text };
      }
      case "extract_links": {
        const selector = args.selector ?? "a[href]";
        const links = await page.$$eval(selector, (elements) =>
          elements.map((el) => ({
            text: (el.textContent || "").trim(),
            href: (el as HTMLAnchorElement).href || el.getAttribute("href"),
          })),
        );
        return { selector, count: links.length, links };
      }
      case "get_html": {
        if (args.selector) {
          const html = await page.locator(args.selector).first().innerHTML();
          return { selector: args.selector, html };
        }
        return { html: await page.content() };
      }
      case "set_cookies": {
        const count = await session.setCookies(args.cookies || []);
        return { ok: true, count };
      }
      case "get_cookies": {
        const cookies = await session.getCookies(args.urls);
        return { count: cookies.length, cookies };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });
}

const app = express();
app.use(express.json({ limit: "10mb" }));

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "node-playwright-mcp",
    endpoints: {
      mcp: "/mcp",
      sse: "/sse",
    },
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get("/sse", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const id = randomUUID();
  res.write(`event: ready\n`);
  res.write(`data: ${JSON.stringify({ connectionId: id, message: "Use /mcp for streamable HTTP requests." })}\n\n`);

  const heartbeat = setInterval(() => {
    res.write(`event: ping\n`);
    res.write(`data: ${JSON.stringify({ ts: Date.now() })}\n\n`);
  }, 15_000);

  req.on("close", () => {
    clearInterval(heartbeat);
  });
});

app.post("/mcp", async (req: Request, res: Response) => {
  const rpc = req.body as JsonRpcRequest;
  const id = rpc?.id ?? null;

  if (!rpc || rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") {
    res.status(400).json(failure(id, -32600, "Invalid Request"));
    return;
  }

  const { id: sessionId, session } = getSession(req);
  res.setHeader("x-session-id", sessionId);

  try {
    switch (rpc.method) {
      case "initialize": {
        res.json(
          success(id, {
            protocolVersion: "2025-03-26",
            serverInfo: {
              name: "node-playwright-mcp",
              version: "0.1.0",
            },
            capabilities: {
              tools: {},
            },
          }),
        );
        return;
      }
      case "notifications/initialized": {
        res.status(202).end();
        return;
      }
      case "tools/list": {
        res.json(success(id, { tools }));
        return;
      }
      case "tools/call": {
        const name = rpc.params?.name as string;
        const args = (rpc.params?.arguments ?? {}) as Record<string, unknown>;
        const result = await runTool(session, name, args);
        res.json(
          success(id, {
            content: [
              {
                type: "text",
                text: JSON.stringify(result),
              },
            ],
            structuredContent: result,
            isError: false,
          }),
        );
        return;
      }
      case "ping": {
        res.json(success(id, { ok: true }));
        return;
      }
      default:
        res.json(failure(id, -32601, `Method not found: ${rpc.method}`));
        return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.json(failure(id, -32000, message));
  }
});

const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "0.0.0.0";

const server = app.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`node-playwright-mcp listening on http://${host}:${port}`);
});

async function shutdown() {
  for (const session of sessions.values()) {
    await session.close();
  }
  server.close();
}

process.on("SIGINT", () => {
  shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  shutdown().finally(() => process.exit(0));
});
