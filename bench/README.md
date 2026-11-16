# zpup bench

Does a language model draw better with zpup than with raw SVG? This benchmark asks the same models for the same pictures in both formats and records what comes back. That zpup comes out ahead is a hypothesis, not a result: the harness is built so that a bad outcome for zpup shows up just as clearly as a good one.

Nothing in this directory is part of the npm package (`package.json` publishes only `dist`, `llms.txt`, `README.md` and `LICENSE`).

## What it does

For every task in [`tasks.json`](tasks.json) (twelve drawing requests, including "a pelican riding a bicycle"), every model in [`config.json`](config.json), and each of `repetitions` samples (default 3), the model is asked twice:

- **SVG:** write a standalone SVG document. No reference material is given; the model relies on what it already knows about SVG.
- **zpup:** write a zpup scene as JSON. The repository's [`llms.txt`](../llms.txt) is included as the reference.

The full instructions are in [`prompts/`](prompts). The two system prompts differ only where the format differs (the format name, "plain JSON, not TypeScript" against "no scripts or external resources", and the reference block). Both ask for a 400 by 400 picture that looks three-dimensional, and both ask for compact output without indentation or line breaks that are not needed. The token limit (`maxTokens`) and the optional `reasoning` setting are the same for both. The user message (`Draw this: <task>.`) and the repair message are shared. Every message actually sent is stored with the run, so the exact text of any request can be read back later.

## Metrics

**Valid on the first try.**

