import type { WrenSection, WrenSourceType } from '../types.js';

export type WrenSource =
  | { type: 'text'; content: string; title: string }
  | { type: 'html'; content: string; title?: string }
  | { type: 'dom'; element: HTMLElement; title?: string }
  | { type: 'markdown'; content: string; title?: string };

export type ParseWarning =
  | { kind: 'depth-flattened'; sectionId: string; originalDepth: number }
  | { kind: 'section-split'; sectionId: string; partCount: number }
  | { kind: 'content-stripped'; reason: string };

export interface ParsedDocument {
  docId: string;
  title: string;
  sourceType: WrenSourceType;
  sections: WrenSection[];
  warnings: ParseWarning[];
}

export interface ParseOptions {
  /** Sized so a section plus prompt overhead fits comfortably under Nano's input quota. */
  maxSectionChars?: number;
}

export const DEFAULT_MAX_SECTION_CHARS = 2000;
