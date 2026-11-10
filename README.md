# DSH-openrouter-market

[English](README.en.md) | 中文

在 DeepSeek Harness 的「设置 → Models」页底部提供「OpenRouter 模型库」：浏览 OpenRouter 实时模型目录与各家 Provider 的价格 / 量化 / 可用性，保存分模型路由策略，并把勾选的模型合并进 DSH 的 OpenRouter 模型配置。

本仓库同时是插件的发布仓库：仓库包含的是已构建产物，没有构建步骤，安装后即可运行。

## 兼容性

- 目标运行时：DSH 0.2.x（`dsh.bundle` + `dsh.client` 官方插件包模型；在 DSH Desktop `0.2.2-rc.1`、`@deepseek-ai/dsh` CLI `0.2.0-rc.2` 上校验元数据与加载路径）。
- 运行时依赖：无。Host 侧只用 Node 内置模块，Client 侧只从页面模块表取 `react`。
- Node.js ≥ 20.18.0。

## 安装

本插件是标准 DSH 插件包（`package.json` 声明 `dsh.bundle.patch` 与 `dsh.client`），支持 DSH 官方插件安装通道。**任选一种方式，不要重复安装**（例如既用插件页安装、又在 profile 的 `cordis.patch.yml` 里手动插一份）。

### 方式 1：插件索引 / 发现页（推荐，图形界面）

1. 侧边栏 **插件** 页 → 打开实验性功能中的 **自定义插件索引**（Custom plugin indexes）。
2. 切到 **发现**（Discover）标签页，添加索引地址：

   ```text
   https://raw.githubusercontent.com/greatZhaoFD/DSH-openrouter-market/main/index.json
   ```

   （当前分支尚未合并时，可用分支地址 `.../feat/official-plugin-bundle/index.json` 先行测试。）
3. 在列表中选择 **OpenRouter 模型库** → **安装**。
4. 完全退出并重新启动 DSH（桌面端必须完全退出，含托盘图标），然后到「设置 → Models」底部打开它。

### 方式 2：命令行安装（web 或自定义 profile）

```powershell
dsh plugin --profile web add https://github.com/greatZhaoFD/DSH-openrouter-market.git
```

也可以使用精确版本（Git 提交）：

```powershell
dsh plugin --profile web add "https://github.com/greatZhaoFD/DSH-openrouter-market.git#<commit>"
```

安装后按提示重启（Client 侧代码需要重启进程才会加载）。

> 桌面端（`desktop` profile）由 Electron 应用独占管理，CLI 无法为它安装插件；桌面端请用方式 1 或方式 3。

### 方式 3：桌面端插件页

**设置 → 插件** → 安装 → 粘贴以下任一地址：

- GitHub 仓库：`https://github.com/greatZhaoFD/DSH-openrouter-market.git`
- 发布包（Releases 中的 `.tgz`）：`https://github.com/greatZhaoFD/DSH-openrouter-market/releases/download/v0.2.0/dsh-openrouter-market-0.2.0.tgz`

安装完成后完全退出并重启 DSH。

### 方式 4：本地目录 / 本地发布包

```text
plugin_manager install_bundle(target="D:\\path\\to\\DSH-openrouter-market")
```

或在插件页的安装框里填本地绝对路径（目录，或 `npm pack` 生成的 `.tgz` 绝对路径）。

### 方式 5：npm（发布之后）

```powershell
dsh plugin --profile web add dsh-openrouter-market@0.2.0
```

`package.json` 已带 `publishConfig`、`files` 与 `dsh` 字段，`npm publish` 后即可用这条路径。

## 使用

- 「设置 → Models」底部的 **OpenRouter 模型库** 条目展开模型列表；展开单个模型可查看 Provider 价格、量化和可用性。刷新会同时更新模型目录和已展开的 Provider 数据。
- 路由区可设置硬约束、选择策略、性能偏好与故障转移，点 **保存** 后写入插件存储。
- 点 **导入到 DSH 配置** 把所选模型合并进 `llm-pi-ai` 的 OpenRouter 路由；导入只保留 DSH 模型配置支持的 `text` / `image` 模态，模型库本身仍展示 OpenRouter 的原始能力数据。
- 运行时路由注入默认关闭。要在聊天请求里应用已保存的策略，把插件配置的 `enableRouting` 改为 `true` 后重启 DSH。

## 配置

插件配置由 `cordis.patch.yml` 的默认值提供，可在 profile 的 `cordis.patch.yml` 里用同 `id` 覆盖（**覆盖会替换整个 `config`**，请把需要的字段都写全）：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `apiBaseUrl` | `https://openrouter.ai/api/v1` | OpenRouter API 根地址，仅兼容代理时才改。 |
| `apiKeyEnv` | `OPENROUTER_API_KEY` | DSH 凭据名；密钥本身由 DSH 凭据管理保存，插件只读这个名称。 |
| `modelsTtlMs` | `21600000`（6 小时） | 模型目录缓存时长。 |
| `endpointsTtlMs` | `900000`（15 分钟） | Provider / 端点数据缓存时长。 |
| `timeoutMs` | `25000` | 单次 OpenRouter 请求超时。 |
| `enableRouting` | `false` | 是否把已保存的路由策略注入聊天请求（全局 `fetch` 包装，失败自动回退）。 |

### 凭据

在 DSH 的 OpenRouter Provider 配置里填写 API Key（凭据管理），并让凭据名与 `apiKeyEnv` 一致，默认 `OPENROUTER_API_KEY`。发行包里只有凭据名称，不含任何密钥。

### 数据位置

- 插件存储：`$DSH_HOME/storages/openrouter-models/`（路由策略 `routing.json`、启动自检 `host-alive.json`、图标缓存）。
- 配置备份：`$DSH_HOME/config_backups/openrouter-models/`（导入模型前备份 profile patch）。
- `$DSH_HOME` 未显式设置时为 `~/.dsh`。

## 升级与卸载

- 图形界面：插件页对已安装 bundle 执行更新 / 卸载，然后重启 DSH。
- 命令行：先装新版再移除旧版，或直接卸下 bundle。

  ```powershell
  dsh plugin --profile web remove dsh-openrouter-market
  ```

- 插件被禁用后不会改动 profile 里的其它配置；卸载只会移除自己的 bundle 行与依赖。

## 排障

| 现象 | 检查 |
| --- | --- |
| 「设置 → Models」底部没有条目 | 插件是否已启用；桌面端是否已**完全退出并重启**（Client bundle 只在启动时加载）。 |
| 模型列表为空或 401 | `OPENROUTER_API_KEY` 是否已在 DSH 凭据管理中配置，名称与 `apiKeyEnv` 是否一致。 |
| 想确认 Host 半区是否激活 | 看 `$DSH_HOME/storages/openrouter-models/host-alive.json` 的 `stage` / `mounted` 字段，或本机访问 `http://127.0.0.1:<端口>/api/openrouter-models/status`。 |
| 想应用已保存的路由策略 | 把 `enableRouting` 覆盖为 `true` 后重启。 |

## 开发与校验

仓库里提交的是构建产物（`lib/index.js`、`lib/client.js`），因此**没有构建步骤**，克隆后即可安装。改动产物后跑一致性校验：

```powershell
npm test            # 零依赖冒烟校验：清单 / patch / 产物 / 插件索引
npm run pack:check  # 查看 npm 打包内容
```

发布流程：打标签并推送，GitHub Actions 会做校验、`npm pack` 并把 `.tgz` 附到 Release。

```powershell
git tag v0.2.0
git push origin v0.2.0
```

## 许可证

MIT，见 [LICENSE](LICENSE)。
