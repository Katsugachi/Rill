// The agent loop: generate → parse tool calls → execute → feed results back,
// until the model answers in plain text. Also the autonomous plan runner.
import { parseAssistant } from './toolcalls.js';
import { systemPrompt, stepPrompt, summaryPrompt } from './prompt.js';
import { SCHEMAS, toolList, execute } from '../tools/index.js';

const CHAT_TOOLS = ['run_js', 'search_web', 'read_page', 'search_files', 'read_file', 'create_plan', 'save_note'];
const STEP_TOOLS = ['run_js', 'search_web', 'read_page', 'search_files', 'read_file', 'save_note'];
const MAX_ROUNDS = 6;
const HISTORY_CHARS = 14000; // ~4k tokens of history keeps a 1.7B model focused and fast

export const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Convert stored chat messages to chat-template messages, newest-first budget.
export function toTemplate(messages, budget = HISTORY_CHARS) {
  const out = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    let t;
    if (m.role === 'user') t = { role: 'user', content: m.content };
    else if (m.role === 'assistant') {
      t = { role: 'assistant', content: m.content || '' };
      if (m.toolCalls?.length) t.tool_calls = m.toolCalls.map((c) => ({ type: 'function', function: { name: c.name, arguments: c.arguments } }));
    } else if (m.role === 'tool') t = { role: 'tool', content: m.content };
    else continue;
    const size = (t.content || '').length + JSON.stringify(t.tool_calls || '').length;
    // Always keep the latest user request and its tool exchange; trim only older turns.
    if (used + size > budget && out.some((x) => x.role === 'user')) break;
    used += size;
    out.unshift(t);
  }
  // Never start with an orphaned tool result or tool call.
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

export class Agent {
  constructor({ engine, getContext }) {
    this.engine = engine;
    this.getContext = getContext; // () => { files, notes, settings, onPlan, onNote }
    this.abortCtl = null;
  }

  stop() {
    this.abortCtl?.abort();
    this.engine.abort();
  }

  // Runs one turn. `messages` is the stored chat array (mutated by appending).
  // hooks: onUpdate(msg), onAppend(msg), onTool(msg, call, phase)
  async turn({ messages, system, tools = CHAT_TOOLS, hooks = {}, maxRounds = MAX_ROUNDS }) {
    const ctx = this.getContext();
    this.abortCtl = new AbortController();
    const signal = this.abortCtl.signal;
    const thinking = !!ctx.settings.thinking;
    const sys = system ?? systemPrompt({ name: ctx.settings.name, files: ctx.files.map((f) => ({ name: f.name, parts: f.chunks.length })), notes: ctx.notes, webReader: ctx.settings.webReader });
    let last = null;
    for (let round = 0; round < maxRounds; round++) {
      if (signal.aborted) break;
      const msg = { id: uid('m'), role: 'assistant', content: '', thinking: '', toolCalls: [], streaming: true, created: Date.now() };
      messages.push(msg);
      hooks.onAppend?.(msg);
      let raw = '';
      const template = [{ role: 'system', content: sys }, ...toTemplate(messages.slice(0, -1))];
      const mode = /\b(math|calculate|equation|solve|integral|derivative|probability)\b/i.test(template.at(-1)?.content || '') ? 'math' : 'chat';
      const res = await this.engine.generate({
        messages: template,
        tools: toolList(tools),
        options: { enable_thinking: thinking, max_new_tokens: thinking ? 2048 : 1024, mode: thinking ? mode : 'chat' },
        onPrefill: (done, total) => { msg.prefill = done / total; hooks.onUpdate?.(msg); },
        onToken: (t) => {
          raw += t;
          const p = parseAssistant(raw, { startedInThink: thinking, schemas: SCHEMAS });
          msg.content = p.content; msg.thinking = p.thinking; msg.inThink = p.inThink; msg.pendingCall = p.pendingCall;
          msg.prefill = 1;
          hooks.onUpdate?.(msg);
        },
      });
      const p = parseAssistant(res.text || raw, { startedInThink: thinking, schemas: SCHEMAS });
      Object.assign(msg, { content: p.content, thinking: p.thinking, toolCalls: p.toolCalls, streaming: false, inThink: false, pendingCall: false, stats: res.stats, aborted: res.aborted });
      hooks.onUpdate?.(msg);
      last = msg;
      if (res.aborted || !p.toolCalls.length) break;
      for (const call of p.toolCalls) {
        if (signal.aborted) break;
        const toolMsg = { id: uid('t'), role: 'tool', name: call.name, call, content: '', running: true, created: Date.now() };
        messages.push(toolMsg);
        hooks.onAppend?.(toolMsg);
        let r;
        try { r = await execute(call, { ...ctx, signal }); } catch (err) { r = { text: 'Stopped.', error: true }; if (err?.name !== 'AbortError') r.text = String(err); }
        Object.assign(toolMsg, { content: r.text, sources: r.sources, detail: r.detail, plan: r.plan, error: !!r.error, running: false });
        hooks.onUpdate?.(toolMsg);
      }
      if (round === maxRounds - 2) tools = []; // force a text answer on the final round
    }
    return last;
  }

  // Works through a plan step by step. Each step runs in a small, fresh
  // context (goal + plan + short results so far) so a 1.7B model stays on track.
  async runPlan(plan, { persist, hooks = {}, shouldPause }) {
    plan.status = 'running';
    await persist(plan);
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      if (step.status === 'done') continue;
      if (shouldPause()) { plan.status = 'paused'; await persist(plan); return plan; }
      step.status = 'active';
      step.log = [];
      hooks.onStep?.(plan, i);
      await persist(plan);
      const previous = plan.steps.slice(0, i).filter((s) => s.status === 'done').slice(-6).map((s, k, arr) => ({ n: plan.steps.indexOf(s) + 1, result: (s.result || '').slice(0, k === arr.length - 1 ? 900 : 350) }));
      const ctx = this.getContext();
      const system = systemPrompt({ name: ctx.settings.name, files: ctx.files.map((f) => ({ name: f.name, parts: f.chunks.length })), notes: [], webReader: ctx.settings.webReader });
      const msgs = [{ id: uid('m'), role: 'user', content: stepPrompt({ plan, index: i, previous }) }];
      const final = await this.turn({ messages: msgs, system, tools: STEP_TOOLS, hooks: { onAppend: (m) => hooks.onStepMessage?.(plan, i, m, msgs), onUpdate: (m) => hooks.onStepMessage?.(plan, i, m, msgs) } });
      step.log = msgs.slice(1).map(({ streaming, ...m }) => m);
      if (final?.aborted || this.abortCtl.signal.aborted) {
        step.status = 'pending';
        plan.status = 'paused';
        await persist(plan);
        return plan;
      }
      step.result = (final?.content || '').trim() || '(no result)';
      step.status = 'done';
      step.finished = Date.now();
      hooks.onStep?.(plan, i);
      await persist(plan);
    }
    plan.status = 'summarising';
    await persist(plan);
    return plan;
  }

  summaryMessages(plan) {
    return [{ id: uid('m'), role: 'user', content: summaryPrompt(plan) }];
  }
}
