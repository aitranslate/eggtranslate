# agent-browser E2E

端到端 UI 测试（基于 [agent-browser](https://github.com/vercel-labs/agent-browser)）。**本机已装好 agent-browser 后，改完代码直接跑命令即可**，不必重复安装。

## 日常命令

```bash
# 冒烟：导航 / 主题 / 术语 / 上传字幕 / 编辑器 / 设置 / 无 Key 守卫
pnpm test:e2e

# 真实翻译（sample-en + E2E_LLM_*）
pnpm test:e2e:live

# 完整 live：Mistral 双 Key + 真实字幕/视频素材
pnpm test:e2e:live-full

# 详细日志
E2E_VERBOSE=1 pnpm test:e2e
```

## 可选：真实 LLM 翻译

复制环境变量模板：

```bash
cp e2e/.env.example e2e/.env.e2e
```

编辑 `e2e/.env.e2e`：

```env
E2E_LLM_BASE_URL=https://api.mistral.ai/v1
E2E_LLM_API_KEY=key1|key2
E2E_LLM_MODEL=mistral-small-latest
```

多 Key 用 `|` 分隔，与应用内负载均衡一致。也可写在仓库根目录 `.env.local`（勿提交密钥）。

## 产物

- `e2e/output/report.txt` — 通过/失败清单  
- `e2e/output/*.png` — 逐步截图  

`e2e/output/` 已 gitignore。

## 说明

| 项 | 行为 |
|---|---|
| 开发服务器 | 若 `127.0.0.1:5173` 未启动会自动 `vite --host 127.0.0.1` |
| 已有 dev server | 复用；或 `E2E_SKIP_SERVER=1` 强制不启动 |
| Windows | 绑定 `127.0.0.1`（避免纯 IPv6 导致白屏） |
| 会话名 | `eggtranslate-e2e`（与手动浏览器隔离） |

## 目录

```
e2e/
  run.mjs           # 冒烟入口
  run-live.mjs      # 完整 live 入口
  lib/              # agent-browser / server / report
  fixtures/         # 提交进仓库的小字幕等
  output/           # 运行产物（忽略）
  .env.example
```

## 前置（仅新环境 / 命令找不到时）

若终端里已有 `agent-browser`（例如你已经 `npm install -g agent-browser`），**跳过本节**。

新机器或报 `agent-browser not found` 时再装一次：

```bash
pnpm test:e2e:install
# 或: npm install -g agent-browser && agent-browser install
```

`agent-browser install` 是下载 Chromium，不是装 npm 包本身。
