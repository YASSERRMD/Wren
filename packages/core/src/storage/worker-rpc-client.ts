import { RpcError, type RpcRequest, type RpcResponse } from './rpc-protocol.js';

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/**
 * Main-thread side of the typed worker RPC bridge. Assigns an incrementing
 * request id to each call and resolves the matching pending promise when a
 * response carrying that id arrives.
 */
export class WorkerRpcClient {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();

  constructor(worker: Worker) {
    this.worker = worker;
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleError);
  }

  call<TParams, TResult>(method: string, params: TParams): Promise<TResult> {
    const id = this.nextId++;
    return new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      const request: RpcRequest = { id, method, params };
      this.worker.postMessage(request);
    });
  }

  terminate(): void {
    this.worker.removeEventListener('message', this.handleMessage);
    this.worker.removeEventListener('error', this.handleError);
    this.worker.terminate();
    this.rejectAllPending(new Error('Worker terminated with calls still pending'));
  }

  private readonly handleMessage = (event: MessageEvent<RpcResponse>): void => {
    const response = event.data;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.ok) {
      pending.resolve(response.result);
    } else {
      pending.reject(new RpcError(response.error.name, response.error.message));
    }
  };

  private readonly handleError = (event: ErrorEvent): void => {
    this.rejectAllPending(new Error(`Storage worker error: ${event.message}`));
  };

  private rejectAllPending(reason: unknown): void {
    for (const pending of this.pending.values()) {
      pending.reject(reason);
    }
    this.pending.clear();
  }
}
