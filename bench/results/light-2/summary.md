# Zpup bench: run light-2

Provider: openrouter. Started 2026-11-17T03:06:58.867Z, finished 2026-11-17T03:10:27.070Z.
Commit: d3898d0. llms.txt sha256: c5c6701fcdb6.
Samples: 72. Spent: $0.1003 (cap $1).

"Valid" only means the reply parses and renders under the rules in bench/README.md. It says nothing about whether the picture is good; look at gallery.html for that.
"Truncated" counts first tries cut off at the output token limit (`finish_reason: "length"`, limit 32000 tokens including reasoning). They are neither valid nor invalid, are left out of both validity columns, and get no repair. "On repair" counts repairs that were cut off.
Token, reasoning and latency columns describe every first try that returned, truncated ones included. Cost includes the repair call.
"Valid after one repair" excludes samples whose repair was cut by the cost cap.

## By model and format

| Model / format | Samples | Valid on first try | Valid after one repair | Truncated | API errors | Median output tokens | Median reasoning tokens | Median latency (s) | Cost | Cost per sample |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Claude Haiku 5.5 / raw SVG | 24 | 24/24 (100%) | 24/24 (100%) | 0 | 0 | 2045 | 656 | 9.5 | $0.0235 | $0.0010 |
| Claude Haiku 5.5 / Zdog script | 24 | 24/24 (100%) | 24/24 (100%) | 0 | 0 | 2996 | 1940 | 14.2 | $0.0385 | $0.0016 |
| Claude Haiku 5.5 / Zpup JSON | 24 | 23/24 (96%) | 24/24 (100%) | 0 | 0 | 2224 | 1563 | 11.0 | $0.0383 | $0.0016 |

## All models pooled

| Model / format | Samples | Valid on first try | Valid after one repair | Truncated | API errors | Median output tokens | Median reasoning tokens | Median latency (s) | Cost | Cost per sample |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| raw SVG | 24 | 24/24 (100%) | 24/24 (100%) | 0 | 0 | 2045 | 656 | 9.5 | $0.0235 | $0.0010 |
| Zdog script | 24 | 24/24 (100%) | 24/24 (100%) | 0 | 0 | 2996 | 1940 | 14.2 | $0.0385 | $0.0016 |
| Zpup JSON | 24 | 23/24 (96%) | 24/24 (100%) | 0 | 0 | 2224 | 1563 | 11.0 | $0.0383 | $0.0016 |

## Output size and reasoning

Median characters of the valid documents (the reply that passed, after code-fence extraction), and median reasoning tokens of every first try that returned, truncated ones included. A model that reasons much longer for Zpup than for SVG is spending effort on the unfamiliar format.

| Model | SVG chars | Zdog chars | Zpup chars | SVG reasoning tokens | Zdog reasoning tokens | Zpup reasoning tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Claude Haiku 5.5 | 2371 (n=24) | 1174 (n=24) | 910 (n=24) | 656 (n=24) | 1940 (n=24) | 1563 (n=24) |
| All models | 2371 (n=24) | 1174 (n=24) | 910 (n=24) | 656 (n=24) | 1940 (n=24) | 1563 (n=24) |

## Turn errors

Each valid Zpup and Zdog scene is turned about the vertical axis to 12 views (its own view and every 30°), and each view is checked against a depth buffer on a grid of one point per pixel. A point is wrong when the shape painted last there is more than 1.5 px behind the shape that is really in front and the two have different colors. A sample's value is the share of covered points that are wrong, averaged over its views; "worst view" is its highest single view. SVG has one angle only and is not measured. See bench/README.md for what this does and does not catch.

| Model / format | Measured | Median | Mean | Above 1% | Median worst view |
| --- | ---: | ---: | ---: | ---: | ---: |
| Claude Haiku 5.5 / Zdog script | 24 | 4.21% | 7.74% | 24/24 (100%) | 8.85% |
| Claude Haiku 5.5 / Zpup JSON | 24 | 0.30% | 0.50% | 5/24 (21%) | 0.70% |

The three samples with the highest mean in each format:

- Zdog script: robot (Claude Haiku 5.5, sample 1): 33.51%, worst 51.59% at +240°; teapot (Claude Haiku 5.5, sample 2): 21.49%, worst 27.84% at +270°; house (Claude Haiku 5.5, sample 1): 17.57%, worst 26.79% at +90°
- Zpup JSON: cat (Claude Haiku 5.5, sample 2): 1.59%, worst 2.84% at +300°; tree (Claude Haiku 5.5, sample 2): 1.29%, worst 3.34% at +300°; house (Claude Haiku 5.5, sample 1): 1.22%, worst 2.74% at +120°

12 painted elements (summed over all views) could not be modeled and were left out; see bench/README.md.

## By task

Each cell: valid on first try, then after one repair, out of the samples that were not truncated. "+1 cut" means one more sample was truncated.

| Task | Claude Haiku 5.5 svg | Claude Haiku 5.5 zdog | Claude Haiku 5.5 zpup |
| --- | ---: | ---: | ---: |
| pelican-bicycle | 2→2/2 | 2→2/2 | 1→2/2 |
| mug | 2→2/2 | 2→2/2 | 2→2/2 |
| rocket | 2→2/2 | 2→2/2 | 2→2/2 |
| cat | 2→2/2 | 2→2/2 | 2→2/2 |
| lighthouse | 2→2/2 | 2→2/2 | 2→2/2 |
| robot | 2→2/2 | 2→2/2 | 2→2/2 |
| tree | 2→2/2 | 2→2/2 | 2→2/2 |
| house | 2→2/2 | 2→2/2 | 2→2/2 |
| sailboat | 2→2/2 | 2→2/2 | 2→2/2 |
| snowman | 2→2/2 | 2→2/2 | 2→2/2 |
| octopus | 2→2/2 | 2→2/2 | 2→2/2 |
| teapot | 2→2/2 | 2→2/2 | 2→2/2 |

## Most common problems on the first try

### raw SVG

None.

### Zdog script

None.

### Zpup JSON

- 1× JSON parse error: Expected property name or '}' in JSON at position 201 (line 1 column 202)

## Scene warnings (Zpup only, do not affect validity)

What `checkSceneWarnings` reports for each valid Zpup scene: angles that look like radians, shapes entirely outside the image, solids whose color cannot be shaded, and shapes of different colors that pass through each other. Each cell counts scenes with at least one warning of that kind, out of the valid scenes.

| Kind | Claude Haiku 5.5 | All models |
| --- | ---: | ---: |
| shapes pass through each other | 12/24 | 12/24 |

## Other warnings (do not affect validity)

- raw SVG: none
- Zdog script: 11× The reply was wrapped in a Markdown code fence.
- Zpup JSON: none
