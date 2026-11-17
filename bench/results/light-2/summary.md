# zpup bench: run light-2

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
| Claude Haiku 5.5 / zpup JSON | 24 | 23/24 (96%) | 24/24 (100%) | 0 | 0 | 2224 | 1563 | 11.0 | $0.0383 | $0.0016 |

## All models pooled

| Model / format | Samples | Valid on first try | Valid after one repair | Truncated | API errors | Median output tokens | Median reasoning tokens | Median latency (s) | Cost | Cost per sample |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| raw SVG | 24 | 24/24 (100%) | 24/24 (100%) | 0 | 0 | 2045 | 656 | 9.5 | $0.0235 | $0.0010 |
| Zdog script | 24 | 24/24 (100%) | 24/24 (100%) | 0 | 0 | 2996 | 1940 | 14.2 | $0.0385 | $0.0016 |
| zpup JSON | 24 | 23/24 (96%) | 24/24 (100%) | 0 | 0 | 2224 | 1563 | 11.0 | $0.0383 | $0.0016 |

## Output size and reasoning

Median characters of the valid documents (the reply that passed, after code-fence extraction), and median reasoning tokens of every first try that returned, truncated ones included. A model that reasons much longer for zpup than for SVG is spending effort on the unfamiliar format.

| Model | SVG chars | Zdog chars | zpup chars | SVG reasoning tokens | Zdog reasoning tokens | zpup reasoning tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Claude Haiku 5.5 | 2371 (n=24) | 1174 (n=24) | 910 (n=24) | 656 (n=24) | 1940 (n=24) | 1563 (n=24) |
| All models | 2371 (n=24) | 1174 (n=24) | 910 (n=24) | 656 (n=24) | 1940 (n=24) | 1563 (n=24) |

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

### zpup JSON

- 1× JSON parse error: Expected property name or '}' in JSON at position 201 (line 1 column 202)

## Scene warnings (zpup only, do not affect validity)

What `checkSceneWarnings` reports for each valid zpup scene: angles that look like radians, shapes entirely outside the image, and solids whose color cannot be shaded. Each cell counts scenes with at least one warning of that kind, out of the valid scenes.

None (24 valid scenes).

## Other warnings (do not affect validity)

- raw SVG: none
- Zdog script: 11× The reply was wrapped in a Markdown code fence.
- zpup JSON: none
