export interface AssemblyAISentence {
  text: string;
  start: number;
  end: number;
  words?: Array<{ text: string; start: number; end: number }>;
}
