# Zpup bench: run pilot-1

Provider: openrouter. Started 2026-11-16T09:14:30.288Z, finished 2026-11-16T09:22:19.165Z.
Commit: cdefbec. llms.txt sha256: a636d4f4b971.
Samples: 12. Spent: $1.2661 (cap $1).

**Stopped early:** cost cap of $1 reached after 12 of 16 samples.

"Valid" only means the reply parses and renders under the rules in bench/README.md. It says nothing about whether the picture is good; look at gallery.html for that.
"Truncated" counts first tries cut off at the output token limit (`finish_reason: "length"`, limit 16000 tokens including reasoning). They are neither valid nor invalid, are left out of both validity columns, and get no repair. "On repair" counts repairs that were cut off.
Token, reasoning and latency columns describe every first try that returned, truncated ones included. Cost includes the repair call.
"Valid after one repair" excludes samples whose repair was cut by the cost cap.

## By model and format

| Model / format | Samples | Valid on first try | Valid after one repair | Truncated | API errors | Median output tokens | Median reasoning tokens | Median latency (s) | Cost | Cost per sample |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Gemini 4 Argon / raw SVG | 3 | 3/3 (100%) | 3/3 (100%) | 0 | 0 | 8374 | 0 | 116.5 | $0.2407 | $0.0802 |
| Gemini 4 Argon / Zpup JSON | 3 | 3/3 (100%) | 3/3 (100%) | 0 | 0 | 6645 | 702 | 81.5 | $0.2018 | $0.0673 |
| Kimi K3.1 Pro / raw SVG | 3 | 3/3 (100%) | 3/3 (100%) | 0 | 0 | 12368 | 7437 | 86.0 | $0.3205 | $0.1068 |
| Kimi K3.1 Pro / Zpup JSON | 3 | 1/1 (100%) | 1/1 (100%) | 2 | 0 | 16000 | 12000 | 157.8 | $0.5032 | $0.1677 |

## All models pooled

| Model / format | Samples | Valid on first try | Valid after one repair | Truncated | API errors | Median output tokens | Median reasoning tokens | Median latency (s) | Cost | Cost per sample |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| raw SVG | 6 | 6/6 (100%) | 6/6 (100%) | 0 | 0 | 8484 | 2363 | 111.1 | $0.5611 | $0.0935 |
| Zpup JSON | 6 | 4/4 (100%) | 4/4 (100%) | 2 | 0 | 8322 | 3613 | 106.3 | $0.7050 | $0.1175 |

## Output size and reasoning

Median characters of the valid documents (the reply that passed, after code-fence extraction), and median reasoning tokens of every first try that returned, truncated ones included. A model that reasons much longer for Zpup than for SVG is spending effort on the unfamiliar format.

| Model | SVG chars | Zpup chars | SVG reasoning tokens | Zpup reasoning tokens |
| --- | ---: | ---: | ---: | ---: |
| Gemini 4 Argon | 17108 (n=3) | 19329 (n=3) | 0 (n=3) | 702 (n=3) |
| Kimi K3.1 Pro | 12805 (n=3) | 7905 (n=1) | 7437 (n=3) | 12000 (n=3) |
| All models | 14830 (n=6) | 13617 (n=4) | 2363 (n=6) | 3613 (n=6) |

## Turn errors

Each valid Zpup and Zdog scene is turned about the vertical axis to 12 views (its own view and every 30°), and each view is checked against a depth buffer on a grid of one point per pixel. A point is wrong when the shape painted last there is more than 1.5 px behind the shape that is really in front and the two have different colors. A sample's value is the share of covered points that are wrong, averaged over its views; "worst view" is its highest single view. SVG has one angle only and is not measured. See bench/README.md for what this does and does not catch.

| Model / format | Measured | Median | Mean | Above 1% | Median worst view |
| --- | ---: | ---: | ---: | ---: | ---: |
| Gemini 4 Argon / Zpup JSON | 3 | 3.19% | 2.16% | 2/3 (67%) | 4.76% |
| Kimi K3.1 Pro / Zpup JSON | 1 | 1.14% | 1.14% | 1/1 (100%) | 3.28% |
| All models / Zpup JSON | 4 | 2.17% | 1.91% | 3/4 (75%) | 4.02% |

The three samples with the highest mean in each format:

- Zpup JSON: cat (Gemini 4 Argon, sample 1): 3.27%, worst 5.88% at +30°; pelican-bicycle (Gemini 4 Argon, sample 1): 3.19%, worst 4.76% at +150°; mug (Kimi K3.1 Pro, sample 1): 1.14%, worst 3.28% at +330°

## By task

Each cell: valid on first try, then after one repair, out of the samples that were not truncated. "+1 cut" means one more sample was truncated.

| Task | Gemini 4 Argon svg | Gemini 4 Argon zpup | Kimi K3.1 Pro svg | Kimi K3.1 Pro zpup |
| --- | ---: | ---: | ---: | ---: |
| pelican-bicycle | 1→1/1 | 1→1/1 | 1→1/1 | 0→0/0 +1 cut |
| mug | 1→1/1 | 1→1/1 | 1→1/1 | 1→1/1 |
| cat | 1→1/1 | 1→1/1 | 1→1/1 | 0→0/0 +1 cut |
| lighthouse | - | - | - | - |

## Most common problems on the first try

### raw SVG

None.

### Zpup JSON

None.

## Scene warnings (Zpup only, do not affect validity)

What `checkSceneWarnings` reports for each valid Zpup scene: angles that look like radians, shapes entirely outside the image, solids whose color cannot be shaded, and shapes of different colors that pass through each other. Each cell counts scenes with at least one warning of that kind, out of the valid scenes.

| Kind | Gemini 4 Argon | Kimi K3.1 Pro | All models |
| --- | ---: | ---: | ---: |
| shapes pass through each other | 3/3 | 1/1 | 4/4 |

## Other warnings (do not affect validity)

- raw SVG: none
- Zpup JSON: none
