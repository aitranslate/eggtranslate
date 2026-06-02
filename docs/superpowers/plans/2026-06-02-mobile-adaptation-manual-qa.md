# 移动端适配 — 手动 QA 清单

> 所有自动化检查已通过。剩下需要用户在 Chrome DevTools 模拟 + 真机操作。

## DevTools 模拟（推荐先做）

Chrome DevTools → 设备工具栏 → 切换以下宽度：

### 375px (iPhone SE)

#### Navbar
- [ ] 标题 "蛋蛋字幕翻译" 可见，无 v1.2 badge
- [ ] 右侧 ☰ 按钮（32×32 灰底）
- [ ] 点 ☰ → 抽屉从顶部滑下（200ms），含 3 个选项（术语/历史/设置）
- [ ] 抽屉顶部"蛋蛋字幕翻译" + ✕ 关闭
- [ ] 抽屉点 ✕ → 关闭
- [ ] 抽屉点 backdrop → 关闭
- [ ] 抽屉点选项 → 关闭 + 打开对应 modal
- [ ] 抽屉 3 个选项的 count badge 正确（如果有术语/历史）

#### 上传区
- [ ] 紧凑（p-5）
- [ ] 圆形 icon 40×40
- [ ] 标题 "点击或拖拽上传文件" (text-base)
- [ ] 副标题 "支持 SRT / 音视频，可多选"
- [ ] 显示 📷 拍照 + 🎤 录音 按钮
- [ ] 看不到 "支持 .srt .mp3..." 详细格式列表（hidden sm:block）

#### 文件卡
- [ ] 外层 padding p-3
- [ ] FileIcon 较小（20px）
- [ ] 标题 text-xs
- [ ] meta text-[10px]
- [ ] stepper 节点较小
- [ ] footer 2 行：
  - 第 1 行：热词 dropdown + 3 个 icon 按钮
  - 第 2 行：主操作按钮 full width

#### Modal（设置为例）
- [ ] 全屏（圆角 0）
- [ ] 顶部 48px 标题栏
- [ ] 中间 scroll
- [ ] 底部 sticky 操作栏（取消 + 保存）
- [ ] 关闭按钮在右上

### 768px (iPad 竖屏)

#### Navbar
- [ ] 3 按钮横排（术语/历史/设置）
- [ ] 无 v1.2 badge
- [ ] padding 适中

#### 上传区
- [ ] p-8
- [ ] icon 48×48
- [ ] 标题 text-lg
- [ ] 副标题更详细
- [ ] **不**显示拍照/录音

#### 文件卡
- [ ] p-3.5
- [ ] FileIcon 24px
- [ ] title text-sm
- [ ] footer 单行（保持原桌面布局）

#### Modal
- [ ] 居中 max-w 560
- [ ] 圆角
- [ ] 2 列表单布局
- [ ] 操作栏内嵌（非 sticky）

### 1280px (桌面)

- [ ] 全部不变

## 边界断点

- [ ] 640px 切换（上传区紧凑 → 中等）
- [ ] 768px 切换（navbar + 文件卡 + modal 切换）
- [ ] 1024px 切换（modal 560 → 680）

## 真机测试（部署后）

- [ ] iPhone Safari
- [ ] Android Chrome
- [ ] iPad Safari（横屏 + 竖屏各一次）

## 已知限制

- 文件拖拽上传在移动设备不可用（移动设备用拍照/录音/文件选择器）
- 桌面端 ≤1024px 时 modal 仍居中（不是全屏），符合预期