- SVG: the reply parses as namespace-well-formed XML (the same strictness a browser applies to an SVG file), the root element is `svg`, and it contains at least one element that paints (`path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `text`, `image`, `use` or `foreignObject`) outside `defs`, `clipPath`, `mask`, `pattern`, `symbol` and similar containers.
- zpup: the reply parses as JSON, `checkScene` reports no problems, `renderSvg` succeeds, and the compiled scene has at least one visible shape (the zpup counterpart of the SVG rule above).

Both formats get the same lenient extraction first: surrounding whitespace is dropped, and if the reply contains a Markdown code fence, the first fenced block is used. A fence is recorded as a warning, not a failure.

**Truncated.** A reply whose `finish_reason` is `length` was cut off at `maxTokens` (which includes hidden reasoning). It is counted on its own, as neither valid nor invalid, is left out of both validity percentages, and gets no repair: a parse error at the cut tells the model nothing about the format, and asking again does not make it write less. The summary has a column for it and the gallery marks it.

**Valid after one repair.** When the first try is invalid (and not truncated), the problems are sent back verbatim (for SVG, the parser's errors with line and column; for zpup, the list from `checkScene`), together with the model's own reply, and the model gets exactly one more try. This measures how useful each format's error messages are, which is part of what zpup claims to offer.

**Output tokens, reasoning tokens, latency and cost.** Taken from every first try that returned, truncated ones included (cost also includes the repair). Tokens and cost come from the `usage` block OpenRouter returns; cost falls back to the prices in `config.json` when the provider does not report one. Latency is wall-clock time for the HTTP call.

**Output size and reasoning.** The summary puts, side by side for each model, the median length in characters of the valid documents in each format and the median reasoning tokens of the first tries in each format. If a model reasons much longer for zpup than for SVG, it is spending effort on the unfamiliar format.

**Scene warnings.** Every valid zpup scene also goes through `checkSceneWarnings` (angles that look like radians, shapes entirely outside the image, solids that cannot be shaded). The summary counts them by kind and the gallery lists them under the picture. They do not affect validity.

**Rotation.** Every valid zpup scene is also rendered turned about the vertical axis by each offset in `rotationOffsetsDeg` (default +60° and -60°). An SVG has only the one angle it was drawn from. The gallery shows this side by side; it is a property of the format, not a score.

**Quality.** Not scored. `gallery.html` puts each model's SVG and zpup answers next to each other for every task, with a blind view that hides which is which (shown as X and Y in a per-pair shuffled order, one angle each, no error text). A vision-model judge may come later.

## Running it

Requires Node.js 22.18 or later. From the repository root:

```bash
pnpm bench --dry-run                  # the plan and a cost estimate; no calls
pnpm bench --provider mock            # the whole pipeline with canned replies; no network
pnpm bench:models                     # check model ids and prices against OpenRouter's public list
pnpm bench --provider openrouter      # real, paid calls; asks before starting
pnpm bench:report bench/results/<id>  # re-score a run and rebuild its summary and gallery
```

Useful options (see `node bench/run.ts --help`): `--tasks mug,rocket`, `--models openai/gpt-6-astra`, `--reps 1`, `--max-cost 2`, `--concurrency 2`, `--run-id <id>`, `--estimate-from bench/results/pilot-1`, `--yes`.

Reasoning is left to each model by default: no `reasoning` parameter is sent. To limit it, set `reasoning` in `config.json` to `{ "effort": "low" }` (OpenRouter accepts `max`, `xhigh`, `high`, `medium`, `low`, `minimal` and `none`) or to a token budget such as `{ "maxTokens": 8000 }`, not both; see OpenRouter's [reasoning tokens](https://openrouter.ai/docs/use-cases/reasoning-tokens) page. The same value goes to both formats. Reasoning counts against `maxTokens` and is billed as output.

A real run needs `OPENROUTER_API_KEY=...` in `.env` at the repository root (already git-ignored). The key is read from that file only, not from the environment, and is never printed or written to the results. Requests carry only the `Authorization` and `Content-Type` headers.

### Cost

Before anything runs, the script prints the number of calls and the cost it expects, plus a worst case in which every sample needs a repair and every call uses all `maxTokens`. With `--estimate-from <run dir>`, the expected cost of each model and format that ran there is that run's mean billed cost per sample (a repair that followed a truncated reply is left out, since none is sent now). Every other row rests on two assumptions in `config.json`: `estimate.outputTokensPerCall` (10,000, the mean of the first tries in pilot-1) and `estimate.repairRate`. A measured figure reflects the prompts and token limit of the run it came from.

`maxCostUsd` (default $10, or `--max-cost`) caps the run, and the run does not go over it. Before each call the harness reserves that call's worst case: all `maxTokens` of output and twice the rough prompt count, at the listed prices, times `reserveMargin` (default 1.5) or the highest ratio of billed cost to listed price seen so far for that model, whichever is larger. A call starts only if spent plus reserved plus its own reservation fits under the cap; otherwise it waits for calls in flight to settle, and the run stops when nothing is in flight and it still does not fit. The cap can be passed only by a call billed above its own reservation, which would take a provider charging more than `reserveMargin` times the listed price; the harness then logs a warning and reserves at that ratio from then on. The price of this guarantee is that the run stops with up to one worst-case reservation of the cap unspent (the dry run prints how much that is).

Samples are ordered so that any prefix of the plan covers tasks, models and formats evenly (within one pair of samples), and calls take reservations in that order, so a run cut short by the cap is still balanced. Re-running with the same `--run-id` resumes and skips samples already on disk.

## Results

Each run writes `bench/results/<run id>/`:

- `manifest.json`: provider, config, tasks, git commit, the sha256 of `llms.txt`, spend, and why the run stopped if it stopped early.
- `samples/*.json`: one file per (model, format, task, sample) with every message sent and every raw reply, token count, latency and cost.
- `summary.md`: tables by model and format, all models pooled, by task, the most common first-try problems, and warnings.
- `gallery.html`: the pictures. Every SVG, including model-written SVG, is embedded as an `<img>` data URI, so scripts and external references inside it never run.

The summary and gallery are generated from the raw samples, so changing the checker and running `pnpm bench:report` re-scores old runs. Mock runs (`mock-*`) are git-ignored.

## What the first real run showed

`pilot-1` (four tasks, Gemini 4 Argon and Kimi K3.1 Pro, one sample, a $1 cap, `maxTokens` 16,000) is kept in `results/pilot-1` and re-scored with the current rules. It showed:

- **The cap was passed** ($1.27 against $1): calls reserved an assumed 4,000 output tokens, while real first tries used 3,372 to 16,000 (median 8,382), and one provider billed up to 1.23 times the listed price. Calls now reserve their worst case.
- **Truncation looked like a format error.** Both failed zpup samples (Kimi, pelican and cat) were cut off at 16,000 tokens after about 12,000 to 15,000 tokens of reasoning, and were reported as JSON parse errors. `checkScene` found no problem in any reply. Truncation is now its own outcome, the limit is 32,000, and a truncated reply gets no repair (the pelican's repair was cut off again and cost $0.14).
- **Indentation was more than half of the output.** The valid zpup replies were 7,341 to 19,587 characters; the same scenes without whitespace are 2,434 to 9,698. Both prompts now ask for compact output.
- **The run order was not even:** the cap stopped it before any lighthouse sample. The order is now balanced in every prefix.
- **Kimi reasoned more for zpup** (median 12,000 reasoning tokens against 7,437 for SVG); Gemini reasoned little in either. The summary now shows this next to the output size.
- The request and response format matched OpenRouter (no API errors), the models used `cylinder`, `cone`, `hemisphere` and `box`, and the gallery drew every valid scene at three angles.

Twelve samples are far too few to say anything about which format is better.

## Limits

- **Sample size.** Twelve tasks times three samples is 36 samples per model and format. A difference of one or two samples is noise. The summary reports counts (`k/n`) next to percentages for that reason.
- **The conditions are not symmetric, and cannot be.** The zpup prompt carries about 1,500 tokens of reference that the SVG prompt does not, because models already know SVG and have never seen zpup. zpup's checker also gives richer repair messages than an XML parser. Both are what is being tested, but they mean the result compares "SVG as models know it" with "zpup as documented", not two formats on equal footing.
- **Truncation is not scored, and that can flatter a format.** A format that makes a model reason or write until it hits the limit loses those samples from the validity percentages instead of failing them. Read the Truncated column next to them, and the reasoning-token medians.
- **The token limit and reasoning setting shape the result.** With `maxTokens` too low, reasoning models are cut off; limiting reasoning would make them weaker. The defaults (32,000 tokens, each model's own reasoning) aim for neither, and are the same for both formats.
- **Validity is not quality.** A valid reply can be an ugly or unrecognizable picture, and an SVG check is looser than a zpup check: any well-formed SVG with one shape passes, while zpup's validator rejects typos and unknown options that SVG would silently ignore. Look at the gallery before drawing conclusions.
- **The blind view is only partly blind.** zpup's round, flat style is recognizable.
- **Prompt sensitivity.** The results hold for these prompts. Different wording, a different canvas size or a different view angle could change them.
- **Run-to-run variation.** No temperature is set (several of these models do not accept one), and OpenRouter may route a model to different upstream hosts. Repeat runs will differ.
- **Prices and model ids change.** They were checked on 2026-11-16; run `pnpm bench:models` before a real run.
- **Mock numbers mean nothing.** The mock provider exists to test the pipeline; its replies are canned, and some are broken on purpose.
