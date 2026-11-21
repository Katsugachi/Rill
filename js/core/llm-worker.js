// Rill model worker: runs LFM3-1.7B with Transformers.js off the main thread.
// Protocol (postMessage):
//   in  {type:'load', model, device, dtype}         out {type:'progress'|'status'|'ready'|'error'}
//   in  {type:'generate', id, messages, tools, options}  out {type:'token', id, text} … {type:'done', id, text, stats}
//   in  {type:'abort', id}
//   in  {type:'count', id, messages, tools}         out {type:'count', id, tokens}
//   in  {type:'reset'}                              drops the KV cache

import {
  AutoTokenizer,
  AutoModelForCausalLM,
  TextStreamer,
  InterruptableStoppingCriteria,
  DynamicCache,
  Tensor,
  ones,
  env,
} from '../../vendor/transformers/transformers.min.js';

env.allowLocalModels = false;
env.useBrowserCache = true;
const ortBase = new URL('../../vendor/ort/', import.meta.url).href;
// The asyncify build carries the WebGPU EP; the plain build has the full CPU
// kernel set (incl. GatherBlockQuantized, which LFM3's q4 embeddings need).
function setRuntime(wantDevice) {
  const flavour = wantDevice === 'webgpu' ? 'ort-wasm-simd-threaded.asyncify' : 'ort-wasm-simd-threaded';
  env.backends.onnx.wasm.wasmPaths = { mjs: ortBase + flavour + '.mjs', wasm: ortBase + flavour + '.wasm' };
}

// WebGPU graphs for LFM3 must be prefilled in chunks of at most 256 tokens.
const PREFILL_CHUNK = 256;

let tokenizer = null;
let model = null;
let device = null;
let busy = false;
let stopper = new InterruptableStoppingCriteria();
let currentId = null;
// Prefix cache: token ids already processed by the model, and their cache.
let cache = null;
let cachedIds = null;

const post = (msg) => self.postMessage(msg);

async function dropCache() {
  if (cache) {
    try { await cache.dispose(); } catch { /* already released */ }
  }
  cache = null;
  cachedIds = null;
}

async function load({ model: modelId, device: wantDevice, dtype }) {
  const progress = (p) => {
    if (p.status === 'progress' || p.status === 'initiate' || p.status === 'done') {
      post({ type: 'progress', file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0, status: p.status });
    }
  };
  try {
    setRuntime(wantDevice);
    post({ type: 'status', text: 'Fetching tokenizer' });
    tokenizer = await AutoTokenizer.from_pretrained(modelId, { progress_callback: progress });
    post({ type: 'status', text: 'Fetching model weights' });
    model = await AutoModelForCausalLM.from_pretrained(modelId, {
      dtype,
      device: wantDevice,
      progress_callback: progress,
    });
    device = wantDevice;
    post({ type: 'status', text: 'Warming up' });
    const warm = tokenizer('hi', { return_tensor: true });
    await model.generate({ ...warm, max_new_tokens: 1 });
    post({ type: 'ready', device, dtype });
  } catch (err) {
    post({ type: 'error', error: String(err?.message || err) });
  }
}

function toIds(messages, tools, enableThinking) {
  const enc = tokenizer.apply_chat_template(messages, {
    tools: tools && tools.length ? tools : undefined,
    add_generation_prompt: true,
    return_dict: true,
    enable_thinking: enableThinking,
  });
  return enc.input_ids.tolist()[0];
}

function cacheEntries(out) {
  const pkv = {};
  for (const k in out) {
    if (k.startsWith('present')) {
      pkv[k.replace('present_conv', 'past_conv').replace('present', 'past_key_values')] = out[k];
    } else if (out[k]?.location === 'gpu-buffer') {
      out[k].dispose();
    }
  }
  return pkv;
}

