/**
 * Per-round message projection (AsrAgent context.project_context).
 * Non-destructive: returns a new list for the LLM call only.
 */

import type { LLMMessage } from '@/utils/llmApi';

/**
 * Keep system + first user full; compress older assistant/tool rounds;
 * keep recent turns verbatim.
 */
export function projectContext(
  messages: LLMMessage[],
  options?: { keepRecentTurns?: number; webKeepChars?: number }
): LLMMessage[] {
  if (messages.length <= 4) return messages.slice();

  const keepRecentTurns = Math.max(1, options?.keepRecentTurns ?? 3);
  const webKeepChars = Math.max(50, options?.webKeepChars ?? 500);

  const head = messages.slice(0, 2);
  const assistantIdx = messages
    .map((m, i) => (m.role === 'assistant' ? i : -1))
    .filter((i) => i >= 0);

  if (assistantIdx.length <= keepRecentTurns) {
    return messages.slice();
  }

  const keepFrom = assistantIdx[assistantIdx.length - keepRecentTurns];
  const tail = messages.slice(keepFrom);
  const middle = messages.slice(2, keepFrom);

  const toolResults = new Map<string, string>();
  for (const m of middle) {
    if (m.role === 'tool' && m.tool_call_id) {
      toolResults.set(m.tool_call_id, m.content || '');
    }
  }

  const compressed: LLMMessage[] = [];
  for (const m of middle) {
    if (m.role === 'assistant') {
      const tcs = m.tool_calls || [];
      const parts: string[] = [];
      for (const tc of tcs) {
        const tcname = tc.function?.name || '?';
        const args = (tc.function?.arguments || '').slice(0, 30);
        const tcid = tc.id || '';
        const tresFull = (toolResults.get(tcid) || '')
          .trim()
          .replace(/\n/g, ' ');
        const keep = tcname === 'web_search' ? webKeepChars : 100;
        const tres = tresFull.slice(0, keep);
        parts.push(`${tcname}(${args}) -> ${tres}`);
      }
      const content = (m.content || '').trim().replace(/\n/g, ' ').slice(0, 80);
      const summary = parts.length ? parts.join('; ') : '(no tool call)';
      const note = content ? ` | said: ${content}` : '';
      compressed.push({
        role: 'user',
        content: `[prior round: ${summary}${note}]`,
      });
    } else if (m.role === 'tool') {
      continue;
    } else {
      compressed.push({ ...m });
    }
  }

  return [...head, ...compressed, ...tail];
}
