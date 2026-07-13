import { Directive, Input, inject, type OnChanges, type OnDestroy, type OnInit, type SimpleChanges } from '@angular/core';
import type { WrenTool } from '@wren/core';
import { WrenService } from './WrenService.js';

/**
 * The Angular analogue of React's useTool: registers `[wrenTool]` for the
 * lifetime of its host element, unregisters on destroy, and re-registers
 * if the bound tool changes. Safe to use before WrenService finishes
 * initialising; WrenService itself queues the registration until ready.
 */
@Directive({ selector: '[wrenTool]' })
export class WrenToolDirective implements OnInit, OnChanges, OnDestroy {
  @Input({ required: true }) wrenTool!: WrenTool;

  private readonly wren = inject(WrenService);
  private unregister: (() => void) | undefined;

  ngOnInit(): void {
    this.register();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['wrenTool'] && !changes['wrenTool'].firstChange) {
      this.unregister?.();
      this.register();
    }
  }

  ngOnDestroy(): void {
    this.unregister?.();
  }

  private register(): void {
    this.unregister = this.wren.registerTool(this.wrenTool);
  }
}
