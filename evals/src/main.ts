import type { Wren } from '@wren/core';
import { Wren as WrenClass } from '@wren/core';
import { EVAL_CASES } from './cases.js';
import { captureEnvironment } from './environment.js';
import { FIXTURE_DOCUMENTS } from './fixtures/index.js';
import { errorOutcome, scoreCase, summarise, type CaseOutcome, type MetricsSummary } from './metrics.js';
import { buildReport, downloadReport } from './report.js';
import { runToolCountSweep, type SweepStep } from './sweep.js';
import { EVAL_TOOLS } from './tools.js';
import { clearLog, log, onRunClick, setResultsHtml, showDownloadButton } from './ui.js';

async function ingestFixtures(wren: Wren): Promise<number[]> {
  const durationsMs: number[] = [];
  for (const source of FIXTURE_DOCUMENTS) {
    const result = await wren.ingest(source);
    const warningNote = result?.warnings.length ? `, ${result.warnings.length} warning(s)` : '';
    log(`  ingested "${source.title}": ${result?.sectionCount ?? 0} sections${warningNote}`);
    if (result) durationsMs.push(result.durationMs);
  }
  return durationsMs;
}

function registerTools(wren: Wren): Array<() => void> {
  return EVAL_TOOLS.map((tool) => wren.registerTool(tool));
}

async function runCases(wren: Wren): Promise<CaseOutcome[]> {
  const outcomes: CaseOutcome[] = [];
  for (const evalCase of EVAL_CASES) {
    try {
      const response = await wren.query(evalCase.query);
      const outcome = scoreCase(evalCase, response);
      outcomes.push(outcome);
      log(`  [${evalCase.id}] expected=${evalCase.expectedAction} actual=${response.action} ${outcome.routingCorrect ? 'OK' : 'MISMATCH'}`);
    } catch (error) {
      const outcome = errorOutcome(evalCase, error);
      outcomes.push(outcome);
      log(`  [${evalCase.id}] expected=${evalCase.expectedAction} actual=ERROR: ${outcome.error}`);
    }
  }
  return outcomes;
}

function formatPercent(value: number): string {
  return Number.isNaN(value) ? 'n/a' : `${(value * 100).toFixed(0)}%`;
}

function renderSummary(summary: MetricsSummary): string {
  const categoryRows = Object.entries(summary.byCategory)
    .map(([category, { total, routingCorrect }]) => `<tr><td>${category}</td><td>${routingCorrect}/${total}</td></tr>`)
    .join('');
  const hopRows = Object.entries(summary.hopCounts)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([hops, count]) => `<tr><td>${hops}</td><td>${count}</td></tr>`)
    .join('');

  return `
    <h2>Summary</h2>
    <table>
      <tbody>
        <tr><td>Routing accuracy</td><td>${formatPercent(summary.routingAccuracy)} (${summary.totalCases} cases)</td></tr>
        <tr><td>Errors</td><td>${summary.errorCount}</td></tr>
        <tr><td>Retrieval accuracy</td><td>${formatPercent(summary.retrievalAccuracy)}</td></tr>
        <tr><td>Tool selection accuracy</td><td>${formatPercent(summary.toolSelectionAccuracy)}</td></tr>
        <tr><td>Budget truncation rate</td><td>${formatPercent(summary.budgetTruncationRate)}</td></tr>
        <tr><td>Query latency (p50 / p95)</td><td>${summary.queryLatency.p50.toFixed(0)}ms / ${summary.queryLatency.p95.toFixed(0)}ms</td></tr>
        <tr><td>Ingest latency (p50 / p95)</td><td>${summary.ingestLatency.p50.toFixed(0)}ms / ${summary.ingestLatency.p95.toFixed(0)}ms</td></tr>
      </tbody>
    </table>
    <h3>Routing by category</h3>
    <table><thead><tr><th>Category</th><th>Correct</th></tr></thead><tbody>${categoryRows}</tbody></table>
    <h3>Hop count distribution</h3>
    <table><thead><tr><th>Hops</th><th>Cases</th></tr></thead><tbody>${hopRows}</tbody></table>`;
}

function renderSweepTable(steps: SweepStep[]): string {
  const rows = steps
    .map(({ toolCount, casesRun, toolSelectionAccuracy }) => `<tr><td>${toolCount}</td><td>${casesRun}</td><td>${formatPercent(toolSelectionAccuracy)}</td></tr>`)
    .join('');
  return `
    <h3>Tool count sweep</h3>
    <p>Validates the recommended cap of 7 against this corpus: accuracy should hold steady up to the cap and may degrade past it.</p>
    <table><thead><tr><th>Tools registered</th><th>Cases run</th><th>Tool selection accuracy</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function formatOptionalBool(value: boolean | undefined): string {
  if (value === undefined) return 'n/a';
  return value ? 'yes' : 'no';
}

function renderCasesTable(outcomes: CaseOutcome[]): string {
  const rows = outcomes
    .map(({ evalCase, response, error, routingCorrect, retrievalCorrect, toolCorrect }) => `
      <tr style="background: ${error !== undefined ? '#fff4d6' : routingCorrect ? '#eaffea' : '#ffecec'}">
        <td>${evalCase.id}</td>
        <td>${evalCase.category}</td>
        <td>${evalCase.query}</td>
        <td>${evalCase.expectedAction}</td>
        <td>${error !== undefined ? `ERROR: ${error}` : response?.action}</td>
        <td>${response?.hops ?? 'n/a'}</td>
        <td>${formatOptionalBool(retrievalCorrect)}</td>
        <td>${formatOptionalBool(toolCorrect)}</td>
      </tr>`)
    .join('');
  return `
    <h3>Cases</h3>
    <table>
      <thead><tr><th>Case</th><th>Category</th><th>Query</th><th>Expected</th><th>Actual</th><th>Hops</th><th>Retrieval</th><th>Tool</th></tr></thead>
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
  const ingestDurationsMs = await ingestFixtures(wren);

  log(`Registering ${EVAL_TOOLS.length} tools...`);
  const unregisterFns = registerTools(wren);

  log(`Running ${EVAL_CASES.length} eval cases...`);
  const outcomes = await runCases(wren);
  const summary = summarise(outcomes, ingestDurationsMs);

  for (const unregister of unregisterFns) unregister();

  log('Running tool count sweep (3, 5, 7, 10 tools)...');
  const sweepSteps = await runToolCountSweep(wren, log);

  setResultsHtml(renderSummary(summary) + renderSweepTable(sweepSteps) + renderCasesTable(outcomes));

  const report = buildReport(env, summary, sweepSteps, outcomes);
  showDownloadButton(() => downloadReport(report));

  await wren.destroy();
  log('Done.');
}

onRunClick(run);
