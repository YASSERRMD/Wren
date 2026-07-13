import type { JsonSchema } from '../nano/validateSchema.js';

export interface Citation {
  sectionId: string;
  heading: string;
  snippet: string;
}

export type WrenWarning =
  | { kind: 'budget-truncated'; detail: string }
  | { kind: 'hop-cap-forced'; detail: string }
  | { kind: 'decision-id-mismatch'; detail: string };

export interface WrenResponse {
  answer: string;
  citations: Citation[];
  action: 'answer' | 'tool' | 'none';
  toolCall?: { name: string; args: Record<string, unknown>; result: string; isError?: boolean };
  hops: number;
  durationMs: number;
  warnings: WrenWarning[];
}

export type DispatcherDecision =
  | { action: 'answer'; sectionIds: string[] }
  | { action: 'tool'; tool: string; args: Record<string, unknown> }
  | { action: 'navigate'; sectionId: string }
  | { action: 'none'; reason: string };

/**
 * A discriminated union, matched via the const-tagged `action` field on
 * each branch: exactly one branch's shape (including required keys) can
 * match a given decision object, which is what lets Nano's structured
 * output be trusted to mean one specific action rather than a loose bag
 * of optional fields.
 */
export const DECISION_SCHEMA: JsonSchema = {
  oneOf: [
    {
      type: 'object',
      required: ['action', 'sectionIds'],
      properties: {
        action: { const: 'answer' },
        sectionIds: { type: 'array', items: { type: 'string' } },
      },
    },
    {
      type: 'object',
      required: ['action', 'tool', 'args'],
      properties: {
        action: { const: 'tool' },
        tool: { type: 'string' },
        args: { type: 'object' },
      },
    },
    {
      type: 'object',
      required: ['action', 'sectionId'],
      properties: {
        action: { const: 'navigate' },
        sectionId: { type: 'string' },
      },
    },
    {
      type: 'object',
      required: ['action', 'reason'],
      properties: {
        action: { const: 'none' },
        reason: { type: 'string' },
      },
    },
  ],
};
