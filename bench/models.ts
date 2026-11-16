/**
 * Checks the configured models against OpenRouter's public model list (no API
 * key needed, no model is called): does each id still exist, and do the prices
 * in the config match?
 *
 *   node bench/models.ts [--config bench/config.json]
 */
import { parseArgs } from 'node:util';
import { BENCH_DIR, loadConfig } from './lib/config.ts';

const { values } = parseArgs({ options: { config: { type: 'string' } } });
const config = loadConfig(values.config ?? new URL('config.json', BENCH_DIR));

interface ListedModel {
  id: string;
  pricing?: { prompt?: string; completion?: string };
}

const response = await fetch('https://openrouter.ai/api/v1/models');
if (!response.ok) throw new Error(`model list: HTTP ${response.status}`);
const listed = ((await response.json()) as { data: ListedModel[] }).data;
const byId = new Map(listed.map((m) => [m.id, m]));

let problems = 0;
for (const model of config.models) {
  const found = byId.get(model.id);
  if (!found) {
    problems++;
    console.log(`MISSING  ${model.id}`);
    continue;
  }
  const prompt = Number(found.pricing?.prompt) * 1_000_000;
  const completion = Number(found.pricing?.completion) * 1_000_000;
  const same =
    Math.abs(prompt - model.promptPricePerM) < 1e-6 &&
    Math.abs(completion - model.completionPricePerM) < 1e-6;
  if (!same) problems++;
  console.log(
    `${same ? 'OK      ' : 'PRICE   '} ${model.id}  listed $${prompt}/$${completion} per M, config $${model.promptPricePerM}/$${model.completionPricePerM}`,
  );
}
process.exit(problems ? 1 : 0);
