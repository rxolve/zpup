# zpup bench: run light-1

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
| Claude Haiku 5.5 / zpup JSON | 24 | 12/24 (50%) | 24/24 (100%) | 0 | 0 | 2034 | 1296 | 9.9 | $0.0473 | $0.0020 |

## All models pooled

| Model / format | Samples | Valid on first try | Valid after one repair | Truncated | API errors | Median output tokens | Median reasoning tokens | Median latency (s) | Cost | Cost per sample |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| raw SVG | 24 | 24/24 (100%) | 24/24 (100%) | 0 | 0 | 2139 | 737 | 10.6 | $0.0252 | $0.0011 |
| Zdog script | 24 | 23/24 (96%) | 24/24 (100%) | 0 | 0 | 2450 | 1792 | 12.2 | $0.0382 | $0.0016 |
| zpup JSON | 24 | 12/24 (50%) | 24/24 (100%) | 0 | 0 | 2034 | 1296 | 9.9 | $0.0473 | $0.0020 |

## Output size and reasoning

Median characters of the valid documents (the reply that passed, after code-fence extraction), and median reasoning tokens of every first try that returned, truncated ones included. A model that reasons much longer for zpup than for SVG is spending effort on the unfamiliar format.

| Model | SVG chars | Zdog chars | zpup chars | SVG reasoning tokens | Zdog reasoning tokens | zpup reasoning tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Claude Haiku 5.5 | 2399 (n=24) | 1220 (n=24) | 892 (n=24) | 737 (n=24) | 1792 (n=24) | 1296 (n=24) |
| All models | 2399 (n=24) | 1220 (n=24) | 892 (n=24) | 737 (n=24) | 1792 (n=24) | 1296 (n=24) |

## By task

Each cell: valid on first try, then after one repair, out of the samples that were not truncated. "+1 cut" means one more sample was truncated.

| Task | Claude Haiku 5.5 svg | Claude Haiku 5.5 zdog | Claude Haiku 5.5 zpup |
| --- | ---: | ---: | ---: |
| pelican-bicycle | 2→2/2 | 2→2/2 | 0→2/2 |
| mug | 2→2/2 | 2→2/2 | 2→2/2 |
| rocket | 2→2/2 | 2→2/2 | 0→2/2 |
| cat | 2→2/2 | 2→2/2 | 1→2/2 |
| lighthouse | 2→2/2 | 2→2/2 | 2→2/2 |
| robot | 2→2/2 | 2→2/2 | 0→2/2 |
| tree | 2→2/2 | 1→2/2 | 2→2/2 |
| house | 2→2/2 | 2→2/2 | 1→2/2 |
| sailboat | 2→2/2 | 2→2/2 | 2→2/2 |
| snowman | 2→2/2 | 2→2/2 | 1→2/2 |
| octopus | 2→2/2 | 2→2/2 | 0→2/2 |
| teapot | 2→2/2 | 2→2/2 | 1→2/2 |

## Most common problems on the first try

### raw SVG

None.

### Zdog script

- 1× SyntaxError: Unexpected token '<'

### zpup JSON

- 27× scene.children[3].type: expected one of "group", "path", "ellipse", "rect", "polygon", "box", "cylinder", "cone", "hemisphere", received "dot". For a dot use { "type": "path", "path": [{}], "stroke": 20 }.
- 16× scene.children[2].children[0].type: expected one of "group", "path", "ellipse", "rect", "polygon", "box", "cylinder", "cone", "hemisphere", received "dot". For a dot use { "type": "path", "path": [{}], "stroke": 20 }.
- 1× scene.children[0].diameter: expected either "diameter" or "width" and "height", not both, received 260. Remove "diameter", or remove "width" and "height".

## Scene warnings (zpup only, do not affect validity)

What `checkSceneWarnings` reports for each valid zpup scene: angles that look like radians, shapes entirely outside the image, and solids whose color cannot be shaded. Each cell counts scenes with at least one warning of that kind, out of the valid scenes.

None (24 valid scenes).

## Other warnings (do not affect validity)

- raw SVG: none
- Zdog script: 11× The reply was wrapped in a Markdown code fence.
- zpup JSON: none
