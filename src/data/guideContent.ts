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
4️⃣ 导出结果

推荐 LongCat（免费）：https://longcat.chat/platform`,
  },
  {
    id: 'transcribe',
    title: '音视频转录',
    content: `上传音视频自动生成字幕，支持 MP3/WAV/M4A/WEBM 等格式，99+ 种语言自动识别。`,
  },
  {
    id: 'terms',
    title: '术语管理',
    content: `添加术语确保专有名词翻译一致。格式：原文 → 译文 [说明]`,
  },
];
