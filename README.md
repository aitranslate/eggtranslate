# 🥚 蛋蛋字幕翻译

> 🚀 **音视频转录 + 字幕翻译，一站式解决方案**

[![在线体验](https://img.shields.io/badge/🌐_在线体验-立即使用-blue?style=for-the-badge&color=4285f4)](https://eggtranslate.pages.dev/)
[![GitHub Stars](https://img.shields.io/github/stars/aitranslate/eggtranslate?style=for-the-badge)](https://github.com/aitranslate/eggtranslate)

---

## ✨ 在线体验

**🎯 无需安装，打开即用：[https://eggtranslate.pages.dev/](https://eggtranslate.pages.dev/)**

- 🌐 **纯浏览器运行** - 打开网页即可使用（支持 PWA 安装到桌面）
- ⚙️ **自带密钥** - 在设置中配置你自己的 API Key，不经本站中转
- ⚡ **即开即用** - 配置转录 / 翻译接口后即可开始
- 📱 **多端适配** - 支持桌面和移动设备，浅色 / 深色主题

---

## 🎯 两大核心功能

### 1️⃣ 音视频转录

支持从音视频文件提取语音并生成字幕：

- **🎬 多格式支持** - MP3、WAV、M4A、FLAC、MP4、WEBM、MKV、MOV 等
- **☁️ AssemblyAI 转录** - 云端 ASR，自动语言检测，词级时间戳
- **🔤 热词分组** - 自定义专有名词，提高识别准确率
- **✂️ 智能断句** - 本地 DP 断句 + 字幕长度预设（短 / 标准 / 宽松）
- **📊 实时进度** - 转码、上传、转录、断句分阶段显示

> 转录需要 [AssemblyAI](https://www.assemblyai.com/) API Key（可配置多个，用 `|` 分隔，失败时轮询）。

### 2️⃣ 字幕翻译

智能翻译 SRT 字幕文件：

- **🧠 AI 驱动** - 兼容 OpenAI 格式的大模型接口
- **🌍 多语言互译** - 中英日韩及多种欧洲 / 亚洲语言
- **📚 术语管理** - 自定义词典，专业术语翻译更准确
- **📖 历史记录** - 自动保存翻译结果，随时重新导出
- **⚡ 批量处理** - 同时处理多个字幕文件
- **📤 灵活导出** - 原文 / 译文 / 双语（原上译下、原下译上）/ 打包

---

## 🚀 快速开始

### 方式一：音视频转字幕

1. 打开设置，配置 **AssemblyAI API Key**
2. （可选）配置热词分组、字幕长度预设
3. 导入音视频（拖入工作区、侧栏「+」或 Ctrl/Cmd+O）
4. 等待转录与断句完成，生成 SRT
5. 可选择继续翻译字幕

### 方式二：翻译已有字幕

1. 打开设置，配置翻译 API（OpenAI 兼容接口）
2. 选择源语言和目标语言
3. 导入 SRT（拖入工作区、侧栏「+」或 Ctrl/Cmd+O）
4. （可选）添加术语表
5. 点击「开始翻译」，完成后按需导出

---

## 💡 使用技巧

### 📚 术语管理

添加专业术语确保翻译准确：

```
原文：One Piece
译文：海贼王
```

### 🔤 转录热词

在设置中为专有名词建立热词分组（如人名、品牌），转录时会作为提示提高识别率。

### ⚙️ 翻译 API 配置

支持多种大模型服务（任选其一，或手填任意 OpenAI 兼容接口）：

| 服务商 | 推荐模型（预设） | 特点 |
|--------|------------------|------|
| Agnes AI | agnes-2.0-flash | 免费档 |
| DeepSeek | deepseek-v4-flash | 推荐 · 性价比 |
| 通义千问 | qwen3.6-flash | 低成本 |
| 智谱 AI | glm-4.7-flash | Flash 档 |
| 豆包 | doubao-seed-2-1-turbo-… | 可改成方舟接入点 ID |
| OpenAI | gpt-5-mini | 高性价比 |
| Gemini | gemini-3.5-flash | OpenAI 兼容端点 |
| OpenRouter | google/gemini-3.5-flash | 聚合 |
| Ollama | qwen3:8b | 本地 · 需先 pull |

多 Key 可用 `|` 分隔，与应用内负载/轮询策略一致。模型 ID 可在设置中修改。

---

## 🎯 适用场景

- 🎬 **影视制作** - 为外语视频制作中文字幕
- 🎓 **教学视频** - 快速翻译课程字幕
- 📚 **语言学习** - 生成双语对照字幕辅助学习
- 🌍 **内容传播** - 翻译视频字幕扩大受众
- 🎙️ **播客转录** - 将音频节目转为文字稿

---

## 🌍 浏览器要求

| 浏览器 | 版本要求 | 说明 |
|--------|----------|------|
| Chrome | 较新稳定版 | ✅ 推荐 |
| Edge | 较新稳定版 | ✅ 推荐 |
| Firefox | 较新稳定版 | ✅ 可用 |
| Safari | 较新稳定版 | ✅ 可用 |

> 💡 转录会在浏览器内尝试转码为 MP3 再上传；翻译与 UI 为纯前端。推荐使用最新版 Chromium 系浏览器以获得最佳体验。

---

## 🧪 本地开发与 E2E

```bash
pnpm install
pnpm dev                 # http://127.0.0.1:5173
pnpm test                # 单元测试 (vitest)
pnpm test:e2e            # agent-browser 全流程冒烟
pnpm test:e2e:live       # 含真实 LLM（需 e2e/.env.e2e）
pnpm test:e2e:live-full  # 完整 live 素材 + LLM
```

本机已全局安装 `agent-browser` 时，直接 `pnpm test:e2e` 即可，无需再装。  
仅在新环境或提示找不到命令时执行：`pnpm test:e2e:install`。

说明见 [`e2e/README.md`](e2e/README.md)。

设计 token 与组件约定见 [`DESIGN.md`](DESIGN.md)。

---

## 🔒 隐私与数据流

- ✅ **密钥本地存储** - API Key 保存在浏览器本地，不经本站服务器
- ✅ **本站不中转** - 应用为纯前端；请求由你的浏览器直连第三方 API
- ⚠️ **转录** - 音视频会上传到 **AssemblyAI** 进行处理
- ⚠️ **翻译** - 字幕文本会发送到你配置的 **LLM 服务商**
- ✅ **术语 / 历史** - 保存在浏览器本地存储

请仅使用你信任的 API 服务，并遵守各服务商的数据处理政策。

---

## ❓ 常见问题

**Q: 转录需要多久？**  
A: 取决于音频时长、网络与 AssemblyAI 队列。一般会经历转码 → 上传 → 转录 → 本地断句。

**Q: 支持哪些语言的转录？**  
A: 由 AssemblyAI 自动语言检测决定，覆盖多种常见语言。具体以 [AssemblyAI 文档](https://www.assemblyai.com/docs) 为准。

**Q: 必须配置 API 吗？**  
A: 转录需要 AssemblyAI Key；翻译需要兼容 OpenAI 格式的 LLM API。仅编辑 / 导出已有 SRT 可不配 Key。

**Q: 还需要下载本地模型吗？**  
A: 不需要。当前版本不再使用浏览器内本地 ASR 模型。

**Q: 文件会经过你们的服务器吗？**  
A: 不会。请求从浏览器直连你配置的服务商。

---

## 📄 开源协议

本项目基于 [MIT License](LICENSE) 开源协议。

---

## 📞 联系方式

- **在线体验**：[https://eggtranslate.pages.dev/](https://eggtranslate.pages.dev/)
- **问题反馈**：[GitHub Issues](https://github.com/aitranslate/eggtranslate/issues)
