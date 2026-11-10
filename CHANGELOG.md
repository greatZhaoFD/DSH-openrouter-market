# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-11-10

### Added

- A result toast in the top-right after **Import into DSH config** (and after a
  route probe), so a successful import no longer only appends a line at the
  bottom of a long list.
- A **Test route** button per model, backed by a new
  `GET /api/openrouter-models/probe?model=<id>` route: it sends a one-token
  request with the saved strategy and reports the provider that actually served
  it, plus the injected `provider` object. This makes it possible to confirm
  routing without reading OpenRouter's activity dashboard.
- A read-only **Configured** page, rendered from the DSH config file's models,
  the routing store and OpenRouter provider data: configured models with the
  provider order that will actually be used (`order` / `only` narrow it), and
  provider node details only — no catalogue controls, no routing editor.
- Clicking anywhere on a model row now expands its provider list; the model
  table has separate **Config** and **Routing** status columns (Configured /
  Not configured, Routed / Route), and every page opens with rows collapsed.

### Changed

- `routing.json` and `host-alive.json` are written with two-space indentation
  and a trailing newline, so saved routing policies can be read and diffed by
  hand. A minified file left behind by 0.2.0 is reformatted once when the plugin
  loads it. Cache files (`models.json`, `endpoints-*.json`) stay minified.
- `enableRouting` now defaults to `true`: strategies saved in the routing panel
  take effect immediately instead of requiring a profile override and a
  restart. Set `enableRouting: false` in a profile patch to skip the global
  `fetch` wrapper entirely.

### Fixed

- The code default for `enableRouting` disagreed with the shipped bundle patch
  (`false` in the patch, `true` in `DEFAULTS`); both now say `true`, matching the
  documented behaviour.

## [0.2.0] - 2026-11-10

### Added

- Official DSH plugin-bundle packaging: `package.json` now declares `dsh.bundle.patch`
  and `dsh.client` with complete display metadata (`icon`, `exports`, `files`,
  `repository`, `license`), so DSH's Plugin Manager, Plugins page and
  `dsh plugin add` can install the package directly.
- `index.json`: a format-1 DSH plugin market index, so the Discover tab can add
  this repository as an index source and install the plugin from the UI.
- `test/smoke.mjs`: zero-dependency consistency checks for the manifest, bundle
  patch, locales, built artifacts and plugin index.
- GitHub Actions: validation on every push/PR and a release workflow that pins
  the npm tarball to the pushed tag.

### Changed

- Installation no longer requires unpacking a release ZIP and pointing
  `install_bundle` at a directory: Git URL, plugin index entry, release tarball,
  local directory and (once published) npm all work.
- Version constants in `lib/index.js` / `lib/client.js` now report `0.2.0` and
  match `package.json`.
- `enableRouting` now defaults to `false` in code, matching the shipped bundle
  patch and the documented behaviour (request injection stays opt-in).
- Plugin storage and config-backup paths honour `$DSH_HOME` instead of always
  resolving `~/.dsh`, so relocated DSH homes work.
- Text files are normalized to LF through `.gitattributes`.

### Removed

- `"private": true` and the ZIP-only release assumption; the package is now
  npm-publishable (`publishConfig`, `files`, license) when desired.

## [0.1.1] - 2026-11-10

### Added

- First packaged release: OpenRouter model hub panel in Settings → Models,
  per-provider pricing/quantization view, routing policy store and import into
  the DSH OpenRouter model configuration.
