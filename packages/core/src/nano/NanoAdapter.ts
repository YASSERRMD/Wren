import type { LanguageModelCreateOptions, LanguageModelSession, NanoAvailability } from './language-model.js';

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

  destroy(): void {
    this.session.destroy();
  }
}
