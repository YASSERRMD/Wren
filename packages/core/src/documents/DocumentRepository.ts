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

function assertDepthOk(sections: readonly WrenSection[]): void {
  for (const section of sections) {
    if (section.depth > MAX_SECTION_DEPTH) {
      throw new SectionDepthError(section.id, section.depth);
    }
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

function rowToSection(row: SectionRow): WrenSection {
  return {
    id: row.id,
    docId: row.doc_id,
    parentId: row.parent_id,
    ordinal: row.ordinal,
    depth: row.depth,
    heading: row.heading,
    content: row.content,
    label: row.label,
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
    await this.insertDocumentRow(doc);
  }

  /** Batched in a single transaction. Rejects the whole batch if any section exceeds MAX_SECTION_DEPTH. */
  async insertSections(sections: readonly WrenSection[]): Promise<void> {
    assertDepthOk(sections);
    await this.engine.exec('BEGIN');
    try {
      for (const section of sections) {
        await this.insertSectionRow(section);
      }
      await this.engine.exec('COMMIT');
    } catch (error) {
      await this.engine.exec('ROLLBACK');
      throw error;
    }
  }

  /** The document and all of its sections in one transaction: both land, or neither does. */
  async insertDocumentAndSections(doc: WrenDocument, sections: readonly WrenSection[]): Promise<void> {
    assertDepthOk(sections);
    await this.engine.exec('BEGIN');
    try {
      await this.insertDocumentRow(doc);
      for (const section of sections) {
        await this.insertSectionRow(section);
      }
      await this.engine.exec('COMMIT');
    } catch (error) {
      await this.engine.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Rebuilds the FTS5 index from the current contents of `sections` via
   * the external-content table's documented 'rebuild' command, without
   * touching documents or sections themselves. Useful after a schema
   * migration. Rebuilds the whole index rather than filtering by document,
   * since FTS5's external-content rebuild does not support that; cheap
   * enough at Wren's target scale (small, page-scale corpora).
   */
  async rebuildFtsIndex(): Promise<void> {
    await this.engine.exec("INSERT INTO sections_fts(sections_fts) VALUES ('rebuild')");
  }

  private async insertDocumentRow(doc: WrenDocument): Promise<void> {
    await this.engine.exec(
      'INSERT INTO documents (id, title, source_type, created_at, meta) VALUES (?, ?, ?, ?, ?)',
      [doc.id, doc.title, doc.sourceType, doc.createdAt, doc.meta ? JSON.stringify(doc.meta) : null],
    );
  }

  private async insertSectionRow(section: WrenSection): Promise<void> {
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

  /**
   * Full sections (including content) by id, in no particular order. The
   * dispatcher (Phase 10) uses this for the answer step: candidates carry
   * only a snippet, never full content, so the chosen sections' full text
   * has to be fetched separately once a decision is made.
   */
  async getSections(ids: readonly string[]): Promise<WrenSection[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    const rows = await this.engine.query<SectionRow>(
      `SELECT * FROM sections WHERE id IN (${placeholders})`,
      [...ids],
    );
    return rows.map(rowToSection);
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
