// Scripted stand-in for the model, used by tests and the ?mock demo on
// machines without WebGPU. Same interface as Engine.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function respond(messages) {
  const last = messages.at(-1);
  const user = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  if (last.role === 'tool') {
    const content = last.content;
    if (/^Plan "/.test(content)) return 'On it. I\'ll work through the plan step by step.';
    if (/Now do step/.test(user)) return `Step done. Result: **${content.split('\n')[0].slice(0, 80)}**`;
    return `Here's what I found:\n\n${content.split('\n').slice(0, 3).join('\n')}`;
  }
  if (/You finished the plan/.test(user)) return '## All done\n\nEvery step is complete. Here\'s the short version:\n\n- [x] Steps finished\n- [x] Results collected\n\n**Outcome:** ready to go.';
  if (/Now do step (\d+)/.test(user)) {
    const n = /Now do step (\d+)/.exec(user)[1];
    if (n === '1') return '<tool_call>\n<function=run_js>\n<parameter=code>\nconsole.log(6 * 7)\n</parameter>\n</function>\n</tool_call>';
    return `Step ${n} complete: wrote a short summary.`;
  }
  if (/xss|<script|<img/i.test(user)) return 'Rendering test: <img src=x onerror=alert(1)> <script>alert(1)</script> [link](javascript:alert(1)) **bold** `code`';
  if (/plan|roadmap|break.*down|worksheet/i.test(user)) {
    return 'Sure — here\'s a plan.\n<tool_call>\n<function=create_plan>\n<parameter=title>\nWeekend project\n</parameter>\n<parameter=goal>\nShip a tiny website\n</parameter>\n<parameter=steps>\n["Pick a topic", "Draft the copy", "Build the page", "Publish it"]\n</parameter>\n</function>\n</tool_call>';
  }
  if (/\d\s*[-+*/^%]\s*\d|percent|%|calculate|math/i.test(user)) {
    return '<tool_call>\n<function=run_js>\n<parameter=code>\nconsole.log(0.175 * 2349.80)\n</parameter>\n</function>\n</tool_call>';
  }
  if (/who|what is|search|research/i.test(user)) {
    return '<tool_call>\n<function=search_web>\n<parameter=query>\n' + user.replace(/[?]/g, '').slice(0, 60) + '\n</parameter>\n</function>\n</tool_call>';
  }
  return 'Hey! I\'m running in **demo mode**, so my answers are scripted. Try asking for a plan, some maths, or a quick search.';
}

export class MockEngine extends EventTarget {
  constructor() { super(); this.ready = false; this.info = null; this.aborted = false; }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  async load() {
    for (let p = 0; p <= 100; p += 25) { this.emit('progress', { file: 'onnx/model_q4f16.onnx_data', loaded: p, total: 100, status: 'progress' }); await wait(60); }
    this.ready = true; this.info = { device: 'mock', dtype: 'demo' };
    this.emit('ready', this.info);
    return this.info;
  }
  async generate({ messages, onToken, onPrefill }) {
    this.aborted = false;
    onPrefill?.(1, 1);
    const text = respond(messages) + '<|im_end|>';
    let out = '';
    for (const piece of text.match(/[\s\S]{1,6}/g)) {
      if (this.aborted) break;
      await wait(12);
      out += piece;
      onToken?.(piece);
    }
    return { text: out, aborted: this.aborted, stats: { promptTokens: 100, reusedTokens: 0, newTokens: out.length / 4 | 0, tokensPerSecond: 42 } };
  }
  async count() { return 100; }
  abort() { this.aborted = true; }
  reset() {}
}
