/**
 * A minimal JSON Schema subset covering what Wren actually asks Nano to
 * produce: typed objects and arrays, required properties, enums, and
 * oneOf discriminated unions. Not a general-purpose validator. This exists
 * as a safety net, not the primary guarantee of correctness: Nano's
 * responseConstraint already constrains generation to the schema, so this
 * mainly catches an older or buggy Chrome build silently ignoring the
 * constraint rather than enforcing it.
 */
export interface JsonSchema {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';
  enum?: readonly unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  oneOf?: readonly JsonSchema[];
}

function matchesType(value: unknown, type: NonNullable<JsonSchema['type']>): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
  }
}

export function matchesSchema(value: unknown, schema: JsonSchema): boolean {
  if (schema.oneOf) {
    return schema.oneOf.filter((sub) => matchesSchema(value, sub)).length === 1;
  }
  if (schema.const !== undefined) {
    return value === schema.const;
  }
  if (schema.enum) {
    return schema.enum.includes(value);
  }
  if (schema.type && !matchesType(value, schema.type)) {
    return false;
  }
  if (schema.type === 'object') {
    const obj = value as Record<string, unknown>;
    if (schema.required?.some((key) => !(key in obj))) {
      return false;
    }
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in obj && !matchesSchema(obj[key], propSchema)) {
          return false;
        }
      }
    }
  }
  if (schema.type === 'array') {
    const arr = value as unknown[];
    if (schema.minItems !== undefined && arr.length < schema.minItems) return false;
    if (schema.maxItems !== undefined && arr.length > schema.maxItems) return false;
    if (schema.items) {
      return arr.every((item) => matchesSchema(item, schema.items as JsonSchema));
    }
  }
  return true;
}
