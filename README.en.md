# DSH-openrouter-market

English | [中文](README.md)

An official-format **DeepSeek Harness plugin bundle** that adds an **OpenRouter model hub** to DSH Settings → Models: browse the live OpenRouter catalogue with per-provider pricing, quantization and availability, save per-model routing strategies, and merge picked models into DSH's OpenRouter model configuration.

The repository ships the built bundle (`lib/index.js`, `lib/client.js`); there is no build step, so an install is immediately runnable.

## Compatibility

- Target runtime: DSH 0.2.x, using the official plugin-package model (`dsh.bundle.patch` + `dsh.client`); metadata and loading paths validated against DSH Desktop `0.2.2-rc.1` and `@deepseek-ai/dsh` CLI `0.2.0-rc.2`.
- Runtime dependencies: none. The Host half uses Node built-ins only; the Client half takes `react` from the page's module table.
- Node.js ≥ 20.18.0.

## Install

This package is a standard DSH bundle and can be installed through any official plugin channel. **Pick exactly one method**; do not install it twice (for example through the Plugins page *and* a hand-written row in a profile `cordis.patch.yml`).

### 1. Plugin index / Discover tab (recommended, GUI)

1. Open **Plugins** in the sidebar and switch on **Custom plugin indexes**.
2. In the **Discover** tab, add this index URL:

   ```text
   https://raw.githubusercontent.com/greatZhaoFD/DSH-openrouter-market/main/index.json
   ```

   (While the branch is unmerged use `.../feat/official-plugin-bundle/index.json`.)
3. Select **OpenRouter model hub** → **Install**.
4. Fully quit and restart DSH (Desktop must exit completely, tray icon included), then open it from the bottom of Settings → Models.

### 2. Command line (web or a custom profile)

```powershell
dsh plugin --profile web add https://github.com/greatZhaoFD/DSH-openrouter-market.git
```

A commit-pinned install also works:

```powershell
dsh plugin --profile web add "https://github.com/greatZhaoFD/DSH-openrouter-market.git#<commit>"
```

Restart afterwards: the Client bundle is loaded at process start.

> The Desktop `desktop` profile is managed exclusively by the Electron app, so the CLI cannot install into it; use method 1 or 3 on Desktop.

### 3. Desktop Plugins page

**Settings → Plugins → Install** and paste either:

- the repository: `https://github.com/greatZhaoFD/DSH-openrouter-market.git`
- the release tarball: `https://github.com/greatZhaoFD/DSH-openrouter-market/releases/download/v0.2.0/dsh-openrouter-market-0.2.0.tgz`

Then fully quit and restart DSH.

### 4. Local directory / packed tarball

```text
plugin_manager install_bundle(target="D:\\path\\to\\DSH-openrouter-market")
```

The plugin page's install field also accepts an absolute local path (directory, or a `.tgz` produced by `npm pack`).

### 5. npm (after publishing)

```powershell
dsh plugin --profile web add dsh-openrouter-market@0.2.0
```

`package.json` already carries `publishConfig`, `files` and the `dsh` manifest, so `npm publish` is the only missing step.

## Usage

- Expand **OpenRouter model hub** at the bottom of Settings → Models, then expand a model for provider price, quantization and availability. Refresh updates both the catalogue and any expanded provider data.
- The routing area stores hard constraints, strategy, performance preference and failover; **Save** writes the policy into plugin storage.
- **Import into DSH config** merges the selected models into the `llm-pi-ai` OpenRouter route. The import keeps only the `text` / `image` modalities DSH model configuration supports; the catalogue itself still shows OpenRouter's raw capability data.
- Request-time routing injection is off by default. Set the plugin's `enableRouting` config to `true` and restart to apply saved strategies to chat requests.

## Configuration

Defaults come from `cordis.patch.yml`; override the row with the same `id` in a profile `cordis.patch.yml` if needed (an override replaces the whole `config`, so write every field you need):

| Field | Default | Meaning |
| --- | --- | --- |
| `apiBaseUrl` | `https://openrouter.ai/api/v1` | OpenRouter API root (change only for a compatible proxy). |
| `apiKeyEnv` | `OPENROUTER_API_KEY` | Credential name DSH supplies; the key itself stays in DSH. |
| `modelsTtlMs` | `21600000` (6 h) | Model catalogue cache lifetime. |
| `endpointsTtlMs` | `900000` (15 min) | Provider/endpoint cache lifetime. |
| `timeoutMs` | `25000` | Per-request timeout against OpenRouter. |
| `enableRouting` | `false` | Inject saved routing strategies into chat requests (global `fetch` wrapper, fails safe). |

### Credentials

Configure the OpenRouter API key in DSH's provider settings (credential management) under the name matching `apiKeyEnv` (default `OPENROUTER_API_KEY`). The package contains the name only, never a key.

### Data locations

- Plugin storage: `$DSH_HOME/storages/openrouter-models/` (`routing.json`, boot marker `host-alive.json`, icon cache).
- Config backups: `$DSH_HOME/config_backups/openrouter-models/`.
- `$DSH_HOME` defaults to `~/.dsh`.

## Upgrade and uninstall

- GUI: update or remove the installed bundle on the Plugins page, then restart DSH.
- CLI:

  ```powershell
  dsh plugin --profile web remove dsh-openrouter-market
  ```

Disabling the plugin never edits unrelated profile configuration.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No entry at the bottom of Settings → Models | Is the bundle enabled, and did Desktop fully restart? The Client bundle loads at process start. |
| Empty model list or 401 | Is `OPENROUTER_API_KEY` present in DSH credentials with the same name as `apiKeyEnv`? |
| Is the Host half alive? | `$DSH_HOME/storages/openrouter-models/host-alive.json` (`stage` / `mounted`), or `http://127.0.0.1:<port>/api/openrouter-models/status`. |
| Apply saved strategies | Override `enableRouting` to `true`, then restart. |

## Development

The repository commits its built artifacts, so there is no build step. Validate consistency after edits:

```powershell
npm test            # zero-dependency smoke checks: manifest / patch / artifacts / plugin index
npm run pack:check  # inspect the npm tarball contents
```

Release: push a tag; GitHub Actions validates, runs `npm pack`, and attaches the `.tgz` to the Release.

## License

MIT — see [LICENSE](LICENSE).
