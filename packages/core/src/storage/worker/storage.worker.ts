import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { BindingSpec, Database, SAHPoolUtil, Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { serializeError, type RpcRequest, type RpcResponse } from '../rpc-protocol.js';

interface OpenParams {
  dbName: string;
}

interface ExecParams {
  sql: string;
  params?: unknown[];
}

interface QueryParams {
  sql: string;
  params?: unknown[];
}

let sqlite3: Sqlite3Static | undefined;
let poolUtil: SAHPoolUtil | undefined;
let db: Database | undefined;
let openFilename: string | undefined;

async function handleOpen(params: OpenParams): Promise<{ persisted: boolean }> {
  if (db) {
    throw new Error('Storage worker already has an open database');
  }
  sqlite3 ??= await sqlite3InitModule();
  poolUtil ??= await sqlite3.installOpfsSAHPoolVfs({ name: 'wren-opfs-sahpool' });
  const filename = `/${params.dbName}`;
  db = new poolUtil.OpfsSAHPoolDb(filename);
  openFilename = filename;
  return { persisted: true };
}

function requireDb(): Database {
  if (!db) {
    throw new Error('Storage worker has no open database. Call open() first.');
  }
  return db;
}

async function handleExec(params: ExecParams): Promise<void> {
  // The public WrenStorage.exec signature deliberately accepts unknown[] so
  // callers are not forced onto sqlite3's bindable value types; this cast is
  // the trust boundary where that loosening is paid back.
  requireDb().exec(params.sql, { bind: params.params as BindingSpec | undefined });
}

async function handleQuery(params: QueryParams): Promise<Record<string, unknown>[]> {
  return requireDb().exec(params.sql, {
    bind: params.params as BindingSpec | undefined,
    rowMode: 'object',
    returnValue: 'resultRows',
  });
}

async function handleClose(): Promise<void> {
  requireDb().close();
  db = undefined;
  openFilename = undefined;
}

async function handleDestroy(): Promise<void> {
  if (db) {
    db.close();
    db = undefined;
  }
  if (poolUtil && openFilename) {
    poolUtil.unlink(openFilename);
  }
  openFilename = undefined;
}

async function route(request: RpcRequest): Promise<unknown> {
  switch (request.method) {
    case 'open':
      return handleOpen(request.params as OpenParams);
    case 'exec':
      return handleExec(request.params as ExecParams);
    case 'query':
      return handleQuery(request.params as QueryParams);
    case 'close':
      return handleClose();
    case 'destroy':
      return handleDestroy();
    default:
      throw new Error(`Unknown storage rpc method: ${request.method}`);
  }
}

async function dispatch(request: RpcRequest): Promise<void> {
  try {
    const result = await route(request);
    const response: RpcResponse = { id: request.id, ok: true, result };
    self.postMessage(response);
  } catch (error) {
    const response: RpcResponse = { id: request.id, ok: false, error: serializeError(error) };
    self.postMessage(response);
  }
}

self.addEventListener('message', (event: MessageEvent<RpcRequest>) => {
  void dispatch(event.data);
});
