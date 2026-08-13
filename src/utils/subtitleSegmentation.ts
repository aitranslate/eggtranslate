export interface AssemblyAISentence {
  text: string;
  start: number;
  end: number;
  words?: Array<{ text: string; start: number; end: number }>;
  /** 本句由 AI 断句产出 */
  aiSplit?: boolean;
}
