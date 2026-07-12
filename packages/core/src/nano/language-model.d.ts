/**
 * Ambient types for Chrome's Prompt API (`LanguageModel`). This is an
 * experimental, non-standardized API not shipped in TypeScript's DOM lib,
 * so Wren declares only the surface it actually uses.
 *
 * Verified against the current Prompt API explainer: availability() values
 * are 'unavailable' | 'downloadable' | 'downloading' | 'available' (an
 * earlier 'readily'/'after-download'/'no' naming is obsolete). Session
 * token accounting was renamed from inputQuota/inputUsage/
 * measureInputUsage to contextWindow/contextUsage/measureContextUsage;
 * both NanoDownloadMonitor properties are declared as optional so
 * NanoAdapter can feature-detect whichever a given Chrome build exposes.
 */
export type NanoAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

export interface LanguageModelDownloadProgressEvent {
  loaded: number;
}

export interface LanguageModelMonitor {
  addEventListener(
    type: 'downloadprogress',
    listener: (event: LanguageModelDownloadProgressEvent) => void,
  ): void;
}

export interface LanguageModelCreateOptions {
  initialPrompts?: unknown[];
  monitor?: (monitor: LanguageModelMonitor) => void;
  signal?: AbortSignal;
}

export interface LanguageModelPromptOptions {
  responseConstraint?: object;
  signal?: AbortSignal;
}

export interface LanguageModelCloneOptions {
  signal?: AbortSignal;
}

export interface LanguageModelSession {
  prompt(input: string, options?: LanguageModelPromptOptions): Promise<string>;
  promptStreaming?(input: string, options?: LanguageModelPromptOptions): AsyncIterable<string>;
  clone?(options?: LanguageModelCloneOptions): Promise<LanguageModelSession>;
  destroy(): void;
  measureContextUsage?(input: string): Promise<number>;
  measureInputUsage?(input: string): Promise<number>;
  readonly contextWindow?: number;
  readonly inputQuota?: number;
  readonly contextUsage?: number;
  readonly inputUsage?: number;
  addEventListener(type: 'contextoverflow', listener: () => void): void;
  removeEventListener(type: 'contextoverflow', listener: () => void): void;
}

export interface LanguageModelStatic {
  availability(options?: unknown): Promise<NanoAvailability>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
}

declare global {
  var LanguageModel: LanguageModelStatic | undefined;
}
