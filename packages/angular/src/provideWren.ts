import { type EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import type { WrenOptions } from '@wren/core';
import { WREN_OPTIONS } from './wren-options.js';

/** For the standalone-component era: add to an application's (or a route's) providers array. */
export function provideWren(options: WrenOptions = {}): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: WREN_OPTIONS, useValue: options }]);
}
