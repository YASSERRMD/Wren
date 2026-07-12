import { Wren } from '@wren/core';
import { captureEnvironment } from './environment.js';
import { FIXTURE_DOCUMENTS } from './fixtures/index.js';
import { clearLog, log, onRunClick, setResultsHtml } from './ui.js';

async function ingestFixtures(wren: Wren): Promise<void> {
  for (const source of FIXTURE_DOCUMENTS) {
    const result = await wren.ingest(source);
    const warningNote = result?.warnings.length ? `, ${result.warnings.length} warning(s)` : '';
    log(`  ingested "${source.title}": ${result?.sectionCount ?? 0} sections${warningNote}`);
  }
}

async function run(): Promise<void> {
  clearLog();
  setResultsHtml('');

  const env = await captureEnvironment();
  log(`Chrome ${env.chromeVersion ?? 'unknown'}, Nano availability: ${env.nanoAvailability}`);

  const support = await Wren.isSupported();
  log(`Storage supported: ${support.storage}, WebMCP: ${support.webmcp}`);
  if (!support.storage) {
    log('This browser cannot run Wren (no OPFS/Worker support). Stopping.');
    return;
  }

  log('Creating Wren instance...');
  const wren = await Wren.create({ dbName: 'wren-evals.sqlite3' });

  log('Clearing any previously ingested documents...');
  await wren.clear();

  log(`Ingesting ${FIXTURE_DOCUMENTS.length} fixture documents...`);
  await ingestFixtures(wren);

  const documents = await wren.listDocuments();
  setResultsHtml(`<p>${documents.length} documents ingested. Eval case running lands in a later commit.</p>`);

  await wren.destroy();
  log('Done.');
}

onRunClick(run);
