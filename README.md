# DSH-openrouter-market

在 DeepSeek Harness 的「设置 → Models」中浏览 OpenRouter 模型和 Provider，保存分模型路由，并将勾选的模型合并到 DSH 的 OpenRouter 配置。

## 安装

解压发行包后，将包含 package.json 和 cordis.patch.yml 的目录作为 DSH 插件包安装目标。也可直接使用源码目录。

```text
plugin_manager install_bundle(target="<本地插件目录的绝对路径>")
```

重启 DSH 后，在「设置 → Models」底部打开「OpenRouter 模型库」。配置 OpenRouter 凭据时使用 DSH 的凭据管理，插件默认查找 OPENROUTER_API_KEY。发行包内只有凭据名称。

## 使用

- 展开模型查看 Provider 价格、量化和可用性。刷新会更新模型目录及已展开的 Provider。
- 在路由区设置硬约束、选择策略、性能偏好和故障转移，再点击「保存」。策略保存在插件存储中。
- 点击「导入到 DSH 配置」将所选模型合并到 OpenRouter 路由。导入保留 DSH 模型配置支持的文本和图像类型。模型库仍使用 OpenRouter 原始能力数据。
- 运行时路由注入默认关闭。需要在聊天请求中应用已保存的策略时，在插件配置中将 enableRouting 设为 true，再重启 DSH。
