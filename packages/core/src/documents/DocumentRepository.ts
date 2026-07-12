import type { SqlEngine } from '../storage/migrations.js';
import type { WrenDocument, WrenSection, WrenSourceType } from '../types.js';

interface DocumentRow {
  id: string;
  title: string;
  source_type: string;
  created_at: string;
  meta: string | null;
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

export class DocumentRepository {
  constructor(private readonly engine: SqlEngine) {}

  async insertDocument(doc: WrenDocument): Promise<void> {
    await this.engine.exec(
      'INSERT INTO documents (id, title, source_type, created_at, meta) VALUES (?, ?, ?, ?, ?)',
      [doc.id, doc.title, doc.sourceType, doc.createdAt, doc.meta ? JSON.stringify(doc.meta) : null],
    );
  }

  /** Batched in a single transaction. */
  async insertSections(sections: readonly WrenSection[]): Promise<void> {
    await this.engine.exec('BEGIN');
    try {
      for (const section of sections) {
        await this.engine.exec(
          `INSERT INTO sections (id, doc_id, parent_id, ordinal, depth, heading, content, label)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            section.id,
            section.docId,
            section.parentId,
            section.ordinal,
            section.depth,
            section.heading,
            section.content,
            section.label,
          ],
        );
      }
      await this.engine.exec('COMMIT');
    } catch (error) {
      await this.engine.exec('ROLLBACK');
      throw error;
    }
  }

  async getDocument(id: string): Promise<WrenDocument | undefined> {
    const rows = await this.engine.query<DocumentRow>('SELECT * FROM documents WHERE id = ?', [id]);
    return rows[0] ? rowToDocument(rows[0]) : undefined;
  }

  async listDocuments(): Promise<WrenDocument[]> {
    const rows = await this.engine.query<DocumentRow>('SELECT * FROM documents ORDER BY created_at');
    return rows.map(rowToDocument);
  }

  /** Cascades to sections and, via the sections table's own triggers, to the FTS index. */
  async deleteDocument(id: string): Promise<void> {
    await this.engine.exec('DELETE FROM documents WHERE id = ?', [id]);
  }
}
