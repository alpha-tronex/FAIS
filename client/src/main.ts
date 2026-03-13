import 'zone.js';

// Polyfill for ng-bootstrap (and other libs that use $localize) when not using Angular i18n
if (typeof (globalThis as unknown as { $localize?: unknown }).$localize === 'undefined') {
  (globalThis as unknown as { $localize: (parts: TemplateStringsArray, ...exp: unknown[]) => string }).$localize =
    (parts: TemplateStringsArray, ...exp: unknown[]) =>
      parts.reduce((acc, part, i) => acc + part + (exp[i] ?? ''), '');
}

import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { AppModule } from './app/app.module';

platformBrowserDynamic()
  .bootstrapModule(AppModule)
  .catch((err) => console.error(err));
