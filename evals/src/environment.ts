export interface EvalEnvironment {
  userAgent: string;
  chromeVersion: string | undefined;
  nanoAvailability: string;
  timestamp: string;
}

function extractChromeVersion(userAgent: string): string | undefined {
  return /Chrome\/([\d.]+)/.exec(userAgent)?.[1];
}

/**
 * The Prompt API does not expose a model version string anywhere in its
 * current surface (only availability(), which is what gets recorded
 * here); Chrome's own version is the closest proxy for "which Nano
 * behavior am I looking at" and is what actually drifts on auto-update.
 */
export async function captureEnvironment(): Promise<EvalEnvironment> {
  const userAgent = navigator.userAgent;
  const nanoAvailability =
    typeof LanguageModel === 'undefined' ? 'unavailable (LanguageModel not present)' : await LanguageModel.availability();

  return {
    userAgent,
    chromeVersion: extractChromeVersion(userAgent),
    nanoAvailability,
    timestamp: new Date().toISOString(),
  };
}
