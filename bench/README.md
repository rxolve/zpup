# zpup bench

Does a language model draw better with zpup than with raw SVG? This benchmark asks the same models for the same pictures in both formats and records what comes back. That zpup comes out ahead is a hypothesis, not a result: the harness is built so that a bad outcome for zpup shows up just as clearly as a good one.

Nothing in this directory is part of the npm package (`package.json` publishes only `dist`, `llms.txt`, `README.md` and `LICENSE`).

## What it does

For every task in [`tasks.json`](tasks.json) (twelve drawing requests, including "a pelican riding a bicycle"), every model in [`config.json`](config.json), and each of `repetitions` samples (default 3), the model is asked twice:

- **SVG:** write a standalone SVG document. No reference material is given; the model relies on what it already knows about SVG.
- **zpup:** write a zpup scene as JSON. The repository's [`llms.txt`](../llms.txt) is included as the reference.

The full instructions are in [`prompts/`](prompts). The two system prompts differ only where the format differs (the format name, "plain JSON, not TypeScript" against "no scripts or external resources", and the reference block). Both ask for a 400 by 400 picture that looks three-dimensional. The user message (`Draw this: <task>.`) and the repair message are shared. Every message actually sent is stored with the run, so the exact text of any request can be read back later.

## Metrics

**Valid on the first try.**

- SVG: the reply parses as namespace-well-formed XML (the same strictness a browser applies to an SVG file), the root element is `svg`, and it contains at least one element that paints (`path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `text`, `image`, `use` or `foreignObject`) outside `defs`, `clipPath`, `mask`, `pattern`, `symbol` and similar containers.
- zpup: the reply parses as JSON, `checkScene` reports no problems, `renderSvg` succeeds, and the compiled scene has at least one visible shape (the zpup counterpart of the SVG rule above).

Both formats get the same lenient extraction first: surrounding whitespace is dropped, and if the reply contains a Markdown code fence, the first fenced block is used. A fence is recorded as a warning, not a failure.

**Valid after one repair.** When the first try is invalid, the problems are sent back verbatim (for SVG, the parser's errors with line and column; for zpup, the list from `checkScene`), together with the model's own reply, and the model gets exactly one more try. This measures how useful each format's error messages are, which is part of what zpup claims to offer.

**Output tokens, reasoning tokens, latency and cost.** Taken from the first try (cost also includes the repair). Tokens and cost come from the `usage` block OpenRouter returns; cost falls back to the prices in `config.json` when the provider does not report one. Latency is wall-clock time for the HTTP call.

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

Useful options (see `node bench/run.ts --help`): `--tasks mug,rocket`, `--models openai/gpt-6-astra`, `--reps 1`, `--max-cost 2`, `--concurrency 2`, `--run-id <id>`, `--yes`.

A real run needs `OPENROUTER_API_KEY=...` in `.env` at the repository root (already git-ignored). The key is read from that file only, not from the environment, and is never printed or written to the results. Requests carry only the `Authorization` and `Content-Type` headers.

### Cost

Before anything runs, the script prints the number of calls and the cost it expects, plus a worst case in which every sample needs a repair and every call uses all `maxTokens`. The expected figure rests on two assumptions in `config.json` (`estimate.outputTokensPerCall` and `estimate.repairRate`); the reasoning models here spend most of their output on hidden reasoning, so treat it as an order of magnitude.

`maxCostUsd` (default $10, or `--max-cost`) caps the run. Before each call the harness reserves that call's expected cost and stops starting new calls once spent plus reserved would pass the cap, so the last calls in flight can overshoot it slightly. Samples are ordered sample by sample across all tasks, models and formats, so a run cut short still covers everything evenly. Re-running with the same `--run-id` resumes and skips samples already on disk.

## Results

Each run writes `bench/results/<run id>/`:

- `manifest.json`: provider, config, tasks, git commit, the sha256 of `llms.txt`, spend, and why the run stopped if it stopped early.
- `samples/*.json`: one file per (model, format, task, sample) with every message sent and every raw reply, token count, latency and cost.
- `summary.md`: tables by model and format, all models pooled, by task, the most common first-try problems, and warnings.
- `gallery.html`: the pictures. Every SVG, including model-written SVG, is embedded as an `<img>` data URI, so scripts and external references inside it never run.

The summary and gallery are generated from the raw samples, so changing the checker and running `pnpm bench:report` re-scores old runs. Mock runs (`mock-*`) are git-ignored.

## Limits

- **Sample size.** Twelve tasks times three samples is 36 samples per model and format. A difference of one or two samples is noise. The summary reports counts (`k/n`) next to percentages for that reason.
- **The conditions are not symmetric, and cannot be.** The zpup prompt carries about 1,500 tokens of reference that the SVG prompt does not, because models already know SVG and have never seen zpup. zpup's checker also gives richer repair messages than an XML parser. Both are what is being tested, but they mean the result compares "SVG as models know it" with "zpup as documented", not two formats on equal footing.
- **Validity is not quality.** A valid reply can be an ugly or unrecognizable picture, and an SVG check is looser than a zpup check: any well-formed SVG with one shape passes, while zpup's validator rejects typos and unknown options that SVG would silently ignore. Look at the gallery before drawing conclusions.
- **The blind view is only partly blind.** zpup's round, flat style is recognizable.
- **Prompt sensitivity.** The results hold for these prompts. Different wording, a different canvas size or a different view angle could change them.
- **Run-to-run variation.** No temperature is set (several of these models do not accept one), and OpenRouter may route a model to different upstream hosts. Repeat runs will differ.
- **Prices and model ids change.** They were checked on 2026-11-16; run `pnpm bench:models` before a real run.
- **Mock numbers mean nothing.** The mock provider exists to test the pipeline; its replies are canned, and some are broken on purpose.
