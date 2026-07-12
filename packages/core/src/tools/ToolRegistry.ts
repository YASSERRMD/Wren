import { matchesSchema } from '../nano/validateSchema.js';
import type { WrenTool, WrenToolResult } from './WrenTool.js';

/** Framework-agnostic tool source: the declarative React/Angular bindings (Phases 12, 13) are built on the unregister handle this returns. */
export class ToolRegistry {
  private readonly tools = new Map<string, WrenTool>();

  register(tool: WrenTool): () => void {
    this.tools.set(tool.name, tool);
    return () => this.unregister(tool.name);
  }

  unregister(name: string): void {
    this.tools.delete(name);
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
}
