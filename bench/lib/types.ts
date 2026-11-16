/** Shared types for the benchmark. */

/** The two ways a model is asked to draw. */
export type Condition = 'svg' | 'zpup';
export const CONDITIONS: readonly Condition[] = ['svg', 'zpup'];

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
  repetitions: number;
  maxCostUsd: number;
  maxTokens: number;
  concurrency: number;
  canvas: { width: number; height: number };
  rotationOffsetsDeg: number[];
  estimate: { outputTokensPerCall: number; repairRate: number };
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
  /** For valid replies: the SVG to show. For zpup, the scene at its own view angle. */
  svg?: string;
  /** zpup only: the scene rendered at each configured rotation offset. */
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
  /** Set when the first try was invalid but the cost cap stopped the repair call. */
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
