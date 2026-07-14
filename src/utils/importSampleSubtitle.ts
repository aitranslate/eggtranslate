/**
 * 一键导入内置示例字幕（public/samples/sample-en.srt）
 */

import { addFile } from '@/services/filesService';

const SAMPLE_URL = '/samples/sample-en.srt';
const SAMPLE_NAME = 'sample-en.srt';

export async function importSampleSubtitle(): Promise<string | null> {
  const res = await fetch(SAMPLE_URL);
  if (!res.ok) {
    throw new Error(`示例文件加载失败（${res.status}）`);
  }
  const text = await res.text();
  const file = new File([text], SAMPLE_NAME, { type: 'application/x-subrip' });
  return addFile(file);
}
