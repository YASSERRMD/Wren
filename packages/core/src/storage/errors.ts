export class WrenStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WrenStorageError';
  }
}

/**
 * Thrown by {@link WrenStorage.open} when the current environment cannot
 * support OPFS-backed SQLite storage. See {@link WrenStorage.isSupported}.
 */
export class WrenStorageUnsupportedError extends WrenStorageError {
  constructor(reason: string) {
    super(`WrenStorage is not supported in this environment: ${reason}`);
    this.name = 'WrenStorageUnsupportedError';
  }
}

/** Thrown when a storage method is called after `close()` or `destroy()`. */
export class WrenStorageClosedError extends WrenStorageError {
  constructor(dbName: string) {
    super(`WrenStorage for "${dbName}" is closed`);
    this.name = 'WrenStorageClosedError';
  }
}
