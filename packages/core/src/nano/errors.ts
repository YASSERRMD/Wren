export class WrenNanoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WrenNanoError';
  }
}

/** Thrown when LanguageModel.availability() is 'unavailable', or LanguageModel does not exist at all. */
export class WrenNanoUnavailableError extends WrenNanoError {
  constructor(reason: string) {
    super(`Gemini Nano is unavailable: ${reason}`);
    this.name = 'WrenNanoUnavailableError';
  }
}

/** Wraps the Prompt API's QuotaExceededError. */
export class WrenQuotaExceededError extends WrenNanoError {
  readonly requested?: number;
  readonly contextWindow?: number;

  constructor(requested?: number, contextWindow?: number) {
    super(
      requested !== undefined && contextWindow !== undefined
        ? `Prompt needs ${requested} tokens but only ${contextWindow} are available`
        : 'Prompt exceeded the available quota',
    );
    this.name = 'WrenQuotaExceededError';
    this.requested = requested;
    this.contextWindow = contextWindow;
  }
}

/** Wired to the session's 'contextoverflow' event. */
export class WrenContextOverflowError extends WrenNanoError {
  constructor() {
    super('Nano session context overflowed');
    this.name = 'WrenContextOverflowError';
  }
}

/** Thrown by promptStructured() when the response fails to parse as JSON or fails schema validation. */
export class WrenSchemaError extends WrenNanoError {
  readonly rawResponse: string;

  constructor(message: string, rawResponse: string) {
    super(message);
    this.name = 'WrenSchemaError';
    this.rawResponse = rawResponse;
  }
}
