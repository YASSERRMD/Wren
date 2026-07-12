import type { Wren, WrenResponse } from '@wren/core';
import { Wren as WrenClass } from '@wren/core';
import { EVAL_CASES, type EvalCase } from './cases.js';
import { captureEnvironment } from './environment.js';
import { FIXTURE_DOCUMENTS } from './fixtures/index.js';
import { EVAL_TOOLS } from './tools.js';
import { clearLog, log, onRunClick, setResultsHtml } from './ui.js';

interface CaseResult {
  evalCase: EvalCase;
  response: WrenResponse;
  routingCorrect: boolean;
}

async function ingestFixtures(wren: Wren): Promise<void> {
  for (const source of FIXTURE_DOCUMENTS) {
    const result = await wren.ingest(source);
    const warningNote = result?.warnings.length ? `, ${result.warnings.length} warning(s)` : '';
    log(`  ingested "${source.title}": ${result?.sectionCount ?? 0} sections${warningNote}`);
  }
}

function registerTools(wren: Wren): void {
  for (const tool of EVAL_TOOLS) {
    wren.registerTool(tool);
  }
}

async function runCases(wren: Wren): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const evalCase of EVAL_CASES) {
    const response = await wren.query(evalCase.query);
    const routingCorrect = response.action === evalCase.expectedAction;
    results.push({ evalCase, response, routingCorrect });
    log(`  [${evalCase.id}] expected=${evalCase.expectedAction} actual=${response.action} ${routingCorrect ? 'OK' : 'MISMATCH'}`);
  }
  return results;
}

function renderResultsTable(results: CaseResult[]): string {
  const rows = results
    .map(
      ({ evalCase, response, routingCorrect }) => `
      <tr style="background: ${routingCorrect ? '#eaffea' : '#ffecec'}">
        <td>${evalCase.id}</td>
        <td>${evalCase.category}</td>
        <td>${evalCase.query}</td>
        <td>${evalCase.expectedAction}</td>
        <td>${response.action}</td>
        <td>${response.hops}</td>
      </tr>`,
    )
    .join('');
  const passCount = results.filter((r) => r.routingCorrect).length;
  return `
    <p><strong>Routing: ${passCount}/${results.length} correct.</strong> Full metrics land in a later commit.</p>
    <table>
      <thead><tr><th>Case</th><th>Category</th><th>Query</th><th>Expected</th><th>Actual</th><th>Hops</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function run(): Promise<void> {
  clearLog();
  setResultsHtml('');

  const env = await captureEnvironment();
  log(`Chrome ${env.chromeVersion ?? 'unknown'}, Nano availability: ${env.nanoAvailability}`);

  const support = await WrenClass.isSupported();
  log(`Storage supported: ${support.storage}, WebMCP: ${support.webmcp}`);
  if (!support.storage) {
    log('This browser cannot run Wren (no OPFS/Worker support). Stopping.');
    return;
  }

  log('Creating Wren instance...');
  const wren = await WrenClass.create({ dbName: 'wren-evals.sqlite3' });

  log('Clearing any previously ingested documents...');
  await wren.clear();

  log(`Ingesting ${FIXTURE_DOCUMENTS.length} fixture documents...`);
  await ingestFixtures(wren);

  log(`Registering ${EVAL_TOOLS.length} tools...`);
  registerTools(wren);

  log(`Running ${EVAL_CASES.length} eval cases...`);
  const results = await runCases(wren);
  setResultsHtml(renderResultsTable(results));

  await wren.destroy();
  log('Done.');
}

onRunClick(run);
