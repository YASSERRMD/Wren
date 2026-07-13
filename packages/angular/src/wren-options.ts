import { InjectionToken } from '@angular/core';
import type { WrenOptions } from '@wren/core';

/** Set via provideWren() or WrenModule.forRoot(); WrenService falls back to {} if nothing provides it. */
export const WREN_OPTIONS = new InjectionToken<WrenOptions>('WREN_OPTIONS');
