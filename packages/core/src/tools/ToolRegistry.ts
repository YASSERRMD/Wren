import { matchesSchema } from '../nano/validateSchema.js';
import type { WrenTool, WrenToolResult } from './WrenTool.js';
import './webmcp.js';

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const MAX_NAME_LENGTH = 40;
/** Nano's tool selection accuracy degrades as tool count rises. */
const TOOL_CAP = 7;

export class ToolNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolNameError';
  }
}

/**
 * Framework-agnostic tool source: the declarative React/Angular bindings
 * (Phases 12, 13) are built on the unregister handle register() returns.
 * It is also a WebMCP publisher: registering a tool here mirrors it into
 * navigator.modelContext for external agents, but Wren's own dispatcher
 * always calls this registry directly and works identically whether or
 * not WebMCP is present, since the bridge is for external agents only.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, WrenTool>();
  private readonly webmcpControllers = new Map<string, AbortController>();

  constructor(private readonly toolCap: number = TOOL_CAP) {}

  register(tool: WrenTool): () => void {
    this.assertValidName(tool.name);
    this.tools.set(tool.name, tool);
    this.warnIfOverCap();
    this.mirrorToWebMcp(tool);
    return () => this.unregister(tool.name);
  }

  unregister(name: string): void {
    this.tools.delete(name);
    this.webmcpControllers.get(name)?.abort();
    this.webmcpControllers.delete(name);
  }

  list(): WrenTool[] {
    return [...this.tools.values()];
  }

  get(name: string): WrenTool | undefined {
    return this.tools.get(name);
  }

  /** Validates args against inputSchema before calling execute; returns a structured error result rather than throwing on validation failure. */
  async invoke(name: string, args: Record<string, unknown>): Promise<WrenToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { content: `No tool registered with name "${name}"`, isError: true };
    }
    if (!matchesSchema(args, tool.inputSchema)) {
      return { content: `Arguments for tool "${name}" did not match its input schema`, isError: true };
    }
    try {
      return await tool.execute(args);
    } catch (error) {
      return {
        content: `Tool "${name}" threw: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  }

  private assertValidName(name: string): void {
    if (!NAME_PATTERN.test(name)) {
      throw new ToolNameError(
        `Tool name "${name}" must match ${NAME_PATTERN} (lowercase letters, digits, underscore, starting with a letter)`,
      );
    }
    if (name.length > MAX_NAME_LENGTH) {
      throw new ToolNameError(`Tool name "${name}" is ${name.length} characters, over the maximum of ${MAX_NAME_LENGTH}`);
    }
    if (this.tools.has(name)) {
      throw new ToolNameError(`A tool named "${name}" is already registered`);
    }
  }

  private warnIfOverCap(): void {
    if (this.tools.size > this.toolCap) {
      console.warn(
        `Wren: ${this.tools.size} tools registered, exceeding the recommended cap of ${this.toolCap}. ` +
          `Nano's tool selection accuracy degrades as tool count rises.`,
      );
    }
  }

  /**
   * Best-effort: registerTool() is async and register() is not, so this
   * cannot be awaited by the caller. A rejection (unsupported browser,
   * duplicate name at the WebMCP layer, invalid schema) is swallowed
   * rather than surfaced, since the registry's own state already updated
   * synchronously above and that is what Wren's own dispatcher relies on.
   */
  private mirrorToWebMcp(tool: WrenTool): void {
    if (typeof navigator === 'undefined' || !navigator.modelContext) return;

    const controller = new AbortController();
    this.webmcpControllers.set(tool.name, controller);

    navigator.modelContext
      .registerTool(
        {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as object,
          execute: async (input) => {
            const result = await tool.execute(input);
            if (result.isError) throw new Error(result.content);
            return result.content;
          },
        },
        { signal: controller.signal },
      )
      .catch(() => {
        // Unsupported browser, a duplicate name, or an invalid schema: see
        // the doc comment above for why this is intentionally swallowed.
      });
  }
}
