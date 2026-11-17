/**
 * A static HTML page for looking at the pictures. Every SVG is embedded as an
 * <img> data URI, so scripts or external references inside model output never
 * run. The page has an open view (formats labeled, zpup and Zdog shown at
 * every rotation) and a blind view (formats hidden behind X, Y and Z in a
 * shuffled order, one angle each).
 */
import type { LoadedRun, ScoredSample } from './report.ts';
import { type Condition, conditionsOf, type Score } from './types.ts';

const OPEN_LABEL: Record<Condition, string> = { svg: 'SVG', zdog: 'Zdog', zpup: 'zpup' };
const BLIND_LABELS = ['X', 'Y', 'Z'];

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const dataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}

function picture(svg: string, alt: string): string {
  return `<img src="${dataUri(svg)}" alt="${escapeHtml(alt)}" loading="lazy">`;
}

function invalidBox(score: Score | undefined, reason: string): string {
  const problems =
    score?.problems.slice(0, 4).map((p) => `<li>${escapeHtml(p.slice(0, 300))}</li>`) ?? [];
  return `<div class="invalid"><strong>${escapeHtml(reason)}</strong><ul class="open-only">${problems.join('')}</ul></div>`;
}

function side(
  sample: ScoredSample | undefined,
  condition: Condition,
  blindOrder: number,
  alt: string,
): string {
  const openLabel = OPEN_LABEL[condition];
  const blindLabel = BLIND_LABELS[blindOrder] ?? '?';
  let body: string;
  if (!sample) body = invalidBox(undefined, 'no sample');
  else if (sample.status === 'api-error') body = invalidBox(undefined, 'API error');
  else if (sample.status === 'truncated') {
    const tokens = sample.firstOutputTokens;
    const reasoning = sample.firstReasoningTokens;
    const detail =
      tokens === undefined
        ? 'Cut off at the output token limit.'
        : `Cut off at the output token limit after ${tokens} tokens${reasoning === undefined ? '' : `, ${reasoning} of them reasoning`}.`;
    body = `<div class="invalid truncated"><strong>truncated</strong><p class="open-only">${escapeHtml(detail)} Not scored, not repaired.</p></div>`;
  } else if (sample.finalValid && sample.final?.svg) {
    const rotations = sample.final.rotations ?? [];
    const extra = rotations
      .filter((r) => r.offsetDeg !== 0)
      .map((r) =>
        r.svg
          ? `<figure class="open-only">${picture(r.svg, `${alt}, turned ${r.offsetDeg} degrees`)}<figcaption>${r.offsetDeg > 0 ? '+' : ''}${r.offsetDeg}°</figcaption></figure>`
          : `<figure class="open-only"><div class="invalid">render failed</div><figcaption>${r.offsetDeg}°</figcaption></figure>`,
      )
      .join('');
    const single =
      condition === 'svg'
        ? '<figure class="open-only placeholder" aria-hidden="true"><div>one angle only</div></figure>'
        : '';
    const warnings = sample.final.sceneWarnings ?? [];
    const warningList = warnings.length
      ? `<details class="open-only scene-warnings"><summary>${warnings.length} scene warning${warnings.length === 1 ? '' : 's'}: ${escapeHtml([...new Set(warnings.map((w) => w.kind))].join(', '))}</summary><ul>${warnings
          .slice(0, 6)
          .map((w) => `<li>${escapeHtml(w.message.slice(0, 300))}</li>`)
          .join('')}</ul></details>`
      : '';
    body = `<figure>${picture(sample.final.svg, alt)}<figcaption>${sample.repaired ? 'after repair' : 'first try'}</figcaption></figure>${extra}${single}${warningList}`;
  } else {
    body = invalidBox(
      sample.final,
      sample.status === 'skipped'
        ? 'invalid (repair skipped)'
        : sample.repairTruncated
          ? 'invalid (repair truncated)'
          : 'invalid',
    );
  }
  return `<div class="side" style="--order:${blindOrder}"><div class="label"><span class="open-label">${openLabel}</span><span class="blind-label">${blindLabel}</span></div><div class="pics">${body}</div></div>`;
}

