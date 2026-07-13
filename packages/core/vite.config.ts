import { defineConfig, type Plugin } from 'vite';
import dts from 'vite-plugin-dts';

/**
 * @sqlite.org/sqlite-wasm's dist/index.mjs bundles two things behind one
 * entry point: sqlite3InitModule (what Wren actually imports) and the
 * deprecated sqlite3Worker1Promiser helper, whose defaultConfig contains a
 * literal `new Worker(new URL("sqlite3-worker1.mjs", import.meta.url))`.
 * Wren never calls sqlite3Worker1Promiser (it hand-rolls its own RPC
 * bridge; see storage/worker-rpc-client.ts), but Vite's worker-detection
 * transform matches that `new Worker(new URL(...))` text via a raw-source
 * regex, independent of whether the containing function is ever called or
 * would be tree-shaken, and unconditionally emits the referenced worker as
 * its own ~1.3MB chunk. Verified by reading Vite 8.1.4's own
 * workerImportMetaUrlPlugin source (dist/node/chunks/node.js): its
 * transform hook is filtered purely by a regex match against each
 * module's raw text, which runs before Rollup's tree-shaking, so
 * reachability never enters into it.
 *
 * The fix: strip the dead code before that transform ever sees it. The
 * package's build emits the promiser as a single, cleanly delimited
 * `//#region src/bin/sqlite3-worker1-promiser.mjs` ... `//#endregion`
 * block (verified against @sqlite.org/sqlite-wasm@3.53.0-build1); replace
 * it with a throwing stub of the one identifier it still needs to leave
 * behind (sqlite3_worker1_promiser_default, referenced by the file's own
 * final export statement) so nothing else in the module needs to change.
 * Re-verify the region markers still match on every sqlite-wasm version
 * bump; this plugin does nothing (falls through) if they don't.
 */
function stripUnusedSqliteWorker1Promiser(): Plugin {
  const REGION_START = '//#region src/bin/sqlite3-worker1-promiser.mjs';
  const REGION_END = '//#endregion';
  const STUB =
    "const sqlite3_worker1_promiser_default = () => {\n" +
    "  throw new Error('sqlite3Worker1Promiser was stripped from this bundle (unused, deprecated API); see @wren/core\\'s vite.config.ts.');\n" +
    '};';

  return {
    name: 'wren:strip-unused-sqlite-worker1-promiser',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('@sqlite.org/sqlite-wasm')) return null;
      const start = code.indexOf(REGION_START);
      if (start === -1) return null;
      const end = code.indexOf(REGION_END, start);
      if (end === -1) return null;
      const regionEnd = end + REGION_END.length;
      return code.slice(0, start) + STUB + code.slice(regionEnd);
    },
  };
}

export default defineConfig({
  plugins: [dts({ rollupTypes: true })],
  // @sqlite.org/sqlite-wasm is a dependency of the storage worker
  // (storage/worker/storage.worker.ts, loaded via ?worker&inline), which
  // Vite bundles through a separate worker sub-build; that sub-build does
  // NOT inherit the top-level plugins array (verified empirically: a copy
  // of stripUnusedSqliteWorker1Promiser registered there never ran), so
  // Vite's own worker.plugins option is the documented place to register
  // a plugin that must apply to it.
  worker: {
    plugins: () => [stripUnusedSqliteWorker1Promiser()],
  },
  build: {
    target: 'es2022',
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'index',
    },
  },
  test: {
    environment: 'happy-dom',
    passWithNoTests: true,
  },
});
