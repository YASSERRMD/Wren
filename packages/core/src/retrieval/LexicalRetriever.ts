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

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'not', 'of', 'to', 'in', 'is', 'it', 'for',
  'on', 'with', 'as', 'this', 'that', 'be', 'are', 'was', 'were', 'at', 'by',
]);

/**
 * Kept deliberately dumb: drops stopwords, and nothing more. No stemming
 * beyond what the porter tokenizer already does, no synonym expansion.
 * Resist adding either.
 */
function tokenize(query: string): string[] {
  const terms = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return terms.filter((term) => !STOPWORDS.has(term));
}

/**
 * Rebuilds the query from tokenised, quoted terms rather than passing the
 * user's string into MATCH directly: this is what neutralises FTS5's
 * operator syntax (AND, OR, NOT, NEAR, *, ", column:filters) rather than
 * trying to escape it, since only alphanumeric characters survive
 * tokenisation and each surviving term is wrapped as a literal phrase. A
 * user typing NOT should not silently become a boolean operator.
 *
 * Terms are OR'd rather than AND'd: requiring every term to appear was too
 * restrictive once stopwords could no longer pad out an AND chain, and
 * bm25's own ranking already rewards rows matching more terms over rows
 * matching fewer, so OR does not mean "anything goes", just "don't
 * silently exclude a partial match".
 */
function buildMatchExpression(query: string): string | undefined {
  const terms = tokenize(query);
  if (terms.length === 0) return undefined;
  return terms.map((term) => `"${term}"`).join(' OR ');
}

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
    const matchExpr = buildMatchExpression(query);
    if (!matchExpr) return [];

    const limit = opts.limit ?? DEFAULT_LIMIT;
    const params: unknown[] = [matchExpr];
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
