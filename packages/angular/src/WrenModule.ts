import { NgModule, type ModuleWithProviders } from '@angular/core';
import type { WrenOptions } from '@wren/core';
import { WREN_OPTIONS } from './wren-options.js';

/** For apps still on NgModules: `imports: [WrenModule.forRoot(options)]`. Equivalent to provideWren() for the standalone era. */
@NgModule({})
export class WrenModule {
  static forRoot(options: WrenOptions = {}): ModuleWithProviders<WrenModule> {
    return {
      ngModule: WrenModule,
      providers: [{ provide: WREN_OPTIONS, useValue: options }],
    };
  }
}
