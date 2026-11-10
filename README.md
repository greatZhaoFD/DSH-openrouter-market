# DSH-openrouter-market

[English](README.en.md) | 中文

在 DeepSeek Harness 的「设置 → Models」页底部提供「OpenRouter 模型库」：浏览 OpenRouter 实时模型目录与各家 Provider 的价格 / 量化 / 可用性，保存分模型路由策略，并把勾选的模型合并进 DSH 的 OpenRouter 模型配置。

本仓库同时是插件的发布仓库：仓库包含的是已构建产物，没有构建步骤，安装后即可运行。

## 兼容性

- 目标运行时：DSH 0.2.x（`dsh.bundle` + `dsh.client` 官方插件包模型；在 DSH Desktop `0.2.2-rc.1`、`@deepseek-ai/dsh` CLI `0.2.0-rc.2` 上校验元数据与加载路径）。
- 运行时依赖：无。Host 侧只用 Node 内置模块，Client 侧只从页面模块表取 `react`。
- Node.js ≥ 20.18.0。

## 安装

> **当前状态**：这批改动还在 PR 分支 `feat/official-plugin-bundle` 上，`v0.2.1` 尚未发布 Release。发布前请从分支安装（方式 1 的分支索引地址，或 `dsh plugin --profile web add "https://github.com/greatZhaoFD/DSH-openrouter-market.git#feat/official-plugin-bundle"`）；合并到 `main` 并发布后，下面的 `main` / Release 地址才生效。

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
- 发布包（Releases 中的 `.tgz`）：`https://github.com/greatZhaoFD/DSH-openrouter-market/releases/download/v0.2.1/dsh-openrouter-market-0.2.1.tgz`

安装完成后完全退出并重启 DSH。

### 方式 4：本地目录 / 本地发布包

```text
plugin_manager install_bundle(target="D:\\path\\to\\DSH-openrouter-market")
```

或在插件页的安装框里填本地绝对路径（目录，或 `npm pack` 生成的 `.tgz` 绝对路径）。

### 方式 5：npm（发布之后）

```powershell
dsh plugin --profile web add dsh-openrouter-market@0.2.1
```

`package.json` 已带 `publishConfig`、`files` 与 `dsh` 字段，`npm publish` 后即可用这条路径。

## 使用

- 「设置 → Models」底部的 **OpenRouter 模型库** 条目展开模型列表；展开单个模型可查看 Provider 价格、量化和可用性。刷新会同时更新模型目录和已展开的 Provider 数据。
- 面板顶部有两个页面：**模型库**（浏览 / 筛选 / 导入）与 **已配置**（只读）。已配置页完全由「DSH 配置文件里的模型 + `routing.json` 里的策略 + OpenRouter 的 Provider 数据 + 本地图标」组合渲染：列出已配置模型及其实际生效的 Provider 顺序（有 `order` / `only` 时只显示选中的 Provider，否则显示全部并默认按输入价升序），展开后只有节点信息（价格 / 缓存价 / 延迟 / 吞吐 / Uptime / 量化），没有任何调参入口。
- 路由区可设置硬约束、选择策略、性能偏好与故障转移，点 **保存** 后写入插件存储（默认就生效，见下文「路由策略存放在哪」）。模型列表里整行点击即可展开 Provider，右侧「配置 / 路由」两列分别显示是否已导入 DSH 配置、是否已设置路由策略。
- 点 **导入到 DSH 配置** 把所选模型合并进 `llm-pi-ai` 的 OpenRouter 路由；导入只保留 DSH 模型配置支持的 `text` / `image` 模态，模型库本身仍展示 OpenRouter 的原始能力数据。导入完成后右上角会弹出结果提示（新增 / 更新 / 跳过数量）。
- 路由区每个模型旁有 **测试路由** 按钮：用已保存策略发一条 1 token 的探测请求，返回实际提供方（Provider）。这是确认"路由是否真的生效、最终是哪个供应商在服务"最直接的方式。
- 运行时路由注入**默认开启**：保存的策略会注入到发往 OpenRouter 的聊天请求。要临时关闭，在 profile patch 里覆盖 `enableRouting: false` 后重启。

## 配置

插件配置由 `cordis.patch.yml` 的默认值提供，可在 profile 的 `cordis.patch.yml` 里用同 `id` 覆盖（**覆盖会替换整个 `config`**，请把需要的字段都写全）：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `apiBaseUrl` | `https://openrouter.ai/api/v1` | OpenRouter API 根地址，仅兼容代理时才改。 |
| `apiKeyEnv` | `OPENROUTER_API_KEY` | DSH 凭据名；密钥本身由 DSH 凭据管理保存，插件只读这个名称。 |
| `modelsTtlMs` | `21600000`（6 小时） | 模型目录缓存时长。 |
| `endpointsTtlMs` | `900000`（15 分钟） | Provider / 端点数据缓存时长。 |
| `timeoutMs` | `25000` | 单次 OpenRouter 请求超时。 |
| `enableRouting` | `true` | 是否把已保存的路由策略注入聊天请求（全局 `fetch` 包装，失败自动回退）。默认开启；设为 `false` 可完全跳过该包装。 |

