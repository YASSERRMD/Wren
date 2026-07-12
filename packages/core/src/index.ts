export const WREN_CORE_VERSION = '0.0.0';

export { WrenStorage } from './storage/WrenStorage.js';
export type { Migration, SqlEngine } from './storage/migrations.js';
export {
  WrenStorageClosedError,
  WrenStorageError,
  WrenStorageUnsupportedError,
} from './storage/errors.js';
export { RpcError } from './storage/rpc-protocol.js';

