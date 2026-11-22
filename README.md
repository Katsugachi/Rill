# Rill

A web based private assistant for everyday tasks that runs **entirely in your browser**.
Rill is powered by [LiquidAI LFM3-1.7B](https://huggingface.co/LiquidAI/LFM3-1.7B)
(the [ONNX build](https://huggingface.co/onnx-community/LFM3-1.7B-ONNX)) on **WebGPU**
through [Transformers.js](https://github.com/huggingface/transformers.js).


## Live Demo
https://katsugachi.github.io/Rill/
## What it can do
|---|---|
| **Read your files** | Drop in PDFs, text, Markdown, CSV, JSON or code. Rill indexes them locally and searches them when you ask. |
| **Do maths properly** | Every calculation runs as JavaScript in a locked-down sandbox, so numbers are computed rather than guessed. |
| **Research** | Searches and reads Wikipedia. Optionally reads any public web page through a reader proxy (off by default). |
| **Plan and then do** | Turns a goal into a checklist or roadmap, then works through every step on its own, saving progress as it goes. Pause, resume or stop at any time, even after a reload. |
| **Remember** | Saves notes you ask it to keep and includes them in later chats. |

Everything (chats, files, plans, notes) stays in your browser's IndexedDB. The model downloads
once (about 1 GB for the WebGPU build) and is cached.

## Requirements

- A browser with WebGPU: Chrome or Edge 113+, or a recent Safari/Firefox with WebGPU enabled.
- About 2 GB of free GPU memory. GPUs with `shader-f16` get the faster `q4f16` weights.
- No WebGPU? Rill can run on the CPU (WASM) with `q4` weights (~1.3 GB). It works, but it is slow.

## Run locally

Rill is static files with no build step. Any static server works:

```bash
python3 -m http.server 8080
# open http://localhost:8080/          real model
# open http://localhost:8080/?mock     demo mode: scripted replies, no download
```

Opening `index.html` from `file://` won't work, because module workers need HTTP.

## Tests

```bash
node --test tests/*.test.mjs                  # unit tests: tool-call parser, files, agent
python3 -m http.server 8080 &
python3 tests/e2e.py                          # Playwright e2e in demo mode (sandbox, XSS, plans, uploads, mobile)
```

The e2e script needs `pip install playwright` and a Chromium (set `CHROME=/path/to/chrome` to use your own).

## Docs

- [Architecture](docs/ARCHITECTURE.md): how the agent loop, model worker, tools and UI fit together.
- [Security audit](docs/SECURITY.md): threat model, XSS review, sandbox design and residual risks.
- [Deployment](docs/DEPLOY.md): GitHub Pages and other static hosts.
- [Design](docs/DESIGN.md): the interface rules and the critique rounds behind them.
- [Design notes and improvements](docs/IMPROVEMENTS.md): decisions made along the way and what to do next.

## Credits

- Model: LiquidAI LFM3-1.7B (LFM Open License v1.0). Weights are downloaded from Hugging Face at runtime and are not stored in this repo.
- Vendored: Transformers.js 4.3.2 (Apache-2.0), ONNX Runtime Web 1.31 dev (MIT), pdf.js 5.4 (Apache-2.0), Inter (OFL).
- Personality follows the publicly shared prompt guidelines of [Poke](https://poke.com) by The Interaction Company, minus the parts about messaging apps, email and background agents.
