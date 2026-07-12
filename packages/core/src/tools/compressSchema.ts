import type { JsonSchema } from '../nano/validateSchema.js';
import type { WrenTool } from './WrenTool.js';

function compressType(schema: JsonSchema): string {
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join('|');
  if (schema.oneOf) return schema.oneOf.map(compressType).join('|');
  if (schema.type === 'array') return `${schema.items ? compressType(schema.items) : 'any'}[]`;
  return schema.type ?? 'any';
}

function compressArgs(schema: JsonSchema): string {
  if (schema.type !== 'object' || !schema.properties) return '';
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties)
    .map(([name, propSchema]) => `${name}${required.has(name) ? '' : '?'}: ${compressType(propSchema)}`)
    .join(', ');
}

/**
 * The minimal text representation of a tool for the routing prompt, not
 * the raw JSON Schema: full JSON Schema is verbose and Nano's context is
 * small. Emits `name(arg: type, arg?: type) - description`, with `?`
 * marking an argument absent from inputSchema.required.
 */
export function compressSchema(tool: Pick<WrenTool, 'name' | 'description' | 'inputSchema'>): string {
  return `${tool.name}(${compressArgs(tool.inputSchema)}) - ${tool.description}`;
}
