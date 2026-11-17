# Zpup bench: run light-1

Provider: openrouter. Started 2026-11-17T01:08:28.798Z, finished 2026-11-17T01:12:08.558Z.
Commit: d3898d0. llms.txt sha256: 4959cac30061.
Samples: 72. Spent: $0.1108 (cap $1).

"Valid" only means the reply parses and renders under the rules in bench/README.md. It says nothing about whether the picture is good; look at gallery.html for that.
"Truncated" counts first tries cut off at the output token limit (`finish_reason: "length"`, limit 32000 tokens including reasoning). They are neither valid nor invalid, are left out of both validity columns, and get no repair. "On repair" counts repairs that were cut off.
Token, reasoning and latency columns describe every first try that returned, truncated ones included. Cost includes the repair call.
"Valid after one repair" excludes samples whose repair was cut by the cost cap.

## By model and format

| Model / format | Samples | Valid on first try | Valid after one repair | Truncated | API errors | Median output tokens | Median reasoning tokens | Median latency (s) | Cost | Cost per sample |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Claude Haiku 5.5 / raw SVG | 24 | 24/24 (100%) | 24/24 (100%) | 0 | 0 | 2139 | 737 | 10.6 | $0.0252 | $0.0011 |
| Claude Haiku 5.5 / Zdog script | 24 | 23/24 (96%) | 24/24 (100%) | 0 | 0 | 2450 | 1792 | 12.2 | $0.0382 | $0.0016 |
| Claude Haiku 5.5 / Zpup JSON | 24 | 23/24 (96%) | 24/24 (100%) | 0 | 0 | 2034 | 1296 | 9.9 | $0.0473 | $0.0020 |

## All models pooled

| Model / format | Samples | Valid on first try | Valid after one repair | Truncated | API errors | Median output tokens | Median reasoning tokens | Median latency (s) | Cost | Cost per sample |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| raw SVG | 24 | 24/24 (100%) | 24/24 (100%) | 0 | 0 | 2139 | 737 | 10.6 | $0.0252 | $0.0011 |
| Zdog script | 24 | 23/24 (96%) | 24/24 (100%) | 0 | 0 | 2450 | 1792 | 12.2 | $0.0382 | $0.0016 |
| Zpup JSON | 24 | 23/24 (96%) | 24/24 (100%) | 0 | 0 | 2034 | 1296 | 9.9 | $0.0473 | $0.0020 |

## Output size and reasoning

Median characters of the valid documents (the reply that passed, after code-fence extraction), and median reasoning tokens of every first try that returned, truncated ones included. A model that reasons much longer for Zpup than for SVG is spending effort on the unfamiliar format.

| Model | SVG chars | Zdog chars | Zpup chars | SVG reasoning tokens | Zdog reasoning tokens | Zpup reasoning tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Claude Haiku 5.5 | 2399 (n=24) | 1220 (n=24) | 886 (n=24) | 737 (n=24) | 1792 (n=24) | 1296 (n=24) |
| All models | 2399 (n=24) | 1220 (n=24) | 886 (n=24) | 737 (n=24) | 1792 (n=24) | 1296 (n=24) |

## Turn errors

Each valid Zpup and Zdog scene is turned about the vertical axis to 12 views (its own view and every 30°), and each view is checked against a depth buffer on a grid of one point per pixel. A point is wrong when the shape painted last there is more than 1.5 px behind the shape that is really in front and the two have different colors. A sample's value is the share of covered points that are wrong, averaged over its views; "worst view" is its highest single view. SVG has one angle only and is not measured. See bench/README.md for what this does and does not catch.

| Model / format | Measured | Median | Mean | Above 1% | Median worst view |
| --- | ---: | ---: | ---: | ---: | ---: |
| Claude Haiku 5.5 / Zdog script | 24 | 2.86% | 6.67% | 19/24 (79%) | 6.14% |
| Claude Haiku 5.5 / Zpup JSON | 24 | 0.36% | 0.76% | 5/24 (21%) | 1.08% |

The three samples with the highest mean in each format:

- Zdog script: robot (Claude Haiku 5.5, sample 1): 36.73%, worst 52.93% at +240°; teapot (Claude Haiku 5.5, sample 2): 23.55%, worst 28.15% at +30°; lighthouse (Claude Haiku 5.5, sample 2): 15.93%, worst 17.21% at +330°
- Zpup JSON: tree (Claude Haiku 5.5, sample 2): 4.63%, worst 14.60% at +330°; rocket (Claude Haiku 5.5, sample 1): 2.12%, worst 4.05% at +30°; rocket (Claude Haiku 5.5, sample 2): 1.79%, worst 6.79% at +150°

12 painted elements (summed over all views) could not be modeled and were left out; see bench/README.md.

## By task

Each cell: valid on first try, then after one repair, out of the samples that were not truncated. "+1 cut" means one more sample was truncated.

| Task | Claude Haiku 5.5 svg | Claude Haiku 5.5 zdog | Claude Haiku 5.5 zpup |
| --- | ---: | ---: | ---: |
| pelican-bicycle | 2→2/2 | 2→2/2 | 2→2/2 |
| mug | 2→2/2 | 2→2/2 | 2→2/2 |
| rocket | 2→2/2 | 2→2/2 | 2→2/2 |
| cat | 2→2/2 | 2→2/2 | 2→2/2 |
| lighthouse | 2→2/2 | 2→2/2 | 2→2/2 |
| robot | 2→2/2 | 2→2/2 | 2→2/2 |
| tree | 2→2/2 | 1→2/2 | 2→2/2 |
| house | 2→2/2 | 2→2/2 | 1→2/2 |
| sailboat | 2→2/2 | 2→2/2 | 2→2/2 |
| snowman | 2→2/2 | 2→2/2 | 2→2/2 |
| octopus | 2→2/2 | 2→2/2 | 2→2/2 |
| teapot | 2→2/2 | 2→2/2 | 2→2/2 |

## Most common problems on the first try

### raw SVG

None.

### Zdog script

- 1× SyntaxError: Unexpected token '<'

### Zpup JSON

- 1× scene.children[0].diameter: expected either "diameter" or "width" and "height", not both, received 260. Remove "diameter", or remove "width" and "height".

## Scene warnings (Zpup only, do not affect validity)

What `checkSceneWarnings` reports for each valid Zpup scene: angles that look like radians, shapes entirely outside the image, solids whose color cannot be shaded, and shapes of different colors that pass through each other. Each cell counts scenes with at least one warning of that kind, out of the valid scenes.

| Kind | Claude Haiku 5.5 | All models |
| --- | ---: | ---: |
| shapes pass through each other | 7/24 | 7/24 |

## Other warnings (do not affect validity)

- raw SVG: none
- Zdog script: 11× The reply was wrapped in a Markdown code fence.
- Zpup JSON: none
