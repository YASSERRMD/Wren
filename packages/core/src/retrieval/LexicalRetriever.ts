import type { SqlEngine } from '../storage/migrations.js';

export interface Candidate {
  sectionId: string;
  docId: string;
  heading: string;
  label: string;
  score: number;
  snippet: string;
}

export interface LexicalSearchOptions {
  limit?: number;
  docIds?: string[];
  minScore?: number;
}

const DEFAULT_LIMIT = 8;
/** heading and label columns weighted above content: a match in the label is a stronger signal than one deep in body text. */
const BM25_WEIGHTS = '3.0, 1.0, 3.0';

interface SectionRow {
  id: string;
  doc_id: string;
  parent_id: string | null;
  heading: string;
  content: string;
  label: string;
}

/** The BM25 prefilter: cheap, no LLM, and does most of the actual retrieval work. */
export class LexicalRetriever {
  constructor(private readonly engine: SqlEngine) {}

  async search(query: string, opts: LexicalSearchOptions = {}): Promise<Candidate[]> {
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const params: unknown[] = [query];
    let docFilter = '';
    if (opts.docIds && opts.docIds.length > 0) {
      docFilter = `AND s.doc_id IN (${opts.docIds.map(() => '?').join(', ')})`;
      params.push(...opts.docIds);
    }
    params.push(limit);

    interface Row extends SectionRow {
      score: number;
      snippet: string;
    }

    const rows = await this.engine.query<Row>(
      `SELECT
         s.id AS id,
         s.doc_id AS doc_id,
         s.parent_id AS parent_id,
         s.heading AS heading,
         s.content AS content,
         s.label AS label,
         -bm25(sections_fts, ${BM25_WEIGHTS}) AS score,
         snippet(sections_fts, -1, '', '', '...', 20) AS snippet
       FROM sections_fts
       JOIN sections s ON s.rowid = sections_fts.rowid
       WHERE sections_fts MATCH ?
       ${docFilter}
       ORDER BY bm25(sections_fts, ${BM25_WEIGHTS}) ASC
       LIMIT ?`,
      params,
    );

    return rows
      .filter((row) => opts.minScore === undefined || row.score >= opts.minScore)
      .map((row) => ({
        sectionId: row.id,
        docId: row.doc_id,
        heading: row.heading,
        label: row.label,
        score: row.score,
        snippet: row.snippet,
      }));
  }
}
