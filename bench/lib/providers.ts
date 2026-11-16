import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { roughTokens } from './prompts.ts';
import type { CompletionRequest, CompletionResult, Provider, RequestMeta, Usage } from './types.ts';

// ---------------------------------------------------------------------------
// Mock provider

export type MockResponder = (request: CompletionRequest) => string;

/** Returns canned replies, never touches the network. Token counts are rough estimates. */
export class MockProvider implements Provider {
  readonly name = 'mock';
  readonly calls: CompletionRequest[] = [];
  private readonly respond: MockResponder;

  constructor(respond: MockResponder = defaultMockReply) {
    this.respond = respond;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    this.calls.push(request);
    const started = performance.now();
    const text = this.respond(request);
    const prompt = request.messages.map((m) => m.content).join('\n');
    return {
      text,
      usage: { promptTokens: roughTokens(prompt), completionTokens: roughTokens(text) },
      latencyMs: performance.now() - started,
      finishReason: 'stop',
      generationId: `mock-${this.calls.length}`,
    };
  }
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}

const PALETTE = ['#e62', '#2a9d8f', '#e9c46a', '#6a4c93', '#f07a8a', '#1d3557'];

/**
 * The default canned replies for `--provider mock`. Some first tries are broken
 * on purpose so the repair path runs, and a few stay broken after the repair.
 */
export function defaultMockReply(request: CompletionRequest): string {
  const { taskId, condition, sample, attempt }: RequestMeta = request.meta;
  const h = hash(`${request.model}|${taskId}|${sample}`);
  const color = PALETTE[h % PALETTE.length] ?? '#333';
  const stuck = h % 11 === 0;
  const broken = attempt === 0 ? h % 3 === 0 || stuck : stuck;

  if (condition === 'svg') {
    if (broken) {
      return stuck
        ? '<html><body>An SVG would go here.</body></html>'
        : `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><g><circle cx="200" cy="200" r="80" fill="${color}"/></svg>`;
    }
    return [
      '```svg',
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">',
      '  <ellipse cx="200" cy="320" rx="110" ry="18" fill="#0002"/>',
      `  <circle cx="200" cy="200" r="100" fill="${color}"/>`,
      '  <circle cx="165" cy="160" r="28" fill="#fff6"/>',
      '</svg>',
      '```',
    ].join('\n');
  }

  if (broken) {
    return stuck
      ? '{ "width": 400, "height": 400, "children": [ { "type": "path", "path": [{}], }, ] }'
      : JSON.stringify({
          width: 400,
          height: 400,
          children: [
            { type: 'circle', radius: 50, colour: color },
            { type: 'path', path: [{}], stroke: '40px', color },
          ],
        });
  }
  return JSON.stringify(
    {
      width: 400,
      height: 400,
      rotate: { x: -20, y: 30 },
      children: [
        { type: 'path', path: [{}], stroke: 140, color },
        { type: 'ellipse', diameter: 240, stroke: 12, color: '#333', rotate: { x: 90 } },
        { type: 'path', path: [{ z: 70 }], stroke: 24, color: '#fff' },
      ],
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// OpenRouter provider

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Reads OPENROUTER_API_KEY from the repository's .env file only (not from the
 * process environment). The value is never printed.
 */
export function readOpenRouterKey(envPath: string | URL): string {
  let text: string;
  try {
    text = readFileSync(envPath, 'utf8');
  } catch {
    throw new Error(
      'No .env file found. Add OPENROUTER_API_KEY=... to .env at the repository root.',
    );
  }
  const key = parseEnv(text).OPENROUTER_API_KEY?.trim();
  if (!key) throw new Error('OPENROUTER_API_KEY is missing or empty in .env.');
  return key;
}

export interface OpenRouterOptions {
  apiKey: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Retries for rate limits, server errors and network failures. Default 2. */
  retries?: number;
  /** Per-request timeout. Default 10 minutes (reasoning models can be slow). */
  timeoutMs?: number;
}

/** Thrown for a failed call. The message never contains the API key or request headers. */
export class ProviderError extends Error {
  override readonly name = 'ProviderError';
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Calls OpenRouter's OpenAI-compatible chat completions endpoint with plain
 * fetch. Sends only the Authorization and Content-Type headers.
 */
export class OpenRouterProvider implements Provider {
  readonly name = 'openrouter';
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #retries: number;
  readonly #timeoutMs: number;

  constructor(options: OpenRouterOptions) {
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? fetch;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#retries = options.retries ?? 2;
    this.#timeoutMs = options.timeoutMs ?? 600_000;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const body = JSON.stringify({
      model: request.model,
      messages: request.messages,
      max_tokens: request.maxTokens,
      usage: { include: true },
    });
    let lastError: ProviderError | undefined;
    for (let attempt = 0; attempt <= this.#retries; attempt++) {
      if (attempt > 0) await this.#sleep(2000 * 4 ** (attempt - 1));
      const started = performance.now();
      let response: Response;
      try {
        response = await this.#fetch(OPENROUTER_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.#apiKey}`,
            'Content-Type': 'application/json',
          },
          body,
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
      } catch (error) {
        lastError = new ProviderError(`network error: ${(error as Error).message}`);
        continue;
      }
      const raw = await response.text();
      const latencyMs = performance.now() - started;
      if (!response.ok) {
        lastError = new ProviderError(
          `HTTP ${response.status}: ${raw.slice(0, 500)}`,
          response.status,
        );
        if (response.status === 429 || response.status >= 500) continue;
        throw lastError;
      }
      return parseCompletion(raw, latencyMs);
    }
    throw lastError ?? new ProviderError('request failed');
  }
}

interface OpenRouterResponse {
  id?: string;
  error?: { message?: string; code?: number | string };
  choices?: {
    finish_reason?: string | null;
    message?: { content?: string | null | { type?: string; text?: string }[] };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
    cost?: number;
  };
}

export function parseCompletion(raw: string, latencyMs: number): CompletionResult {
  let data: OpenRouterResponse;
  try {
    data = JSON.parse(raw) as OpenRouterResponse;
  } catch {
    throw new ProviderError(`response is not JSON: ${raw.slice(0, 200)}`);
  }
  if (data.error) {
    throw new ProviderError(`provider error: ${data.error.message ?? JSON.stringify(data.error)}`);
  }
  const choice = data.choices?.[0];
  if (!choice) throw new ProviderError('response has no choices');
  const content = choice.message?.content;
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((part) => part.text ?? '').join('')
        : '';
  const usage: Usage = {
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
  };
  const reasoning = data.usage?.completion_tokens_details?.reasoning_tokens;
  if (typeof reasoning === 'number') usage.reasoningTokens = reasoning;
  if (typeof data.usage?.cost === 'number') usage.costUsd = data.usage.cost;
  const result: CompletionResult = { text, usage, latencyMs };
  if (choice.finish_reason) result.finishReason = choice.finish_reason;
  if (data.id) result.generationId = data.id;
  return result;
}
