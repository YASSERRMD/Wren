import { describe, expect, it } from 'vitest';
import { compressSchema } from './compressSchema.js';

describe('compressSchema', () => {
  it('produces the minimal name(args) - description form', () => {
    const tool = {
      name: 'fill_field',
      description: 'Fills a form field with a value',
      inputSchema: {
        type: 'object' as const,
        required: ['field', 'value'],
        properties: {
          field: { type: 'string' as const },
          value: { type: 'string' as const },
          strict: { type: 'boolean' as const },
        },
      },
    };

    const compressed = compressSchema(tool);

    expect(compressed).toBe(
      'fill_field(field: string, value: string, strict?: boolean) - Fills a form field with a value',
    );
  });

  it('output is materially shorter than the raw schema', () => {
    // The saving comes from stripping JSON Schema's structural verbosity
    // (type keywords, braces, nesting), not from shortening the
    // description, which both forms carry verbatim: a schema-heavy,
    // description-light tool is what actually demonstrates that.
    const tool = {
      name: 'validate_section',
      description: 'Validates a section',
      inputSchema: {
        type: 'object' as const,
        required: ['sectionId'],
        properties: {
          sectionId: { type: 'string' as const },
          strict: { type: 'boolean' as const },
          mode: { type: 'string' as const, enum: ['fast', 'thorough'] },
        },
      },
    };

    const compressed = compressSchema(tool);
    const raw = JSON.stringify(tool);

    expect(compressed.length).toBeLessThan(raw.length * 0.6);
  });

  it('renders enum values as a literal union and array items as type[]', () => {
    const tool = {
      name: 'select_option',
      description: 'Selects an option',
      inputSchema: {
        type: 'object' as const,
        required: ['choice'],
        properties: {
          choice: { type: 'string' as const, enum: ['a', 'b', 'c'] },
          tags: { type: 'array' as const, items: { type: 'string' as const } },
        },
      },
    };

    expect(compressSchema(tool)).toBe('select_option(choice: "a"|"b"|"c", tags?: string[]) - Selects an option');
  });

  it('handles a tool with no arguments', () => {
    const tool = { name: 'refresh', description: 'Refreshes the view', inputSchema: { type: 'object' as const } };

    expect(compressSchema(tool)).toBe('refresh() - Refreshes the view');
  });
});
