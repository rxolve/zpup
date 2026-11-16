import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  OPENROUTER_URL,
  OpenRouterProvider,
  ProviderError,
  readOpenRouterKey,
} from '../lib/providers.ts';
import type { CompletionRequest } from '../lib/types.ts';

const KEY = 'sk-or-test-not-a-real-key';
const request: CompletionRequest = {
  model: 'example/model',
  messages: [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
  ],
  maxTokens: 100,
  meta: { taskId: 't', condition: 'svg', sample: 0, attempt: 0 },
};

const okBody = JSON.stringify({
  id: 'gen-1',
  choices: [{ finish_reason: 'stop', message: { content: '<svg/>' } }],
  usage: {
    prompt_tokens: 10,
    completion_tokens: 50,
    completion_tokens_details: { reasoning_tokens: 30 },
    cost: 0.0012,
  },
});

function stubFetch(responses: { status: number; body: string }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift() ?? { status: 500, body: 'no more responses' };
    return new Response(next.body, { status: next.status });
  }) as typeof fetch;
  return { calls, fetchStub };
}

describe('OpenRouterProvider', () => {
  it('posts an OpenAI-style request with only the auth and content-type headers', async () => {
    const { calls, fetchStub } = stubFetch([{ status: 200, body: okBody }]);
    const provider = new OpenRouterProvider({ apiKey: KEY, fetch: fetchStub });
    const result = await provider.complete(request);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(OPENROUTER_URL);
    expect(calls[0]?.init.headers).toEqual({
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body).toEqual({
      model: 'example/model',
      messages: request.messages,
      max_tokens: 100,
      usage: { include: true },
    });
    expect(result.text).toBe('<svg/>');
    expect(result.usage).toEqual({
      promptTokens: 10,
      completionTokens: 50,
      reasoningTokens: 30,
      costUsd: 0.0012,
    });
    expect(result.finishReason).toBe('stop');
  });

  it('sends the reasoning parameter only when one is configured', async () => {
    const { calls, fetchStub } = stubFetch([
      { status: 200, body: okBody },
      { status: 200, body: okBody },
    ]);
    const provider = new OpenRouterProvider({ apiKey: KEY, fetch: fetchStub });
    await provider.complete({ ...request, reasoning: { effort: 'high' } });
    await provider.complete({ ...request, reasoning: { maxTokens: 8000 } });
    const bodies = calls.map((c) => JSON.parse(String(c.init.body)));
    expect(bodies[0].reasoning).toEqual({ effort: 'high' });
    expect(bodies[1].reasoning).toEqual({ max_tokens: 8000 });
  });

  it('retries rate limits and server errors, then succeeds', async () => {
    const { calls, fetchStub } = stubFetch([
      { status: 429, body: 'slow down' },
      { status: 502, body: 'bad gateway' },
      { status: 200, body: okBody },
    ]);
    const waits: number[] = [];
    const provider = new OpenRouterProvider({
      apiKey: KEY,
      fetch: fetchStub,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    await provider.complete(request);
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([2000, 8000]);
  });

  it('fails fast on client errors and never puts the key in the message', async () => {
    const { calls, fetchStub } = stubFetch([{ status: 401, body: '{"error":"bad key"}' }]);
    const provider = new OpenRouterProvider({ apiKey: KEY, fetch: fetchStub });
    const error = await provider.complete(request).catch((e: unknown) => e);
    expect(calls).toHaveLength(1);
    expect(error).toBeInstanceOf(ProviderError);
    expect(String((error as Error).message)).not.toContain(KEY);
  });

  it('treats an error object in a 200 response as a failure', async () => {
    const { fetchStub } = stubFetch([{ status: 200, body: '{"error":{"message":"no capacity"}}' }]);
    const provider = new OpenRouterProvider({ apiKey: KEY, fetch: fetchStub });
    await expect(provider.complete(request)).rejects.toThrow('no capacity');
  });
});

describe('readOpenRouterKey', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const envFile = (text: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'zpup-bench-env-'));
    dirs.push(dir);
    const path = join(dir, '.env');
    writeFileSync(path, text);
    return path;
  };

  it('reads the key from the .env file', () => {
    expect(readOpenRouterKey(envFile(`OTHER=1\nOPENROUTER_API_KEY=${KEY}\n`))).toBe(KEY);
  });

  it('explains a missing file or key without echoing anything from the file', () => {
    expect(() => readOpenRouterKey(join(tmpdir(), 'no-such-dir-zpup', '.env'))).toThrow(
      /No \.env file/,
    );
    const path = envFile('OPENROUTER_API_KEY=\nSECRET=hunter2\n');
    expect(() => readOpenRouterKey(path)).toThrow(/missing or empty/);
    try {
      readOpenRouterKey(path);
    } catch (error) {
      expect((error as Error).message).not.toContain('hunter2');
    }
  });
});
