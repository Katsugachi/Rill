# Design notes and improvements

Decisions made while building Rill, problems found along the way, and what to do next.

## Decisions

- **The ONNX build of LFM3, not the original weights.** `LiquidAI/LFM3-1.7B` is a PyTorch
  checkpoint. Browsers need ONNX, so Rill loads `onnx-community/LFM3-1.7B-ONNX`, which is the same model
  exported and quantised. `q4f16` (about 1 GB) is the best fit for WebGPU.
- **No build step.** Plain ES modules and vendored libraries keep the Pages deploy trivial and the
  supply chain small. The cost is a slightly larger first load than a bundled, tree-shaken build.
- **The model's native XML tool format.** LFM3's template renders tools in its own XML style.
  Prompting it to write JSON instead would fight its training. The parser reads XML first and accepts JSON as a fallback.
- **Thinking off by default.** For a 1.7B model, `<think>` often doubles the tokens without making
  everyday tasks better. It is a toggle in Settings for harder problems.
- **One short conversation per plan step.** LFM3 supports a 256K context, but small models lose
  focus long before that, and prefill on a laptop GPU costs real time. Each step sees only the plan
  and the last few results. That is what makes very long plans reliable.
- **Prefix-cache reuse instead of re-prefilling.** In an agent loop each round only appends tool
  output, so the worker keeps the hybrid cache when the new prompt extends the old one. This cuts the
  time to first token after a tool call from "re-read everything" to "read the new part".
- **Our own Markdown renderer instead of marked + DOMPurify.** A sanitiser is only as good as its
  configuration, and Trusted Types would block the HTML string anyway. Building DOM nodes directly
  removes the whole class of bug. The renderer covers what a chat needs: headings, lists, checklists,
  code, tables, quotes and links.
- **Wikipedia for research.** It is the only good, keyless, CORS-enabled search a static site can
  call directly. Reading any page needs a proxy, so that is opt-in and explained in Settings.
- **Personality.** Follows Poke's published guidelines section by section: warmth, wit, conciseness,
  adaptiveness and a human texting voice, including its banned phrases and its rules on jokes, emojis
  and matching the user's length. The parts about iMessage, email drafts and background agents are left
  out because Rill has none of them. Three one-line examples anchor the voice, because a 1.7B model
  copies examples more reliably than it follows rules.
  The model still adds banned filler such as "What's on your mind?" in roughly half of small-talk
  replies, so `stripFiller()` drops a short, unquoted closing sentence of that kind from what is shown.

## Problems found and fixed while building

- **CPU fallback failed to load** (`GatherBlockQuantized` not implemented). The WebGPU (asyncify) ONNX
  Runtime build only has that kernel on the GPU. The worker now loads the plain WASM build for CPU.
- **The CSP blocked Playwright's string predicates** (`wait_for_function`), which shows the
  no-`unsafe-eval` policy really applies. The tests poll with `evaluate()` instead. The CSP was not loosened.
- **Mobile layout collapsed the chat column** because the off-canvas sidebar left the grid flow and
  the main column fell into a zero-width track. Grid columns are now assigned explicitly.
- **The decorative backdrop grain caught clicks.** It now has `pointer-events: none`.
- **The streaming caret stayed visible** when the final text matched the last streamed chunk. Fixed.
- **`sandbox.html` could run with Rill's origin** if a hostile page framed it without `sandbox`. It now
  refuses to run unless its origin is opaque.
- **Schema-aware argument types were ignored** because the parser looked for `parameters` at the
  wrong depth in the tool schema. Fixed, with a unit test.

## Next improvements

1. **Better research.** Add a user-supplied search API key (Brave, Tavily) stored locally, for
   results beyond Wikipedia.
2. **Embeddings for file search.** A small embedding model (for example `all-MiniLM-L6-v2` via
   Transformers.js) would beat BM25 on paraphrased questions.
3. **Pin the model revision** in `engine.js` for reproducible behaviour.
4. **Multi-threaded WASM on Pages** through a COOP/COEP service worker (such as `coi-serviceworker`),
   so the CPU fallback can use every core. Measured in single-threaded headless Chrome on the dev VM,
   the CPU path loads in about 20 s (after download) but generates at only about 0.2 tokens/s, so it is a last resort.
5. **Export and import** of chats, plans and notes as JSON, so people can move between devices.
6. **Step retries.** If a step's result looks empty or is an error, retry once with the error added
   before moving on.
7. **Scanned PDFs.** Add OCR (Tesseract.js) as an opt-in for image-only PDFs, which currently extract no text.
8. **Offline PWA.** Add a service worker for the app shell, so Rill opens with no network once the model is cached.
9. **Accessibility pass** with a screen reader: the live region for streaming text and the focus order in the drawers.
10. **Logo.** Deferred. The sidebar shows the name as plain text for now.
