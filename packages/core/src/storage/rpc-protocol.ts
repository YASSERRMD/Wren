/**
 * Wire protocol between {@link WorkerRpcClient} on the main thread and the
 * storage worker. Deliberately free of DOM or WebWorker lib globals so this
 * module type-checks identically from either side of the boundary.
 */
export interface RpcRequest {
  id: number;
  method: string;
  params: unknown;
}

export interface RpcSuccess {
  id: number;
  ok: true;
  result: unknown;
}

export interface RpcFailure {
  id: number;
  ok: false;
  error: {
    name: string;
    message: string;
  };
}

export type RpcResponse = RpcSuccess | RpcFailure;

/** Thrown on the main thread when a worker call rejects. */
export class RpcError extends Error {
  readonly remoteName: string;

  constructor(remoteName: string, message: string) {
    super(message);
    this.name = 'RpcError';
    this.remoteName = remoteName;
  }
}

export function serializeError(error: unknown): RpcFailure['error'] {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: 'Error', message: String(error) };
}
