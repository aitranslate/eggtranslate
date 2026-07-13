// src/data/guideContent.ts

export interface GuideSection {
  id: string;
  title: string;
  content: string;
}

export const guideSections: GuideSection[] = [
  {
    id: 'quick-start',
    title: '快速入门',
    content: `1️⃣ 配置翻译服务（设置 → 翻译设置）
2️⃣ 上传音视频/SRT文件
3️⃣ 点击"开始翻译"
4️⃣ 导出结果`,
  },
  {
    id: 'api-recommend',
    title: '免费翻译 API 推荐',
    content: `推荐使用 Agnes AI（免费、兼容 OpenAI 接口，可直接填入本应用）：

1. 打开 https://agnes-ai.com/ 注册并领取免费额度
2. 在平台创建 API Key：https://platform.agnes-ai.com/
3. 在本应用「设置 → 翻译设置」中填写：
   · Base URL：https://apihub.agnes-ai.com/v1
   · API Key：你的 Agnes 密钥
   · 模型名：agnes-2.0-flash（或其他平台提供的模型）
4. 点击「测试连接」，成功后即可开始翻译

也支持 DeepSeek、通义千问、智谱、豆包等任意 OpenAI 兼容服务。`,
  },
  {
    id: 'terms',
    title: '术语管理',
    content: `添加术语确保专有名词翻译一致。格式：原文 → 译文 [说明]`,
  },
];
