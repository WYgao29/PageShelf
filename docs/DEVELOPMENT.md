# Development

PageShelf is an Electron desktop application. The production UI and library process communicate through a typed command bridge; the packaged application does not start a web server.

## Requirements

- macOS on Apple Silicon for the supported app package.
- Node.js 24 LTS (24.15+ within the 24.x line), or Node.js 26+.
- npm, with dependencies installed from the committed lockfile using `npm ci`.

## Run and build

```sh
npm ci
npm run dev
npm run build
npm run package:mac
```

The packaged application is written to `release/PageShelf-darwin-arm64/PageShelf.app`. Packaging uses macOS tools (`sips` and `iconutil`); it does not sign or notarize the result.

## Project structure

| Directory | Purpose |
| --- | --- |
| `src/` | Library indexing, metadata, search, file formats and cache |
| `shared/` | Command contracts, routes and shared parsing rules |
| `electron/` | Application windows, sandbox policy and library process |
| `src-ui/` | React UI, reading pipeline, themes, fonts and vendored libraries |
| `test/` | Library and desktop contract tests |
| `scripts/` | Builds, tests, packaging and documentation screenshots |
| `examples/library/` | Original sample articles for trying the application |
| `build/brand/` | PageShelf logos and app icons |

## Validation

```sh
npm test                    # Node tests, UI tests, production build and Electron E2E
npm test -- --unit          # Library and desktop contract tests
npm test -- --ui            # React and reader tests
npm test -- --electron      # Production build and real Electron E2E
npm run check              # Verify vendored library checksums
npm run benchmark:search   # Search benchmark
```

Tests create temporary sample files and isolated configurations. The Electron E2E test uses a restricted trash substitute for its own fixtures.

For a separate development library, set `HTML_LIBRARY_DATA_DIR` to an empty directory before running the application. The normal configuration is `~/.html-library/config.json`; production interface preferences are stored in Electron's PageShelf application-support directory.

## README screenshots

```sh
npm run build
node scripts/capture-readme.mjs
```

The capture script launches the real production app with a temporary library copied from `examples/library/`, then writes two banners and four screenshots into `docs/images/`. It never reads the normal library configuration. The screenshots show the current Chinese-language UI.

## Third-party notices

Font licenses are in `src-ui/assets/fonts/`. Browser-library provenance, versions, checksums and licenses are listed in [VENDOR.md](../src-ui/vendor/VENDOR.md). `scripts/build-notices.mjs` copies those notices and the bundled React, React DOM and Scheduler licenses into `dist/licenses/` for packaging. Electron's own notices remain in the app bundle.
