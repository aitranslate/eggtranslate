# AssemblyAI 转录集成说明

## 概述
使用 AssemblyAI 云端转录服务，支持 99+ 种语言自动检测。

## 配置
在 `src/constants/assemblyai.ts` 中配置 API Keys。

### API Keys 轮询
系统会随机选择一个可用的 API Key 进行调用，实现负载均衡。

```typescript
export const ASSEMBLYAI_CONFIG = {
  apiKeys: [
    'YOUR_API_KEY_1',
    'YOUR_API_KEY_2',
    // 添加更多 KEY
  ],
  // ...
};
```

### 语音模型
使用优先级模型列表：
- `universal-3-pro`: 支持英语、西班牙语、葡萄牙语、法语、德语、意大利语
- `universal-2`: 支持 99+ 种语言

系统会自动根据语言选择最优模型。

## 热词管理
支持按领域分组管理热词，提高专业术语识别准确率。

### 使用方式
1. 打开设置 → 转录设置
2. 创建新分组（如"医学术语"）
3. 添加热词到分组（如 "hypertension"）
4. 上传音视频文件进行转录

### 技术实现
- **服务**: `src/services/assemblyaiService.ts`
- **转换**: `src/utils/convertToWav.ts` (音视频 → WAV)
- **配置**: `src/constants/assemblyai.ts`
- **状态管理**: `src/stores/transcriptionStore.ts` (热词分组)
- **UI 组件**: `src/components/KeytermGroupsSettings.tsx`

## API 限制
- 文件大小: 最大 5GB
- 文件时长: 无限制
- 并发请求: 建议不超过 5 个同时进行

## 故障排除
### 转录失败
- 检查 API Key 是否有效
- 检查网络连接
- 查看控制台错误日志

### 热词不生效
- 确保热词已添加到分组
- 检查分组是否在转录配置中启用
- 尝试使用更具体的热词（多词短语）

## 相关链接
- [AssemblyAI 官方文档](https://www.assemblyai.com/docs)
- [AssemblyAI JavaScript SDK](https://github.com/AssemblyAI/assemblyai-js)
