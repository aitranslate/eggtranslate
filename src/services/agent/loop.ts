/**
 * Agent tool loop（对齐 AsrAgent loop.py + harness）。
 * model=大脑，tools=四肢；以 submit_* terminate 结束。
 */

import type { LLMConfig } from '@/types';
import { callLLM, type LLMMessage, type LLMToolSchema } from '@/utils/llmApi';
import { logger } from '@/utils/logger';
import { dispatchTool } from './tools/registry';
import type { AgentToolContext } from './toolTypes';

const DOOM_SOFT = 5;
const DOOM_HARD = 8;
const VERIFICATION_TOOLS = new Set([
  'count_transcript',
  'search_transcript',
  'verify_term',
  'web_search',
]);

export type AgentLoopResult = {
  finalResult: unknown;
  tokensUsed: number;
  rounds: number;
};

export type AgentLoopToolHook = (event: {
  phase: 'start' | 'end';
  name: string;
  argsSummary: string;
  /** 同一 tool_call 的 start/end 关联 id（并发窗安全） */
  callId: string;
  ok?: boolean;
  detail?: string;
  durationMs?: number;
}) => void | Promise<void>;

function summarizeToolArgs(raw: string): string {
  const s = (raw || '').trim();
  if (!s) return '';
  try {
    const o = JSON.parse(s) as unknown;
    const flat = JSON.stringify(o);
    return flat.length > 160 ? `${flat.slice(0, 157)}…` : flat;
  } catch {
    return s.length > 120 ? `${s.slice(0, 117)}…` : s;
  }
}

export async function runAgentLoop(options: {
  llm: LLMConfig;
  systemPrompt: string;
  userMessage: string;
  tools: LLMToolSchema[];
  ctx: AgentToolContext;
  signal: AbortSignal;
  maxRounds?: number;
  temperature?: number;
  submitToolName?: string;
  submitInstruction?: string;
  /** 工具调用可观测钩子（过程面板「工具」Tab） */
  onTool?: AgentLoopToolHook;
}): Promise<AgentLoopResult> {
  const {
    llm,
    systemPrompt,
    userMessage,
    tools,
    ctx,
    signal,
    maxRounds = 40,
    temperature = 0.3,
    submitToolName = 'submit_result',
    submitInstruction = 'with the required payload',
    onTool,
  } = options;

  ctx.submitToolName = submitToolName;
  ctx.finalResult = undefined;
  ctx.tokensUsed = 0;

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  let consecutiveVerify = 0;
  let toolErrorNudge = false;

  for (let round = 1; round <= maxRounds; round++) {
    if (signal.aborted) {
      const err = new Error('翻译已取消');
      err.name = 'AbortError';
      throw err;
    }

    const result = await callLLM(llm, messages, {
      signal,
      temperature,
      maxRetries: 2,
      tools,
      tool_choice: 'auto',
    });

    ctx.tokensUsed = (ctx.tokensUsed || 0) + (result.tokensUsed || 0);
    const assistant = result.message ?? {
      role: 'assistant' as const,
      content: result.content || null,
      tool_calls: result.toolCalls,
    };
    messages.push(assistant);

    const toolCalls = result.toolCalls ?? [];
    if (!toolCalls.length) {
      logger.info(`[agent-loop] round ${round}: no tool calls, stop`);
      break;
    }

    const names = new Set(toolCalls.map((t) => t.function.name));
    let terminate = false;
    let hadError = false;

    for (const tc of toolCalls) {
      const name = tc.function.name;
      const argsSummary = summarizeToolArgs(tc.function.arguments || '');
      const callId =
        (typeof tc.id === 'string' && tc.id) ||
        `tc-${round}-${name}-${Math.random().toString(36).slice(2, 8)}`;
      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (onTool) {
        await onTool({ phase: 'start', name, argsSummary, callId });
      }
      const tr = await dispatchTool(name, tc.function.arguments, ctx);
      const durationMs = Math.round(
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0
      );
      const ok = !(
        tr.content.startsWith('Error:') || tr.content.startsWith('[HARNESS]')
      );
      if (!ok) hadError = true;
      if (onTool) {
        await onTool({
          phase: 'end',
          name,
          argsSummary,
          callId,
          ok,
          detail: tr.content.slice(0, 240).replace(/\s+/g, ' '),
          durationMs,
        });
      }
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: tr.content.slice(0, 12000),
      });
      if (tr.terminate) {
        terminate = true;
      }
    }

    if (terminate) {
      logger.info(`[agent-loop] ${submitToolName} accepted at round ${round}`);
      break;
    }

    if (hadError && !toolErrorNudge) {
      toolErrorNudge = true;
      messages.push({
        role: 'user',
        content:
          `[HARNESS] A tool call returned an error. Read the Hint, fix arguments, and retry. ` +
          `When complete, call ${submitToolName} ${submitInstruction}.`,
      });
    }

    if ([...names].every((n) => VERIFICATION_TOOLS.has(n))) {
      consecutiveVerify += 1;
    } else {
      consecutiveVerify = 0;
    }

    if (consecutiveVerify >= DOOM_HARD) {
      messages.push({
        role: 'user',
        content:
          `[HARNESS] You have run verification tools for ${consecutiveVerify} rounds without submitting. ` +
          `Call ${submitToolName} NOW ${submitInstruction}.`,
      });
      consecutiveVerify = 0;
    } else if (consecutiveVerify >= DOOM_SOFT) {
      messages.push({
        role: 'user',
        content:
          `[HARNESS] You've used verification tools for ${consecutiveVerify} rounds. ` +
          `Consider calling ${submitToolName} ${submitInstruction}.`,
      });
    }
  }

  return {
    finalResult: ctx.finalResult,
    tokensUsed: ctx.tokensUsed || 0,
    rounds: messages.length,
  };
}
