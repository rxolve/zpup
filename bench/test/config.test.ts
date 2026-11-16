import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../lib/config.ts';

const raw = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));

describe('parseConfig', () => {
  it('leaves reasoning unset by default, so each model reasons as it normally does', () => {
    const config = parseConfig(raw);
    expect(config.reasoning).toBeUndefined();
    expect(config.maxTokens).toBe(32000);
    expect(config.reserveMargin).toBe(1.5);
  });

  it('accepts an effort or a token budget, but not both', () => {
    expect(parseConfig({ ...raw, reasoning: { effort: 'low' } }).reasoning).toEqual({
      effort: 'low',
    });
    expect(parseConfig({ ...raw, reasoning: { maxTokens: 8000 } }).reasoning).toEqual({
      maxTokens: 8000,
    });
    expect(() => parseConfig({ ...raw, reasoning: { effort: 'low', maxTokens: 8000 } })).toThrow(
      /not both/,
    );
    expect(() => parseConfig({ ...raw, reasoning: { effort: 'huge' } })).toThrow(/effort/);
  });

  it('defaults reserveMargin for configs written before it existed', () => {
    const { reserveMargin: _, ...old } = raw;
    expect(parseConfig(old).reserveMargin).toBe(1.5);
    expect(() => parseConfig({ ...raw, reserveMargin: 0.5 })).toThrow(/reserveMargin/);
  });
});
