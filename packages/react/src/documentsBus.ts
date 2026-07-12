import type { Wren } from '@wren/core';

/**
 * useIngest and useDocuments are independent hooks with no shared state
 * by default; this lets an ingest (or a delete made through useDocuments)
 * in one component tell every useDocuments instance watching the same
 * Wren to refetch, without adding a change-notification concept to
 * @wren/core itself. Keyed by Wren instance so unrelated providers (in
 * tests, or a page with more than one) never cross-notify.
 */
const listenersByWren = new WeakMap<Wren, Set<() => void>>();

export function subscribeToDocumentChanges(wren: Wren, listener: () => void): () => void {
  let listeners = listenersByWren.get(wren);
  if (!listeners) {
    listeners = new Set();
    listenersByWren.set(wren, listeners);
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyDocumentsChanged(wren: Wren): void {
  listenersByWren.get(wren)?.forEach((listener) => listener());
}
