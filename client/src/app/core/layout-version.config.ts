/**
 * Landing + demo-landing **page structure** only: reads `?v=` on those routes (see `LandingPage`
 * / `DemoLandingPage`). Integer >= 1; unknown values fall back to this default.
 *
 * - **v=1** — Original long-form landing (and demo landing v1 markup).
 * - **v=2** — Compact layout with utility bar (`landingV2` / `demoLandingV2`).
 * - **v=3** — Same markup as v=1, plus `landingV3` / `demoLandingV3` for styling hooks (e.g. Friendly Accounting variant).
 *
 * **Not** the same as global app theme: `environment.theme` in `app.ts` sets `html[data-theme]`
 * (`fais_default` | `style_fiori` | `style_fas`) for header, footer, forms, and the rest of the app.
 * Changing `v` does not change `data-theme` unless you wire that separately.
 */
export const DEFAULT_LAYOUT_VERSION = 2;
