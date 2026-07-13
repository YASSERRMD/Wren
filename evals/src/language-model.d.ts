/**
 * @wren/core deliberately does not export its own LanguageModel ambient
 * type (it is an internal implementation detail of NanoAdapter), so this
 * harness, which genuinely needs to know about the real browser API for
 * its own environment capture, declares the minimal slice it uses.
 */
type NanoAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

declare const LanguageModel:
  | {
      availability(): Promise<NanoAvailability>;
    }
  | undefined;
