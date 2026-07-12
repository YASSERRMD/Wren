import { WrenContextOverflowError, WrenNanoUnavailableError, WrenQuotaExceededError, WrenSchemaError } from './errors.js';
import type {
  LanguageModelCreateOptions,
  LanguageModelPromptOptions,
  LanguageModelSession,
  NanoAvailability,
} from './language-model.js';
import { matchesSchema, type JsonSchema } from './validateSchema.js';

export class NanoAdapter {
  private overflowed = false;
  private readonly onContextOverflow = (): void => {
    this.overflowed = true;
  };

  protected constructor(protected readonly session: LanguageModelSession) {
    this.session.addEventListener('contextoverflow', this.onContextOverflow);
  }

  static async availability(): Promise<NanoAvailability> {
    if (typeof LanguageModel === 'undefined') {
      return 'unavailable';
    }
    return LanguageModel.availability();
  }

  static async create(options: LanguageModelCreateOptions = {}): Promise<NanoAdapter> {
    if (typeof LanguageModel === 'undefined') {
      throw new WrenNanoUnavailableError('LanguageModel is not present in this browser');
    }
    const availability = await LanguageModel.availability();
    if (availability === 'unavailable') {
      throw new WrenNanoUnavailableError('availability() reported unavailable');
    }
    const session = await LanguageModel.create(options);
    return new NanoAdapter(session);
  }

  async prompt(input: string, opts: LanguageModelPromptOptions = {}): Promise<string> {
    if (this.overflowed) {
      throw new WrenContextOverflowError();
    }
    try {
      return await this.session.prompt(input, opts);
    } catch (error) {
      throw this.translateError(error);
    }
  }

  async promptStructured<T>(
    input: string,
    schema: JsonSchema,
    opts: LanguageModelPromptOptions = {},
  ): Promise<T> {
    const raw = await this.prompt(input, { ...opts, responseConstraint: schema as object });
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new WrenSchemaError(
        `Nano response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        raw,
      );
    }
    if (!matchesSchema(parsed, schema)) {
      throw new WrenSchemaError('Nano response did not match the expected schema', raw);
    }
    return parsed as T;
  }

  destroy(): void {
    this.session.removeEventListener('contextoverflow', this.onContextOverflow);
    this.session.destroy();
  }

  private translateError(error: unknown): unknown {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      const withProps = error as DOMException & { requested?: number; contextWindow?: number };
      return new WrenQuotaExceededError(withProps.requested, withProps.contextWindow);
    }
    return error;
  }
}
