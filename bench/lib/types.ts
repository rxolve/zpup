/** Shared types for the benchmark. */

/** The ways a model can be asked to draw. */
export type Condition = 'svg' | 'zdog' | 'zpup';
/** Every format the harness knows, in the order tables and galleries show them. */
export const ALL_CONDITIONS: readonly Condition[] = ['svg', 'zdog', 'zpup'];
/** The formats a run uses when its config does not list any. */
export const DEFAULT_CONDITIONS: readonly Condition[] = ['svg', 'zpup'];
/** The formats of a run, in display order. */
export const conditionsOf = (config: { formats?: readonly Condition[] }): readonly Condition[] =>
  ALL_CONDITIONS.filter((c) => (config.formats ?? DEFAULT_CONDITIONS).includes(c));

export interface Task {
  id: string;
  prompt: string;
}

export interface ModelConfig {
  id: string;
  label: string;
  /** USD per million prompt tokens. */
  promptPricePerM: number;
  /** USD per million completion tokens. */
  completionPricePerM: number;
  why?: string;
}

export interface BenchConfig {
  models: ModelConfig[];
  /** The formats to compare. Missing means raw SVG and zpup. */
  formats?: Condition[];
  repetitions: number;
  maxCostUsd: number;
  /** Output token limit per call, reasoning included. */
  maxTokens: number;
  /**
   * OpenRouter's `reasoning` request parameter, sent unchanged to both conditions.
   * Missing means the parameter is not sent and each model reasons as it does by default.
   */
  reasoning?: ReasoningConfig;
  /**
   * Each call reserves its worst case (the whole `maxTokens`, at the listed prices)
   * times this factor before it starts, because providers sometimes bill above the
   * listed price. Default 1.5.
   */
  reserveMargin: number;
  concurrency: number;
  canvas: { width: number; height: number };
  rotationOffsetsDeg: number[];
  estimate: { outputTokensPerCall: number; repairRate: number };
}

/** See https://openrouter.ai/docs/use-cases/reasoning-tokens. Use `effort` or `maxTokens`, not both. */
export interface ReasoningConfig {
  effort?: 'max' | 'xhigh' | 'high' | 'medium' | 'low' | 'minimal' | 'none';
  /** A reasoning token budget, sent as `reasoning.max_tokens`. */
  maxTokens?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Context about a request. Providers may ignore it; the mock provider uses it. */
export interface RequestMeta {
  taskId: string;
  condition: Condition;
  sample: number;
  /** 0 for the first try, 1 for the repair. */
  attempt: number;
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  reasoning?: ReasoningConfig;
  meta: RequestMeta;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  /** Part of `completionTokens` spent on hidden reasoning, when reported. */
  reasoningTokens?: number;
  /** Cost reported by the provider, when it reports one. */
  costUsd?: number;
}

export interface CompletionResult {
  text: string;
  usage: Usage;
  latencyMs: number;
  finishReason?: string;
  /** The provider's own id for the generation, when it has one. */
  generationId?: string;
}

export interface Provider {
  readonly name: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

/** The outcome of checking one reply. */
export interface Score {
  valid: boolean;
  /** Problems found, in the exact form sent back to the model on repair. */
  problems: string[];
  /** Things that do not fail the check but are worth seeing (for example a missing SVG namespace). */
  warnings: string[];
  /** For valid replies: the SVG to show. For zpup and Zdog, the scene at its own view angle. */
  svg?: string;
  /** zpup only, valid scenes only: what `checkSceneWarnings` reported, by kind. */
  sceneWarnings?: { kind: string; message: string }[];
  /** zpup and Zdog: the scene rendered at each configured rotation offset. */
  rotations?: { offsetDeg: number; svg?: string; error?: string }[];
}

/** One model call as stored on disk. */
export interface AttemptRecord {
  attempt: number;
  messages: ChatMessage[];
  /** Missing when the call failed. */
  response?: CompletionResult;
  /** The cost counted for this call: provider-reported when available, else computed from config prices. */
  costUsd: number;
  error?: string;
}

/** Everything stored for one (model, condition, task, sample). */
export interface SampleRecord {
  model: string;
  condition: Condition;
  taskId: string;
  taskPrompt: string;
  sample: number;
  attempts: AttemptRecord[];
  startedAt: string;
  /**
   * Set when the first try was invalid but no repair was asked for: the cost cap
   * stopped it, or the reply was cut off at the output token limit.
   */
  repairSkipped?: string;
}

export interface RunManifest {
  runId: string;
  provider: string;
  startedAt: string;
  finishedAt?: string;
  gitCommit?: string;
  referenceSha256: string;
  config: BenchConfig;
  tasks: Task[];
  stoppedReason?: string;
  spentUsd?: number;
}
