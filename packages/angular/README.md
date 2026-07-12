# @wren/angular

Angular bindings for [`@wren/core`](../core/README.md): an injectable
service backed by signals and observables, plus a directive for
declarative tool registration.

## Install

```bash
npm install @wren/angular @wren/core
```

## Quickstart (standalone components)

```ts
import { bootstrapApplication } from '@angular/platform-browser';
import { provideWren } from '@wren/angular';

bootstrapApplication(AppComponent, {
  providers: [provideWren()],
});
```

## Quickstart (NgModule)

```ts
import { NgModule } from '@angular/core';
import { WrenModule } from '@wren/angular';

@NgModule({
  imports: [WrenModule.forRoot()],
})
export class AppModule {}
```

## Full example

```ts
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { WrenResponse } from '@wren/core';
import { WrenService, WrenToolDirective } from '@wren/angular';
import type { Observable } from 'rxjs';

@Component({
  selector: 'app-assistant',
  standalone: true,
  imports: [CommonModule, WrenToolDirective],
  template: `
    @if (wren.status() === 'initialising') {
      <p>Starting Wren...</p>
    } @else if (wren.status() === 'unsupported') {
      <p>This browser cannot run Wren.</p>
    } @else if (wren.status() === 'error') {
      <p>Wren failed to start: {{ wren.error()?.message }}</p>
    } @else {
      <!-- A declarative tool: registered while this element is on the page,
           unregistered automatically when it is removed. -->
      <div [wrenTool]="getCurrentTimeTool"></div>

      <button (click)="ask()">Ask</button>
      @if (response) {
        <p>{{ (response | async)?.answer }}</p>
      }
    }
  `,
})
export class AssistantComponent {
  readonly wren = inject(WrenService);
  response?: Observable<WrenResponse>;

  readonly getCurrentTimeTool = {
    name: 'get_current_time',
    description: 'Returns the current time as an ISO string.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ content: new Date().toISOString() }),
  };

  ask(): void {
    this.response = this.wren.query('what time is it?');
  }
}
```

## API

- **`WrenService`**: `providedIn: 'root'`, creates one `Wren` instance for
  the app and destroys it when the service is destroyed.
  - `status`, `error`, `documents`, `ingestProgress`: signals. Read them
    directly in a template, no subscription needed.
  - `registerTool(tool)`: registers for the caller's lifetime; safe to
    call before Wren finishes initialising, the service queues it.
  - `ingest(source, opts?)`, `refreshDocuments()`, `deleteDocument(id)`:
    promise-returning actions that update the signals above.
  - `query(text)` / `queryStreaming(text)`: `Observable<WrenResponse>` /
    `Observable<Partial<WrenResponse>>`. Unsubscribing cancels the query
    through Wren's own `AbortSignal`, so `takeUntil`, the `async` pipe's
    own unsubscribe on destroy, or a manual `Subscription.unsubscribe()`
    all cancel cleanly.
- **`provideWren(options?)`**: for `bootstrapApplication` or a route's
  providers.
- **`WrenModule.forRoot(options?)`**: the same configuration for apps
  still on NgModules.
- **`WrenToolDirective`** (`[wrenTool]`): registers its bound tool in
  `ngOnInit`, unregisters in `ngOnDestroy`, re-registers if the bound
  tool object changes. If the tool needs to change after the initial
  render, bind it to a signal (`[wrenTool]="myTool()"`) rather than
  reassigning a plain property: in a zoneless app, a plain property
  mutation with nothing else marking the view dirty is not guaranteed
  to reach `ngOnChanges` at all, since zoneless change detection only
  rechecks what it knows changed.

## Signals, observables, and zone.js

`status`, `documents`, and `ingestProgress` are signals because they are
values a template reads directly. `query` and `queryStreaming` are
observables because they are streams with a cancellation contract
(unsubscribe) that RxJS already models well; forcing them through
signals would lose that.

Every asynchronous continuation inside `WrenService` that updates a
signal or emits on an observable re-enters the Angular zone explicitly
(`NgZone.run()`) before doing so. Signals and the `async` pipe already
propagate correctly in Angular's own zoneless scheduler, and in a
zone-based app most of Wren's async work (native `Promise` chains) is
zone-patched automatically too; the explicit re-entry is defensive
insurance against the one case that is not reliably patched everywhere,
a Web Worker's `postMessage` round trip, which is exactly how
`@wren/core` talks to its own storage. Verified against a zoneless
configuration and a zone-based one (`provideZoneChangeDetection()`,
`zone.js` loaded) with `ChangeDetectionStrategy.OnPush` components,
`fixture.autoDetectChanges()`, and no manual `detectChanges()` calls
after the initial render.
