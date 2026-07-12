import type { JsonSchema } from '../nano/validateSchema.js';

export interface WrenToolResult {
  content: string;
  isError?: boolean;
}

export interface WrenTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  execute: (args: Record<string, unknown>) => Promise<WrenToolResult>;
}
