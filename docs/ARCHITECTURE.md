# Architecture

Rill is a static site: plain ES modules, no bundler, no build step. Everything runs in the browser.

```
index.html ── js/app.js (UI controller)
               ├─ js/core/engine.js ──► Web Worker: js/core/llm-worker.js
               │                         └─ Transformers.js + ONNX Runtime Web (WebGPU, or WASM fallback)
               ├─ js/core/agent.js     agent loop, plan runner
               │    ├─ js/core/prompt.js      system, step and summary prompts
               │    ├─ js/core/toolcalls.js   parses LFM3 output (thinking, XML tool calls)
               │    └─ js/tools/index.js      tool schemas and dispatch
               │         ├─ run-js.js ──► sandbox.html (sandboxed iframe) ──► Worker per run
               │         ├─ research.js   Wikipedia API, optional reader proxy
               │         └─ files.js      PDF/text ingestion (pdf.js worker), chunk search
               ├─ js/core/store.js     IndexedDB (chats, plans, files, notes) + localStorage settings
               └─ js/ui/markdown.js, dom.js   safe rendering
```

## Model worker (`js/core/llm-worker.js`)

- Loads `onnx-community/LFM3-1.7B-ONNX` with `AutoModelForCausalLM`. On WebGPU it uses `q4f16`
  if the adapter has `shader-f16`, otherwise `q4`. The CPU fallback uses `q4`.
- Two ONNX Runtime builds ship in `vendor/ort/`: the *asyncify* build has the WebGPU execution
  provider, and the *plain* build has the complete CPU kernel set. The q4 graph uses
  `GatherBlockQuantized`, which the asyncify build only implements on WebGPU, so the worker picks
  the build per device.
- **Chunked prefill.** The ONNX export asks for prompts to be fed in chunks of 256 tokens or fewer.
  The worker runs `model.forward` chunk by chunk into a `DynamicCache` and reports prefill progress to the UI.
- **Prefix cache.** LFM3 is a hybrid model (convolution plus attention), so its cache is a recurrent
  state that can't be cut back to an earlier position. The worker keeps the cache only when the new
  prompt *starts with* exactly the tokens already in it (the normal case in an agent loop, where each
  round appends tool results). Then it prefills only the new tokens. Otherwise it starts again.
  This was checked against plain `generate()` in Node: the chunked and cached path produced identical output.
- Generation streams through `TextStreamer`. `InterruptableStoppingCriteria` handles Stop.

## Tool calls (`js/core/toolcalls.js`)

LFM3's chat template renders tools in a Qwen-style XML format:

```
<tool_call>
<function=run_js>
<parameter=code>
console.log(0.175 * 2349.8)
</parameter>
</function>
</tool_call>
```

`parseAssistant()` turns raw output into `{ thinking, content, toolCalls, pendingCall }`. It
converts parameters to the schema's types (arrays, integers, booleans), accepts JSON-shaped calls
as a fallback, and hides half-streamed tags so the user never sees `<tool_c` flicker by.
Thinking (`<think>…</think>`) is off by default and can be turned on in Settings. When it is on,
the reasoning appears in a collapsible "Thinking" section.

## Agent loop (`js/core/agent.js`)

`Agent.turn()`: generate → parse → run tools → append results as `tool` messages → generate again,
for at most 6 rounds. On the last round the tools are removed so the model has to answer.
History is trimmed to about 14k characters, dropping the oldest turns and never starting in the middle of a tool exchange.

### Plans and long tasks

`create_plan` stores a plan (`{ title, goal, steps[] }`) in IndexedDB and shows a progress card.
With **Auto-run plans** on (the default), `Agent.runPlan()` works through the steps:

1. Each step runs as its own short conversation: the system prompt, the plan with `[x]`/`[>]`/`[ ]`
   markers, the results of the last few steps, and "Now do step N". This keeps the context small,
   which matters for a 1.7B model, so a 40-step plan works as well as a 4-step one.
2. Each step can use any tool except `create_plan`. Its final text becomes the step's `result`.
3. The plan is saved after every step. If the tab is closed or reloaded mid-run, the plan is marked
   paused at the next start, and **Resume** continues from the first unfinished step. Pause finishes the current step and then stops. Stop aborts generation straight away.
4. When every step is done, a summary turn writes the final answer.

## Files (`js/tools/files.js`)

Files are checked (extension allowlist, size, magic bytes, binary detection), then decoded. PDFs go
through pdf.js text extraction only. Text is split into ~1.8k-character chunks, and a small BM25
index ranks chunks for `search_files`. `read_file` returns a numbered part, so the model can work
through a long worksheet one part at a time.

## UI (`index.html`, `css/rill.css`, `js/app.js`)

- Three columns: a sidebar (new chat, Plans, Files, Notes, chats, model state), the conversation, and a
  panel with Plan, Files and Notes. The side columns become drawers on small screens.
- The supplied artwork fills the main area untouched. On the home screen one solid block (greeting,
  composer, starter tasks) sits on it. In a chat, the conversation is an opaque reading column set on
  the artwork, which stays visible in the margins on wide screens.
- The rules behind the look are in [DESIGN.md](DESIGN.md): flat surfaces, one typeface, one accent
  colour used for state only.

## Demo mode

`?mock` swaps in `js/core/mock-engine.js`, which streams scripted replies and tool calls. It runs the
whole UI and the real tools (sandbox, plans, files) without the 1 GB download. The e2e tests use it.