### 凭据

在 DSH 的 OpenRouter Provider 配置里填写 API Key（凭据管理），并让凭据名与 `apiKeyEnv` 一致，默认 `OPENROUTER_API_KEY`。发行包里只有凭据名称，不含任何密钥。

### 数据位置

- 插件存储：`$DSH_HOME/storages/openrouter-models/`（路由策略 `routing.json`、启动自检 `host-alive.json`、图标缓存）。
- 配置备份：`$DSH_HOME/config_backups/openrouter-models/`（导入模型前备份 profile patch）。
- `$DSH_HOME` 未显式设置时为 `~/.dsh`。

### 路由策略存放在哪

策略**不写进** `llm-pi-ai` 的 YAML：DSH 的模型配置 schema 只有模型清单，没有 OpenRouter 的 `provider` 路由字段。插件把策略存在自己的存储里，运行时注入请求：

```text
$DSH_HOME/storages/openrouter-models/routing.json
```

`routing.json` 按模型 id 保存，2 空格缩进、带结尾换行，可直接用编辑器阅读（旧版本写入的压缩格式会在插件加载时自动重排一次）：

```json
{
  "version": 1,
  "updatedAt": "2026-11-10T15:08:12.345Z",
  "strategies": {
    "deepseek/deepseek-v4.1-flash-1017": {
      "routingVersion": 2,
      "mode": "custom",
      "order": ["deepinfra", "together", "fireworks"],
      "only": [],
      "ignore": [],
      "allowFallbacks": true,
      "quantizations": [],
      "maxPrice": { "prompt": null, "completion": null, "request": null, "image": null },
      "requireParameters": false,
      "dataCollection": "allow",
      "zdr": false,
      "enforceDistillableText": false,
      "preferredMinThroughput": null,
      "preferredMaxLatency": null,
      "enabled": true
    }
  }
}
```

生效条件：请求是 `POST`、目标主机等于 `apiBaseUrl` 的主机、路径以 `/chat/completions` 或 `/messages` 结尾，且请求体里的 `model` 与策略的 key 完全一致。命中后 `mode: custom` 的 `order` 变成请求体的 `provider.order`，`sort` / `only` / `ignore` / `quantizations` / `max_price` / `require_parameters` / `data_collection` / `zdr` / `allow_fallbacks` 等按 OpenRouter 的同名字段注入；调用方自己写的 `provider` 字段优先，`sort` 冲突时以策略为准并打告警。

自检：`http://127.0.0.1:<端口>/api/openrouter-models/routing/status` 里的 `configEnabled` 应为 `true`，对话后 `injected` 计数增长；`/api/openrouter-models/routing` 可看全部策略。

验证路由与提供方：`http://127.0.0.1:<端口>/api/openrouter-models/probe?model=<模型 id>` 会用已保存策略发一条 1 token 的探测请求，返回 `provider`（实际提供方）、`appliedProvider`（本次注入的 provider 参数）与 `usage`。面板里的 **测试路由** 按钮调用的是同一个接口；它同时会经过真实的 `fetch` 注入路径，所以 `injected` 计数也会 +1。

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
| 想确认路由策略是否生效 | 看 `routing.json` 里是否有该模型 id；`/api/openrouter-models/routing/status` 的 `configEnabled` 为 `true` 且 `injected` 增长；`skipped` 增长通常是模型 id 不匹配或路径不是 `/chat/completions`。 |
| 想确认实际是哪个 Provider | 面板里对该模型点 **测试路由**，或浏览器打开 `/api/openrouter-models/probe?model=<模型 id>`，看返回的 `provider`；也可以对照 OpenRouter 网站的 Activity 记录。 |

## 开发与校验

仓库里提交的是构建产物（`lib/index.js`、`lib/client.js`），因此**没有构建步骤**，克隆后即可安装。改动产物后跑一致性校验：

```powershell
npm test            # 零依赖冒烟校验：清单 / patch / 产物 / 插件索引
npm run pack:check  # 查看 npm 打包内容
```

发布流程：打标签并推送，GitHub Actions 会做校验、`npm pack` 并把 `.tgz` 附到 Release。

```powershell
git tag v0.2.1
git push origin v0.2.1
```

## 许可证

MIT，见 [LICENSE](LICENSE)。
