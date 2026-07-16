import { describe, it, expect } from 'vitest';
import { extractMcpText } from '../tools/parallelSearch';

describe('extractMcpText', () => {
  it('parses JSON-RPC content text', () => {
    const raw = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [{ type: 'text', text: 'hello from parallel' }],
      },
    });
    expect(extractMcpText(raw)).toBe('hello from parallel');
  });

  it('parses SSE data: lines', () => {
    const raw =
      'event: message\ndata: {"result":{"content":[{"text":"sse hit"}]}}\n\n';
    expect(extractMcpText(raw)).toBe('sse hit');
  });
});
