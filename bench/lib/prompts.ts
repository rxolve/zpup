import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BENCH_DIR, REPO_DIR } from './config.ts';
import type { ChatMessage, Condition } from './types.ts';

export interface PromptTemplates {
  system: Record<Condition, string>;
  user: string;
  repair: string;
  /** The reference each format's system prompt includes: llms.txt for Zpup, a summary of the API for Zdog, none for SVG. */
  reference: Record<Condition, string>;
}

/** What each condition is asked to produce, as used in the repair message. */
export const FORMAT_NAME: Record<Condition, string> = {
  svg: 'SVG document',
  zdog: 'Zdog script',
  zpup: 'Zpup scene in JSON',
};

const read = (name: string) => readFileSync(new URL(`prompts/${name}`, BENCH_DIR), 'utf8');

export function loadPrompts(): PromptTemplates {
  return {
    system: {
      svg: read('svg.system.txt'),
      zdog: read('zdog.system.txt'),
      zpup: read('zpup.system.txt'),
    },
    user: read('user.txt'),
    repair: read('repair.txt'),
    reference: {
      svg: '',
      zdog: read('zdog.reference.md'),
      zpup: readFileSync(new URL('llms.txt', REPO_DIR), 'utf8'),
    },
  };
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`prompt template has no value for ${match}`);
    return value;
  });
}

/** The messages for the first try. */
export function firstMessages(
  templates: PromptTemplates,
  condition: Condition,
  task: string,
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: fill(templates.system[condition], {
        reference: templates.reference[condition].trim(),
      }).trim(),
    },
    { role: 'user', content: fill(templates.user, { task }).trim() },
  ];
}

/** The messages for the repair: the first conversation, the model's reply and the checker's report. */
export function repairMessages(
  templates: PromptTemplates,
  condition: Condition,
  first: ChatMessage[],
  reply: string,
  problems: string[],
): ChatMessage[] {
  return [
    ...first,
    { role: 'assistant', content: reply },
    {
      role: 'user',
      content: fill(templates.repair, {
        format: FORMAT_NAME[condition],
        problems: problems.map((p) => `- ${p}`).join('\n'),
      }).trim(),
    },
  ];
}

/** A rough token count (about four characters per token), used only for estimates. */
export function roughTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