export function galleryHtml(run: LoadedRun): string {
  const { manifest, samples } = run;
  const formats = conditionsOf(manifest.config);
  const find = (model: string, task: string, condition: string, sample: number) =>
    samples.find(
      (s) =>
        s.record.model === model &&
        s.record.taskId === task &&
        s.record.condition === condition &&
        s.record.sample === sample,
    );

  const sections = manifest.tasks.map((task) => {
    const rows = manifest.config.models.map((model) => {
      const pairs: string[] = [];
      for (let k = 0; k < manifest.config.repetitions; k++) {
        const found = formats.map((c) => find(model.id, task.id, c, k));
        if (found.every((s) => !s)) continue;
        // The blind order is fixed per set so that a reload shows the same thing:
        // a rotation of the formats, reversed for half of the sets.
        const h = hash(`${manifest.runId}|${model.id}|${task.id}|${k}`);
        const n = formats.length;
        const shift = h % n;
        const flip = Math.floor(h / n) % 2 === 1;
        const blindOrder = (i: number) => {
          const p = (i + shift) % n;
          return flip ? n - 1 - p : p;
        };
        const alt = `${task.prompt}, ${model.label}, sample ${k + 1}`;
        pairs.push(
          `<div class="pair"><div class="pair-title">sample ${k + 1}</div><div class="sides">${formats.map((c, i) => side(found[i], c, blindOrder(i), alt)).join('')}</div></div>`,
        );
      }
      return `<div class="row"><h3>${escapeHtml(model.label)} <code>${escapeHtml(model.id)}</code></h3><div class="pairs">${pairs.join('')}</div></div>`;
    });
    return `<section><h2>${escapeHtml(task.prompt)}</h2>${rows.join('')}</section>`;
  });

  const mockNote =
    manifest.provider === 'mock'
      ? '<p class="warn">Mock run: these pictures are canned test data, not model output.</p>'
      : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>zpup bench gallery</title>
<style>
:root { --bg: #fafaf7; --fg: #222; --muted: #666; --card: #fff; --line: #ddd; --bad: #b3261e; }
@media (prefers-color-scheme: dark) { :root { --bg: #18181a; --fg: #eee; --muted: #aaa; --card: #232326; --line: #3a3a3e; --bad: #ff8a80; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 14px/1.45 system-ui, sans-serif; }
header { position: sticky; top: 0; background: var(--bg); padding: 8px 0; border-bottom: 1px solid var(--line); z-index: 1; }
button { font: inherit; padding: 4px 10px; margin-right: 6px; }
h2 { margin: 32px 0 8px; font-size: 18px; }
h3 { margin: 16px 0 6px; font-size: 14px; }
code { color: var(--muted); font-weight: normal; }
.pairs { display: flex; flex-wrap: wrap; gap: 12px; }
.pair { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 8px; max-width: 100%; }
.pair-title { color: var(--muted); font-size: 12px; margin-bottom: 4px; }
.sides { display: flex; flex-wrap: wrap; gap: 12px; }
.side { min-width: 0; }
.label { font-weight: 600; margin-bottom: 4px; }
.pics { display: flex; flex-wrap: wrap; gap: 6px; }
figure { margin: 0; text-align: center; }
figcaption { color: var(--muted); font-size: 11px; }
img, .invalid, .placeholder > div { width: 160px; height: 160px; display: block; background: #fff; border: 1px solid var(--line); border-radius: 4px; }
.invalid { color: var(--bad); font-size: 11px; padding: 6px; overflow: auto; background: var(--card); }
.invalid ul { padding-left: 14px; margin: 4px 0; }
.invalid p { margin: 4px 0; }
.truncated { color: var(--muted); border-style: dashed; }
.scene-warnings { flex-basis: 100%; max-width: 520px; font-size: 11px; color: var(--muted); }
.scene-warnings ul { padding-left: 14px; margin: 4px 0; }
.placeholder > div { display: flex; align-items: center; justify-content: center; color: var(--muted); background: transparent; border-style: dashed; font-size: 12px; }
.warn { color: var(--bad); font-weight: 600; }
.blind-label { display: none; }
body.blind .sides .side { order: var(--order); }
body.blind .open-only { display: none; }
body.blind:not(.revealed) .open-label { display: none; }
body.blind .blind-label { display: inline; }
body.blind.revealed .open-label::before { content: " = "; }
body.blind.revealed .open-label { display: inline; }
</style>
</head>
<body>
<header>
<strong>zpup bench</strong> run <code>${escapeHtml(manifest.runId)}</code> (${escapeHtml(manifest.provider)})
<div>
<button type="button" id="mode">Blind view</button>
<button type="button" id="reveal" hidden>Reveal formats</button>
<span id="hint"></span>
</div>
</header>
${mockNote}
<p>Each set shows one model's answers to the same request, one per format (${formats.map((c) => OPEN_LABEL[c]).join(', ')}). zpup and Zdog scenes are also drawn turned by ${manifest.config.rotationOffsetsDeg
    .filter((d) => d !== 0)
    .map((d) => `${d > 0 ? '+' : ''}${d}°`)
    .join(
      ' and ',
    )}; an SVG has only the one angle it was written for. In the blind view the formats appear as ${BLIND_LABELS.slice(0, formats.length).join(', ')} in a shuffled order, with one angle each and no error text. The drawing style can still give the format away.</p>
${sections.join('\n')}
<script>
const body = document.body, mode = document.getElementById('mode'), reveal = document.getElementById('reveal');
mode.addEventListener('click', () => {
  const blind = body.classList.toggle('blind');
  body.classList.remove('revealed');
  mode.textContent = blind ? 'Open view' : 'Blind view';
  reveal.hidden = !blind;
  reveal.textContent = 'Reveal formats';
});
reveal.addEventListener('click', () => {
  const shown = body.classList.toggle('revealed');
  reveal.textContent = shown ? 'Hide formats' : 'Reveal formats';
});
</script>
</body>
</html>
`;
}
