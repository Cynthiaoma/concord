# Supported dashboard browsers

Concord's web app targets **modern evergreen browsers** with ES2023 support. The maintained target is the **current and preceding major stable version** of each family below, subject to testing; this is a *support policy*, not a claim of full test coverage for every browser release.

| Browser family | Desktop | Mobile | Notes |
| --- | --- | --- | --- |
| Chrome / Chromium | Current + preceding stable major | Android Chrome current + preceding | Primary Chromium engine |
| Microsoft Edge | Current + preceding stable major | Edge mobile current + preceding | Chromium on desktop |
| Firefox | Current + preceding stable major | Firefox Android current + preceding | Test HTML date inputs on your device |
| Safari | Current + preceding stable major | iOS/iPadOS Safari current + preceding | System-controlled picker and WebKit variations |

We set `build.target = "es2023"` in `apps/web/vite.config.ts` for an explicit modern JavaScript baseline. This controls Vite/esbuild output transforms; it does **not** polyfill missing web platform APIs, guarantee that an older engine implements every ES2023 feature, or substitute for manual/browser automation verification. Older browser versions are best-effort; Internet Explorer and pre-evergreen browsers are not supported.

## Browser features and fallbacks

- **`input[type="datetime-local"]`:** Used for time-selection fields. The native picker is browser- and OS-specific. Where supported but lacking a popup picker, users can type a correctly formatted local date/time; validate the UTC conversion in the resulting export/holdings request. If the control itself is unsupported, native text-field behavior differs and is not an officially supported fallback.
- **`navigator.clipboard`:** Copy controls require a secure context (`https://` or a trusted local development origin such as `http://localhost`) and may also require a gesture/permission. On untrusted HTTP hosts, copy may be unavailable; select and copy the visible text manually instead. Do not serve a production installation over HTTP.
- **CSS `color-scheme` and `prefers-color-scheme`:** Native controls and semantic token variables adapt to the OS preference in `apps/web/src/index.css`. There is no manual in-app theme switch; verify contrast in both modes.
- **`Intl` timezone names and date rendering:** Timezone labels and date/time UI reflect the browser's locale/zone, and support varies by environment. Time-specific API requests must be checked for correct UTC conversion; do not assume all users share the same local zone.
- **`crypto.subtle`:** Under consideration for future cryptographic browser features, **not** an existing dependency of the dashboard flow. Any future use must check secure context and feature availability and add tests before the support policy is changed.

## Contributor verification

For UI changes, smoke-test desktop Chromium **and** Firefox or Safari, including sign-in, the date/time inputs, copy actions, light/dark appearance, and the browser console. Run `pnpm --filter @concord/web typecheck`, `pnpm --filter @concord/web test`, and the Playwright browser checks when available. Report exactly what you tested in the PR; don't mark mobile Safari as tested based on a desktop Chromium pass.

See the [local web contributor guide](contributing/web-dev.md) for ports, demo data, and a step-by-step browser checklist.
