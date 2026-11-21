// Main-thread client for the model worker. Exposes load(), generate(), abort().

export const MODEL_ID = 'onnx-community/LFM3-1.7B-ONNX';

export async function detectDevice() {
  if (!('gpu' in navigator)) return { device: 'wasm', dtype: 'q4', reason: 'WebGPU is not available in this browser.' };
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return { device: 'wasm', dtype: 'q4', reason: 'No WebGPU adapter was found.' };
    const f16 = adapter.features.has('shader-f16');
    return { device: 'webgpu', dtype: f16 ? 'q4f16' : 'q4', reason: f16 ? '' : 'GPU lacks fp16 shaders; using q4.' };
  } catch (err) {
    return { device: 'wasm', dtype: 'q4', reason: 'WebGPU failed: ' + (err?.message || err) };
  }
}

export class Engine extends EventTarget {
  constructor() {
    super();
    this.worker = null;
    this.ready = false;
    this.info = null;
    this.pending = new Map();
    this.seq = 0;
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  load({ device, dtype }) {
    if (this.worker) this.worker.terminate();
    this.ready = false;
    this.worker = new Worker(new URL('./llm-worker.js', import.meta.url), { type: 'module', name: 'rill-llm' });
    this.worker.addEventListener('message', (e) => this.onMessage(e.data));
    this.worker.addEventListener('error', (e) => this.fail(e.message || 'Worker crashed'));
    return new Promise((resolve, reject) => {
      this._loadResolve = resolve;
      this._loadReject = reject;
      this.worker.postMessage({ type: 'load', model: MODEL_ID, device, dtype });
    });
  }

  // A crashed worker never answers, so settle everything that is waiting on it.
  fail(error) {
    this.ready = false;
    this.emit('error', { error });
    this._loadReject?.(new Error(error));
    for (const p of this.pending.values()) p.reject(new Error(error));
    this.pending.clear();
  }

  onMessage(msg) {
    const p = msg.id ? this.pending.get(msg.id) : null;
    switch (msg.type) {
      case 'progress': case 'status': this.emit(msg.type, msg); break;
      case 'ready':
        this.ready = true; this.info = { device: msg.device, dtype: msg.dtype };
        this.emit('ready', this.info); this._loadResolve?.(this.info); break;
      case 'token': p?.onToken?.(msg.text); break;
      case 'prefill': p?.onPrefill?.(msg.done, msg.total); break;
      case 'done': if (p) { this.pending.delete(msg.id); p.resolve({ text: msg.text, aborted: msg.aborted, stats: msg.stats }); } break;
      case 'count': if (p) { this.pending.delete(msg.id); p.resolve(msg.tokens); } break;
      case 'error':
        if (p) { this.pending.delete(msg.id); p.reject(new Error(msg.error)); }
        else { this.emit('error', msg); this._loadReject?.(new Error(msg.error)); }
        break;
      default: break;
    }
  }

  generate({ messages, tools, options, onToken, onPrefill }) {
    const id = 'g' + (++this.seq);
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onToken, onPrefill });
    });
    this.worker.postMessage({ type: 'generate', id, messages, tools, options });
    promise.id = id;
    return promise;
  }

  count(messages, tools) {
    const id = 'c' + (++this.seq);
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.worker.postMessage({ type: 'count', id, messages, tools });
    return promise;
  }

  abort() { this.worker?.postMessage({ type: 'abort' }); }
  reset() { this.worker?.postMessage({ type: 'reset' }); }
}
