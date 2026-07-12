import type {
  LanguageModelCreateOptions,
  LanguageModelPromptOptions,
  LanguageModelSession,
  NanoAvailability,
} from './language-model.js';
import { matchesSchema, type JsonSchema } from './validateSchema.js';

export class NanoAdapter {
  protected constructor(protected readonly session: LanguageModelSession) {}

  static async availability(): Promise<NanoAvailability> {
    if (typeof LanguageModel === 'undefined') {
      return 'unavailable';
    }
    return LanguageModel.availability();
  }

  static async create(options: LanguageModelCreateOptions = {}): Promise<NanoAdapter> {
    if (typeof LanguageModel === 'undefined') {
      throw new Error('LanguageModel is not present in this browser');
    }
    const session = await LanguageModel.create(options);
    return new NanoAdapter(session);
  }

  async prompt(input: string, opts: LanguageModelPromptOptions = {}): Promise<string> {
    return this.session.prompt(input, opts);
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
      throw new Error(
        `Nano response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!matchesSchema(parsed, schema)) {
      throw new Error('Nano response did not match the expected schema');
    }
    return parsed as T;
  }

  destroy(): void {
    this.session.destroy();
  }
}
