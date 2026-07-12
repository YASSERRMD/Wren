import type { WrenTool } from './WrenTool.js';

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
}
