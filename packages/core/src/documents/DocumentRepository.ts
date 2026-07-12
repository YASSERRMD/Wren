import { hashContent } from '../labelling/contentHash.js';
import type { SqlEngine } from '../storage/migrations.js';
import type { WrenDocument, WrenSection, WrenSourceType, WrenTreeNode } from '../types.js';

/** Depth is a scope constraint, not a suggestion: more hops than this and Nano cannot navigate reliably. */
export const MAX_SECTION_DEPTH = 3;

export class SectionDepthError extends Error {
  constructor(sectionId: string, depth: number) {
    super(`Section "${sectionId}" has depth ${depth}, which exceeds the maximum of ${MAX_SECTION_DEPTH}`);
    this.name = 'SectionDepthError';
  }
}

interface DocumentRow {
  id: string;
  title: string;
  source_type: string;
  created_at: string;
  meta: string | null;
}

interface SectionRow {
  id: string;
  doc_id: string;
  parent_id: string | null;
  ordinal: number;
  depth: number;
  heading: string;
  content: string;
  label: string;
}

function rowToDocument(row: DocumentRow): WrenDocument {
  return {
    id: row.id,
    title: row.title,
    sourceType: row.source_type as WrenSourceType,
    createdAt: row.created_at,
    meta: row.meta ? (JSON.parse(row.meta) as Record<string, unknown>) : undefined,
  };
}

/**
 * Assembles a flat row list into a tree. Since a document may have more
 * than one top-level (parentless) section, this returns a synthetic root
 * node (`sectionId` equal to `docId`) whose children are the document's
 * actual top-level sections, rather than an array of roots.
 */
function assembleTree(docId: string, rootLabel: string, rows: readonly SectionRow[]): WrenTreeNode {
  const nodesById = new Map<string, WrenTreeNode>();
  for (const row of rows) {
    nodesById.set(row.id, { sectionId: row.id, heading: row.heading, label: row.label, children: [] });
  }

  const topLevel: WrenTreeNode[] = [];
  for (const row of rows) {
    const node = nodesById.get(row.id);
    if (!node) continue;
    const parent = row.parent_id ? nodesById.get(row.parent_id) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      topLevel.push(node);
    }
  }

  return { sectionId: docId, heading: rootLabel, label: rootLabel, children: topLevel };
}

export class DocumentRepository {
  constructor(private readonly engine: SqlEngine) {}

  async insertDocument(doc: WrenDocument): Promise<void> {
    await this.engine.exec(
      'INSERT INTO documents (id, title, source_type, created_at, meta) VALUES (?, ?, ?, ?, ?)',
      [doc.id, doc.title, doc.sourceType, doc.createdAt, doc.meta ? JSON.stringify(doc.meta) : null],
    );
  }

  /** Batched in a single transaction. Rejects the whole batch if any section exceeds MAX_SECTION_DEPTH. */
  async insertSections(sections: readonly WrenSection[]): Promise<void> {
    for (const section of sections) {
      if (section.depth > MAX_SECTION_DEPTH) {
        throw new SectionDepthError(section.id, section.depth);
      }
    }

    await this.engine.exec('BEGIN');
    try {
      for (const section of sections) {
        const contentHash = await hashContent(section.content);
        await this.engine.exec(
          `INSERT INTO sections (id, doc_id, parent_id, ordinal, depth, heading, content, label, content_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            section.id,
            section.docId,
            section.parentId,
            section.ordinal,
            section.depth,
            section.heading,
            section.content,
            section.label,
            contentHash,
          ],
        );
      }
      await this.engine.exec('COMMIT');
    } catch (error) {
      await this.engine.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Content-addressed label cache lookup: any section, past or present,
   * whose content hashes the same can donate its label. Requires
   * ADD_CONTENT_HASH_MIGRATION to have been applied.
   */
  async findCachedLabel(contentHash: string): Promise<string | undefined> {
    const rows = await this.engine.query<{ label: string }>(
      'SELECT label FROM sections WHERE content_hash = ? LIMIT 1',
      [contentHash],
    );
    return rows[0]?.label;
  }

  async getDocument(id: string): Promise<WrenDocument | undefined> {
    const rows = await this.engine.query<DocumentRow>('SELECT * FROM documents WHERE id = ?', [id]);
    return rows[0] ? rowToDocument(rows[0]) : undefined;
  }

  async listDocuments(): Promise<WrenDocument[]> {
    const rows = await this.engine.query<DocumentRow>('SELECT * FROM documents ORDER BY created_at');
    return rows.map(rowToDocument);
  }

  async getTree(docId: string): Promise<WrenTreeNode> {
    const doc = await this.getDocument(docId);
    const rows = await this.engine.query<SectionRow>(
      'SELECT * FROM sections WHERE doc_id = ? ORDER BY parent_id, ordinal',
      [docId],
    );
    return assembleTree(docId, doc?.title ?? docId, rows);
  }

  /** Cascades to sections and, via the sections table's own triggers, to the FTS index. */
  async deleteDocument(id: string): Promise<void> {
    await this.engine.exec('DELETE FROM documents WHERE id = ?', [id]);
  }
}
