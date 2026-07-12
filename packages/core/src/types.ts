/** How a document's original content was provided. Mirrors WrenSource's discriminant (Phase 5). */
export type WrenSourceType = 'text' | 'html' | 'dom' | 'markdown';

export interface WrenDocument {
  id: string;
  title: string;
  sourceType: WrenSourceType;
  createdAt: string;
  meta?: Record<string, unknown>;
}

/**
 * A node in a document's section tree. `label` is the short LLM-generated
 * or heuristic summary used for tree navigation, kept under 20 words. It is
 * what Nano sees during routing (Phase 10), so it is load-bearing: get this
 * wrong and retrieval fails no matter how good the rest of the system is.
 */
export interface WrenSection {
  id: string;
  docId: string;
  parentId: string | null;
  ordinal: number;
  depth: number;
  heading: string;
  content: string;
  label: string;
}

/** The in-memory navigable shape assembled from flat WrenSection rows. */
export interface WrenTreeNode {
  sectionId: string;
  heading: string;
  label: string;
  children: WrenTreeNode[];
}
