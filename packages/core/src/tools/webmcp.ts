/**
 * Ambient types for WebMCP (`navigator.modelContext`), a W3C Community
 * Group draft, not yet shipped in TypeScript's DOM lib. Declares only the
 * surface Wren uses. Verified against the current spec and a working code
 * sample rather than assumed: registerTool lives on `navigator`, not
 * `document` (an earlier explainer draft used `document.modelContext`;
 * `navigator.modelContext` is what shipped in the Chrome 149 origin trial
 * and Edge 147). `navigator.modelContext` is `[SecureContext]`: it does
 * not exist at all on non-HTTPS pages.
 *
 * There is no dedicated unregister method: registerTool takes an
 * AbortSignal, and aborting it is how a page removes a previously
 * registered tool.
 */
export interface ModelContextTool {
  name: string;
  description: string;
  inputSchema?: object;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

export interface ModelContextRegisterToolOptions {
  signal?: AbortSignal;
}

export interface ModelContext {
  registerTool(tool: ModelContextTool, options?: ModelContextRegisterToolOptions): Promise<undefined>;
}

declare global {
  interface Navigator {
    readonly modelContext?: ModelContext;
  }
}