// Feed ids[from, to) through the model in chunks, extending `cache`.
async function prefill(ids, from, to) {
  for (let s = from; s < to; s += PREFILL_CHUNK) {
    if (stopper.interrupted) return;
    const e = Math.min(s + PREFILL_CHUNK, to);
    const out = await model.forward({
      input_ids: new Tensor('int64', ids.slice(s, e), [1, e - s]),
      attention_mask: ones([1, e]),
      num_logits_to_keep: new Tensor('int64', [1n], []),
      past_key_values: cache,
    });
    const pkv = cacheEntries(out);
    if (cache) cache.update(pkv);
    else cache = new DynamicCache(pkv);
    post({ type: 'prefill', id: currentId, done: e, total: to });
  }
}

async function generate({ id, messages, tools, options = {} }) {
  if (!model) return post({ type: 'error', id, error: 'Model not loaded' });
  if (busy) return post({ type: 'error', id, error: 'Busy' });
  busy = true;
  currentId = id;
  stopper = new InterruptableStoppingCriteria();
  const t0 = performance.now();
  let firstTokenAt = 0;
  let newTokens = 0;
  let text = '';
  try {
    const ids = toIds(messages, tools, !!options.enable_thinking).map(BigInt);
    const N = ids.length;

    let start = 0;
    const reusable = cache && cachedIds && cachedIds.length < N && cachedIds.every((x, i) => x === ids[i]);
    if (reusable) start = cachedIds.length;
    else await dropCache();

    await prefill(ids, start, N - 1);
    if (stopper.interrupted) {
      await dropCache();
      post({ type: 'done', id, text: '', aborted: true, stats: { promptTokens: N, reusedTokens: start, newTokens: 0 } });
      return;
    }
    const prefillMs = performance.now() - t0;

    const streamer = new TextStreamer(tokenizer, {
      skip_prompt: true,
      skip_special_tokens: false,
      callback_function: (chunk) => {
        if (!firstTokenAt) firstTokenAt = performance.now();
        text += chunk;
        post({ type: 'token', id, text: chunk });
      },
      token_callback_function: () => { newTokens++; },
    });

    const sampling = options.mode === 'math'
      ? { temperature: 1.0, top_p: 0.95, top_k: 20 }
      : { temperature: 0.1, top_k: 50 };

    const out = await model.generate({
      input_ids: new Tensor('int64', ids, [1, N]),
      attention_mask: ones([1, N]),
      past_key_values: cache ?? undefined,
      max_new_tokens: options.max_new_tokens ?? 1024,
      do_sample: true,
      repetition_penalty: 1.1,
      ...sampling,
      streamer,
      stopping_criteria: [stopper],
      return_dict_in_generate: true,
    });
    const seq = out.sequences.tolist()[0];
    cache = out.past_key_values;
    cachedIds = seq.slice(0, -1);
    const end = performance.now();
    const genMs = end - (firstTokenAt || end);
    post({
      type: 'done', id, text,
      aborted: stopper.interrupted,
      stats: {
        promptTokens: N,
        reusedTokens: start,
        newTokens,
        prefillMs: Math.round(prefillMs),
        tokensPerSecond: genMs > 0 ? +(newTokens / (genMs / 1000)).toFixed(1) : 0,
      },
    });
  } catch (err) {
    await dropCache();
    post({ type: 'error', id, error: String(err?.message || err), partial: text });
  } finally {
    busy = false;
    currentId = null;
  }
}

self.addEventListener('message', async (e) => {
  const msg = e.data || {};
  switch (msg.type) {
    case 'load': return load(msg);
    case 'generate': return generate(msg);
    case 'abort': if (!msg.id || msg.id === currentId) stopper.interrupt(); return;
    case 'reset': return dropCache();
    case 'count':
      try {
        post({ type: 'count', id: msg.id, tokens: toIds(msg.messages, msg.tools, false).length });
      } catch (err) {
        post({ type: 'count', id: msg.id, tokens: -1, error: String(err) });
      }
      return;
    default: return;
  }
});
