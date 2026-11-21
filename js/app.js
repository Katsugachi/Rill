// Rill app controller: wires engine, agent, storage and UI together.
import { Engine } from './core/engine.js';
import { MockEngine } from './core/mock-engine.js';
import { detectDevice } from './core/engine.js';
import { Agent, uid } from './core/agent.js';
import { store, loadSettings, saveSettings } from './core/store.js';
import { ingest, ACCEPT, LIMITS } from './tools/files.js';
import { LABELS } from './tools/index.js';
import { renderMarkdown } from './ui/markdown.js';
import { h, icon, fmtBytes, toast } from './ui/dom.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const MOCK = params.has('mock');

const state = {
  settings: loadSettings(),
  chats: [],
  chat: null,
  files: [],
  notes: [],
  plans: [],
  pending: [],          // files attached in composer, not yet sent
  busy: false,
  loading: false,
  pauseRequested: false,
  runningPlan: null,
  queued: null,
  load: { files: {}, error: '', note: '' },
  panelTab: 'plan',
};

const engine = MOCK ? new MockEngine() : new Engine();
const agent = new Agent({
  engine,
  getContext: () => ({
    files: state.files,
    notes: state.notes,
    settings: state.settings,
    onPlan: createPlan,
    onNote: createNote,
  }),
});

/* ------------------------------------------------------------ persistence */
const clean = (m) => { const { streaming, running, inThink, pendingCall, prefill, ...rest } = m; return rest; };
let saveTimer = null;
function saveChat(now = false) {
  if (!state.chat) return;
  const chat = state.chat;
  chat.updated = Date.now();
  const write = () => store.put('chats', { ...chat, messages: chat.messages.map(clean) }).catch(console.error);
  clearTimeout(saveTimer);
  if (now) write(); else saveTimer = setTimeout(write, 400);
}
const savePlan = (plan) => store.put('plans', plan).catch(console.error);

/* ------------------------------------------------------------ engine */
function setStatus(st, text) {
  $('statusPill').dataset.state = st;
  $('statusText').textContent = text;
}

async function loadModel() {
  if (state.loading || engine.ready) return;
  state.loading = true;
  state.load = { files: {}, error: '', note: '' };
  setStatus('loading', 'Loading…');
  renderWelcome();
  let choice = await detectDevice();
  if (state.settings.device === 'wasm') choice = { device: 'wasm', dtype: 'q4', reason: 'CPU mode selected in Settings.' };
  else if (state.settings.device === 'webgpu' && choice.device !== 'webgpu') choice.reason += ' Falling back to CPU.';
  state.load.note = choice.reason;
  try {
    const info = await engine.load(choice);
    setStatus('ready', info.device === 'webgpu' ? 'Ready · WebGPU' : info.device === 'mock' ? 'Demo mode' : 'Ready · CPU');
    toast(info.device === 'mock' ? 'Demo mode: scripted replies, no model.' : 'Rill is awake. Everything runs on your device.');
  } catch (err) {
    state.load.error = String(err.message || err);
    setStatus('error', 'Load failed');
  } finally {
    state.loading = false;
    renderWelcome();
    updateComposer();
  }
  if (engine.ready) {
    resumeInterrupted();
    if (state.queued) { const q = state.queued; state.queued = null; send(q.text, q.files); }
  }
}

engine.addEventListener('progress', (e) => {
  const p = e.detail;
  if (!p.file) return;
  state.load.files[p.file] = { loaded: p.loaded || 0, total: p.total || state.load.files[p.file]?.total || 0 };
  scheduleLoadRender();
});
engine.addEventListener('status', (e) => { state.load.stage = e.detail.text; scheduleLoadRender(); });
engine.addEventListener('error', (e) => { if (engine.ready) toast('Model error: ' + e.detail.error, 'error'); });
let loadRaf = 0;
function scheduleLoadRender() {
  if (loadRaf) return;
  loadRaf = requestAnimationFrame(() => { loadRaf = 0; updateLoadCard(); });
}

/* ------------------------------------------------------------ welcome */
function greeting() {
  const hr = new Date().getHours();
  const part = hr < 5 ? 'Still up' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  return part + (state.settings.name ? ', ' + state.settings.name : '');
}

const SUGGESTIONS = [
  ['Break it down', 'Make a 5-day study plan for my chemistry exam'],
  ['Do the maths', 'What\'s 17.5% of $2,349.80, compounded monthly for 3 years at 4%?'],
  ['Research', 'Who designed the Golden Gate Bridge, and how long did it take?'],
  ['Checklist', 'Give me a checklist for moving house next month'],
];

function renderWelcome() {
  const inner = $('threadInner');
  if (state.chat?.messages.length) return;
  inner.replaceChildren();
  const wrap = h('div', { class: 'welcome' });
  const logo = h('img', { class: 'logo-big', alt: '', width: 64, height: 64 });
  logo.src = 'assets/logo.svg';
  const title = h('h2', {}, greeting() + '.', h('br'), 'What are we ', h('em', { text: 'tackling' }), ' today?');
  wrap.append(logo, title);
  if (!engine.ready) wrap.append(loadCard());
  else wrap.append(h('p', { class: 'sub', text: 'Ask anything, drop in a worksheet, or hand me something long. I\'ll plan it and work through it.' }));
  const sugg = h('div', { class: 'suggestions' });
  for (const [t, q] of SUGGESTIONS) {
    sugg.append(h('button', { class: 'suggestion', type: 'button', onclick: () => { $('input').value = q; autoGrow(); $('input').focus(); } }, h('b', { text: t }), q));
  }
  wrap.append(sugg);
  inner.append(wrap);
  document.body.classList.remove('focus');
}

function loadCard() {
  const card = h('div', { class: 'load-card glass', id: 'loadCard' });
  if (state.loading) {
    card.append(
      h('div', { class: 'load-row' }, h('div', { class: 'load-meta' }, h('b', { id: 'loadStage', text: state.load.stage || 'Starting…' }), h('span', { id: 'loadBytes', text: 'Downloading once, then cached for offline use' }))),
      h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Model download', 'aria-valuemin': 0, 'aria-valuemax': 100, id: 'loadBar' }, h('i')),
    );
  } else {
    const btn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: loadModel }, icon('spark'), state.load.error ? 'Try again' : 'Wake Rill');
    card.append(h('div', { class: 'load-row' },
      h('div', { class: 'load-meta' }, h('b', { text: 'LFM3 1.7B · on-device' }), MOCK ? 'Demo mode — no download.' : 'One-time ~1.4 GB download, cached by your browser. Private by design.'),
      btn));
  }
  if (state.load.error) card.append(h('p', { class: 'load-note warn', text: state.load.error + (state.settings.device !== 'wasm' ? ' — you can switch to CPU in Settings.' : '') }));
  else if (state.load.note) card.append(h('p', { class: 'load-note warn', text: state.load.note }));
  return card;
}

function updateLoadCard() {
  const bar = $('loadBar');
  if (!bar) return;
  let loaded = 0; let total = 0;
  for (const f of Object.values(state.load.files)) { loaded += f.loaded; total += f.total; }
  const pct = total ? Math.min(100, (loaded / total) * 100) : 0;
  bar.firstChild.style.setProperty('--p', pct.toFixed(1) + '%');
  bar.setAttribute('aria-valuenow', Math.round(pct));
  $('loadStage').textContent = state.load.stage || 'Loading';
  if (total) $('loadBytes').textContent = `${fmtBytes(loaded)} of ${fmtBytes(total)} · ${Math.round(pct)}%`;
  setStatus('loading', total ? `Loading ${Math.round(pct)}%` : 'Loading…');
}

/* ------------------------------------------------------------ chats */
async function newChat() {
  if (state.busy) return toast('Rill is still working — stop it first.');
  state.chat = { id: uid('c'), title: 'New chat', created: Date.now(), updated: Date.now(), messages: [] };
  $('chatTitle').textContent = 'New chat';
  renderThread();
  renderChatList();
  renderPanel();
  $('input').focus();
}

async function openChat(id) {
  if (state.busy && state.chat?.id !== id) return toast('Rill is still working — stop it first.');
  const chat = await store.get('chats', id);
  if (!chat) return;
  state.chat = chat;
  $('chatTitle').textContent = chat.title;
  renderThread();
  renderChatList();
  renderPanel();
  if (matchMedia('(max-width: 820px)').matches) setSidebar(false);
}

async function deleteChat(id) {
  await store.del('chats', id);
  for (const p of state.plans.filter((x) => x.chatId === id)) await store.del('plans', p.id);
  state.plans = state.plans.filter((x) => x.chatId !== id);
  state.chats = state.chats.filter((c) => c.id !== id);
  if (state.chat?.id === id) newChat(); else renderChatList();
}

function renderChatList() {
  const list = $('chatList');
  const chats = [...state.chats];
  if (state.chat?.messages.length && !chats.some((c) => c.id === state.chat.id)) chats.push(state.chat);
  chats.sort((a, b) => b.updated - a.updated);
  const today = new Date().setHours(0, 0, 0, 0);
  const groups = [['Today', chats.filter((c) => c.updated >= today)], ['Earlier', chats.filter((c) => c.updated < today)]];
  const nodes = [];
  for (const [label, items] of groups) {
    if (!items.length) continue;
    nodes.push(h('div', { class: 'chat-group', text: label }));
    for (const c of items) {
      const running = state.runningPlan && state.runningPlan.chatId === c.id;
      const del = h('button', { class: 'del', type: 'button', 'aria-label': 'Delete chat', onclick: (e) => { e.stopPropagation(); deleteChat(c.id); } }, icon('trash'));
      nodes.push(h('button', { class: 'chat-item', type: 'button', 'aria-current': state.chat?.id === c.id ? 'page' : null, onclick: () => openChat(c.id) },
        h('span', { class: 'label', text: c.title }), running ? h('span', { class: 'running', title: 'Working on a plan' }) : null, del));
    }
  }
  if (!nodes.length) nodes.push(h('p', { class: 'privacy-note', text: 'Your chats will appear here.' }));
  list.replaceChildren(...nodes);
}

/* ------------------------------------------------------------ thread rendering */
const nodes = new Map(); // message id -> { el, update }
let stick = true;
$('thread').addEventListener('scroll', () => {
  const t = $('thread');
  stick = t.scrollHeight - t.scrollTop - t.clientHeight < 80;
});
function scrollDown(force) {
  if (!force && !stick) return;
  const t = $('thread');
  t.scrollTop = t.scrollHeight;
}

function renderThread() {
  nodes.clear();
  const inner = $('threadInner');
  if (!state.chat.messages.length) { renderWelcome(); return; }
  document.body.classList.add('focus');
  inner.replaceChildren();
  for (const m of state.chat.messages) appendMessage(m, false);
  stick = true;
  requestAnimationFrame(() => scrollDown(true));
}

function appendMessage(m, animate = true) {
  if (!state.chat.messages.length || $('threadInner').querySelector('.welcome')) {
    $('threadInner').replaceChildren();
    document.body.classList.add('focus');
  }
  let node;
  if (m.role === 'user') node = userNode(m);
  else if (m.role === 'assistant') node = assistantNode(m);
  else if (m.role === 'tool') node = toolNode(m);
  if (!node) return;
  if (!animate) node.el.style.animation = 'none';
  nodes.set(m.id, node);
  $('threadInner').append(node.el);
  if (m.role === 'tool' && m.plan) node.el.after(planCardNode(m.plan));
  scrollDown();
}

function updateMessage(m) {
  const n = nodes.get(m.id);
  if (!n) return;
  if (n.raf) return;
  n.raf = requestAnimationFrame(() => {
    n.raf = 0;
    n.update(m);
    if (m.role === 'tool' && m.plan && !n.el.nextElementSibling?.matches('.plan-card')) n.el.after(planCardNode(m.plan));
    scrollDown();
  });
}

function userNode(m) {
  const el = h('div', { class: 'msg msg-user' });
  if (m.files?.length) el.append(h('div', { class: 'msg-files' }, m.files.map((f) => h('span', { class: 'file-chip' }, icon('file'), h('span', { class: 'name', text: f })))));
  el.append(h('div', { class: 'bubble', text: m.content }));
  return { el, update() {} };
}

function assistantNode(m) {
  const el = h('div', { class: 'msg msg-assistant' });
  const think = h('details', { class: 'thinking', hidden: true }, h('summary', { text: 'Thinking' }), h('div', { class: 'thought' }));
  const body = h('div', { class: 'body' });
  const meta = h('div', { class: 'msg-meta' });
  el.append(think, body, meta);
  let lastContent = null;
  let wasStreaming = null;
  const update = (msg) => {
    el.classList.toggle('streaming', !!msg.streaming);
    if (msg.thinking) {
      think.hidden = false;
      think.querySelector('summary').textContent = msg.inThink ? 'Thinking…' : 'Thought it through';
      think.querySelector('.thought').textContent = msg.thinking;
    }
    if (msg.content !== lastContent || msg.streaming || wasStreaming) {
      lastContent = msg.content;
      wasStreaming = !!msg.streaming;
      const md = renderMarkdown(msg.content || '');
      if (msg.streaming && msg.content) md.lastElementChild?.classList.add('caret');
      body.replaceChildren(md);
      if (msg.streaming && !msg.content && !msg.inThink) {
        if (msg.prefill != null && msg.prefill < 1) {
          const bar = h('div', { class: 'progress' }, h('i'));
          bar.firstChild.style.setProperty('--p', Math.round(msg.prefill * 100) + '%');
          body.replaceChildren(h('div', { class: 'prefill' }, 'Reading', bar));
        } else if (!msg.pendingCall) body.replaceChildren(h('div', { class: 'typing', 'aria-label': 'Rill is typing' }, h('i'), h('i'), h('i')));
      }
    }
    if (!msg.content && !msg.streaming) body.replaceChildren();
    meta.replaceChildren();
    if (!msg.streaming && msg.content) {
      meta.append(h('button', { type: 'button', onclick: async (e) => { await navigator.clipboard.writeText(msg.content).catch(() => {}); e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = 'Copy'; }, 1200); } }, 'Copy'));
      if (msg.stats?.tokensPerSecond) meta.append(h('span', { text: `${msg.stats.newTokens} tokens · ${msg.stats.tokensPerSecond} tok/s` }));
      if (msg.aborted) meta.append(h('span', { text: 'Stopped' }));
    }
  };
  update(m);
  return { el, update };
}

function toolArg(call) {
  const a = call?.arguments || {};
  const v = a.query ?? a.url ?? a.name ?? a.title ?? (a.code ? String(a.code).split('\n').find((l) => l.trim()) : '') ?? '';
  return String(typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 80);
}

function toolNode(m) {
  const el = h('details', { class: 'tool' });
  const label = h('span', { class: 'tool-label' });
  const arg = h('span', { class: 'tool-arg' });
  el.append(h('summary', {}, h('span', { class: 'ti' }, icon('check')), label, arg));
  const detail = h('div', { class: 'tool-detail' });
  el.append(detail);
  const update = (msg) => {
    el.classList.toggle('running', !!msg.running);
    el.classList.toggle('error', !!msg.error);
    const [ing, ed] = LABELS[msg.name] || ['Working', 'Done'];
    label.textContent = msg.running ? ing + '…' : ed;
    arg.textContent = toolArg(msg.call);
    const parts = [];
    if (msg.call?.arguments?.code) parts.push(h('div', { class: 'label', text: 'Code' }), h('pre', { text: String(msg.call.arguments.code) }));
    else if (msg.call) parts.push(h('div', { class: 'label', text: 'Input' }), h('pre', { text: JSON.stringify(msg.call.arguments, null, 2) }));
    if (!msg.running) parts.push(h('div', { class: 'label', text: 'Result' }), h('pre', { text: msg.content || '(empty)' }));
    if (msg.sources?.length) parts.push(h('div', { class: 'sources' }, msg.sources.map(sourceLink)));
    detail.replaceChildren(...parts);
  };
  update(m);
  return { el, update };
}

function sourceLink(s) {
  const a = h('a', { class: 'source', target: '_blank', rel: 'noopener noreferrer nofollow', text: s.title });
  try { const u = new URL(s.url); if (u.protocol === 'https:' || u.protocol === 'http:') a.href = u.href; } catch { /* leave inert */ }
  return a;
}

/* ------------------------------------------------------------ plans */
async function createPlan({ title, goal, steps }) {
  const plan = {
    id: uid('p'), chatId: state.chat.id, title, goal, created: Date.now(), status: 'ready',
    steps: steps.map((text) => ({ id: uid('s'), text, status: 'pending', result: '' })),
  };
  state.plans.push(plan);
  await savePlan(plan);
  state.lastCreatedPlan = plan;
  renderPanel();
  setPanel(true, 'plan');
  return plan;
}

const planCards = new Map(); // plan id -> Set of card elements
function planCardNode(planId) {
  const card = h('div', { class: 'plan-card glass', dataset: { plan: planId } });
  if (!planCards.has(planId)) planCards.set(planId, new Set());
  planCards.get(planId).add(card);
  fillPlanCard(card, state.plans.find((p) => p.id === planId));
  return card;
}

function planProgress(plan) {
  const done = plan.steps.filter((s) => s.status === 'done').length;
  return { done, total: plan.steps.length, pct: Math.round((done / plan.steps.length) * 100) };
}

function ring(plan) {
  const { pct } = planProgress(plan);
  const r = h('div', { class: 'ring', role: 'img', 'aria-label': pct + '% complete' }, h('span', { text: pct + '%' }));
  requestAnimationFrame(() => r.style.setProperty('--p', pct));
  return r;
}

function planButtons(plan) {
  const out = [];
  const running = state.runningPlan?.id === plan.id;
  if (running) {
    out.push(h('button', { class: 'btn btn-soft', type: 'button', onclick: () => { state.pauseRequested = true; toast('Pausing after this step…'); } }, icon('pause'), 'Pause'));
    out.push(h('button', { class: 'btn btn-ghost', type: 'button', onclick: stop }, icon('stop'), 'Stop now'));
  } else if (plan.status !== 'done') {
    const label = plan.steps.some((s) => s.status === 'done') ? 'Resume' : 'Run plan';
    out.push(h('button', { class: 'btn btn-primary', type: 'button', disabled: state.busy, onclick: () => startPlan(plan) }, icon('play'), label));
  }
  return out;
}

function planSubtitle(plan) {
  const { done, total } = planProgress(plan);
  const active = plan.steps.find((s) => s.status === 'active');
  if (plan.status === 'done') return `All ${total} steps done`;
  if (plan.status === 'summarising') return 'Writing it all up…';
  if (active) return `Step ${plan.steps.indexOf(active) + 1} of ${total}: ${state.activity || 'working'}`;
  if (plan.status === 'paused') return `Paused · ${done} of ${total} done`;
  return `${total} steps`;
}

function fillPlanCard(card, plan) {
  if (!plan) { card.replaceChildren(h('p', { class: 'empty', text: 'Plan removed.' })); return; }
  card.replaceChildren(
    h('header', {}, ring(plan), h('div', {}, h('h3', { text: plan.title }), h('p', { class: 'meta', text: planSubtitle(plan) }))),
    h('div', { class: 'actions' }, ...planButtons(plan), h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => setPanel(true, 'plan') }, 'View steps')),
  );
}

function refreshPlan(plan) {
  for (const card of planCards.get(plan.id) || []) {
    if (card.isConnected) fillPlanCard(card, plan); else planCards.get(plan.id).delete(card);
  }
  if (state.panelTab === 'plan') renderPanel();
  renderChatList();
}

async function startPlan(plan) {
  if (!engine.ready) { toast('Wake Rill first.'); return loadModel(); }
  if (state.busy) return;
  if (state.chat?.id !== plan.chatId) await openChat(plan.chatId);
  state.busy = true;
  state.runningPlan = plan;
  state.pauseRequested = false;
  updateComposer();
  setStatus('busy', 'Working on plan');
  refreshPlan(plan);
  try {
    await agent.runPlan(plan, {
      persist: savePlan,
      shouldPause: () => state.pauseRequested,
      hooks: {
        onStep: (p) => { state.activity = 'working'; refreshPlan(p); },
        onStepMessage: (p, i, m) => {
          const a = m.role === 'tool' ? (LABELS[m.name]?.[m.running ? 0 : 1] || 'Working').toLowerCase() : m.streaming ? 'writing' : 'thinking';
          if (a !== state.activity) { state.activity = a; refreshPlan(p); }
        },
      },
    });
    if (plan.status === 'summarising') {
      setStatus('busy', 'Writing summary');
      const temp = agent.summaryMessages(plan);
      const summary = await agent.turn({
        messages: temp, tools: [],
        hooks: {
          onAppend: (m) => { m.planSummary = plan.id; state.chat.messages.push(m); appendMessage(m); },
          onUpdate: (m) => updateMessage(m),
        },
      });
      if (summary?.aborted) {
        plan.status = 'paused';
        await savePlan(plan);
        toast('Summary stopped. Press Resume to write it.');
      } else {
        plan.status = 'done';
        await savePlan(plan);
        toast(`Finished “${plan.title}”.`);
      }
    } else if (plan.status === 'paused') toast('Plan paused. Resume whenever you like.');
  } catch (err) {
    plan.status = 'paused';
    await savePlan(plan);
    toast('Plan stopped: ' + err.message, 'error');
  } finally {
    state.busy = false;
    state.runningPlan = null;
    state.pauseRequested = false;
    state.activity = '';
    refreshPlan(plan);
    saveChat(true);
    updateComposer();
    setStatus(engine.ready ? 'ready' : 'idle', engine.ready ? readyLabel() : 'Model not loaded');
  }
}

function resumeInterrupted() {
  const stuck = state.plans.filter((p) => p.status === 'running' || p.status === 'summarising');
  for (const p of stuck) {
    p.status = 'paused';
    for (const s of p.steps) if (s.status === 'active') s.status = 'pending';
    savePlan(p);
  }
  if (stuck.length) toast(`${stuck.length} plan${stuck.length > 1 ? 's were' : ' was'} interrupted. Open it and press Resume.`);
}

/* ------------------------------------------------------------ notes */
async function createNote({ title, content }) {
  const note = { id: uid('n'), title, content, created: Date.now(), chatId: state.chat?.id };
  state.notes.unshift(note);
  await store.put('notes', note);
  if (state.panelTab === 'notes') renderPanel();
  $('panelBadge').hidden = $('shell').dataset.panel === 'open';
  return note;
}

/* ------------------------------------------------------------ panel */
function setPanel(open, tab) {
  if (tab) state.panelTab = tab;
  $('shell').dataset.panel = open ? 'open' : 'closed';
  $('togglePanel').setAttribute('aria-expanded', String(open));
  if (open) $('panelBadge').hidden = true;
  renderPanel();
}

function renderPanel() {
  for (const t of ['plan', 'files', 'notes']) {
    $('tab-' + t).setAttribute('aria-selected', String(state.panelTab === t));
    $('pane-' + t).hidden = state.panelTab !== t;
  }
  const pane = $('pane-' + state.panelTab);
  if (state.panelTab === 'plan') pane.replaceChildren(...planPane());
  else if (state.panelTab === 'files') pane.replaceChildren(...filesPane());
  else pane.replaceChildren(...notesPane());
}

function planPane() {
  const plans = state.plans.filter((p) => p.chatId === state.chat?.id).sort((a, b) => b.created - a.created);
  if (!plans.length) return [h('div', { class: 'empty' }, icon('check'), 'No plan yet. Ask Rill to break something down — a worksheet, a project, a trip — and the steps will live here.')];
  const sel = plans.find((p) => p.id === state.selectedPlan) || state.runningPlan || plans[0];
  const out = [
    h('div', { class: 'plan-head' }, ring(sel), h('div', {}, h('h3', { text: sel.title }), h('p', { text: sel.goal || planSubtitle(sel) }))),
    h('div', { class: 'plan-controls' }, ...planButtons(sel)),
  ];
  const list = h('ol', { class: 'steps' });
  sel.steps.forEach((s, i) => {
    const text = h('div', { class: 'step-text' }, h('span', { class: 't', text: s.text }));
    if (s.status === 'active') text.append(h('div', { class: 'meta', text: (state.activity || 'working') + '…' }));
    if (s.result) {
      const d = h('details', { class: 'step-result' }, h('summary', { text: 'Result' }));
      d.append(renderMarkdown(s.result));
      text.append(d);
    }
    list.append(h('li', { class: 'step ' + s.status, 'aria-label': `Step ${i + 1}, ${s.status}` }, h('span', { class: 'step-dot' }, icon('check')), text));
  });
  out.push(list);
  if (plans.length > 1) {
    out.push(h('div', { class: 'plan-picker' }, h('h4', { text: 'Other plans' }),
      plans.filter((p) => p !== sel).map((p) => h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { state.selectedPlan = p.id; renderPanel(); } }, `${p.title} · ${planProgress(p).pct}%`))));
  }
  return out;
}

function filesPane() {
  const add = h('label', { class: 'btn btn-soft' }, icon('plus'), 'Add files');
  const input = h('input', { type: 'file', multiple: true, hidden: true, accept: ACCEPT });
  input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
  add.append(input);
  const out = [h('div', { class: 'plan-controls' }, add)];
  if (!state.files.length) out.push(h('div', { class: 'empty' }, icon('file'), `PDFs, text and code files. Read as plain text only — nothing is ever executed. Up to ${LIMITS.files} files.`));
  else out.push(h('div', { class: 'list' }, state.files.map((f) => h('div', { class: 'card' },
    h('div', { class: 'card-head' }, icon('file'), h('span', { class: 'title', text: f.name }),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove ' + f.name, onclick: () => removeFile(f.id) }, icon('trash'))),
    h('div', { class: 'meta', text: `${f.kind.toUpperCase()} · ${fmtBytes(f.size)} · ${f.chunks.length} part${f.chunks.length > 1 ? 's' : ''}` })))));
  return out;
}

function notesPane() {
  if (!state.notes.length) return [h('div', { class: 'empty' }, icon('spark'), 'Notes Rill saves for you show up here. Try “save that as a note”.')];
  return [h('div', { class: 'list' }, state.notes.map((n) => {
    const dl = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Download note', title: 'Download .md', onclick: () => download(n.title + '.md', n.content) }, icon('up'));
    const del = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Delete note', onclick: async () => { await store.del('notes', n.id); state.notes = state.notes.filter((x) => x !== n); renderPanel(); } }, icon('trash'));
    return h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'title', text: n.title }), dl, del),
      h('div', { class: 'meta', text: new Date(n.created).toLocaleString() }), renderMarkdown(n.content));
  }))];
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = h('a', { download: name.replace(/[^\w .-]+/g, '_').slice(0, 80) });
  a.href = url;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------ files */
async function addFiles(list, toComposer = false) {
  for (const file of [...list]) {
    if (state.files.length >= LIMITS.files) { toast(`Up to ${LIMITS.files} files.`, 'error'); break; }
    const chip = toComposer ? pendingChip(file.name) : null;
    try {
      const f = await ingest(file, (p, n) => chip && (chip.querySelector('.meta').textContent = `page ${p}/${n}`));
      state.files.push(f);
      await store.put('files', f);
      if (chip) { state.pending.push(f); chip.classList.remove('loading'); chip.querySelector('.meta').textContent = fmtBytes(f.size); chip.dataset.id = f.id; }
      else toast(`Added ${f.name}`);
    } catch (err) {
      chip?.remove();
      toast(`${file.name}: ${err.message}`, 'error');
    }
  }
  renderPanel();
  updateComposer();
}

function pendingChip(name) {
  const chip = h('span', { class: 'file-chip loading' }, icon('file'), h('span', { class: 'name', text: name }), h('span', { class: 'meta', text: 'reading…' }));
  chip.append(h('button', { type: 'button', 'aria-label': 'Remove ' + name, onclick: () => { state.pending = state.pending.filter((f) => f.id !== chip.dataset.id); chip.remove(); updateComposer(); } }, icon('x')));
  $('attachments').append(chip);
  return chip;
}

async function removeFile(id) {
  state.files = state.files.filter((f) => f.id !== id);
  state.pending = state.pending.filter((f) => f.id !== id);
  await store.del('files', id);
  renderPanel();
}

/* ------------------------------------------------------------ sending */
function readyLabel() { return engine.info?.device === 'webgpu' ? 'Ready · WebGPU' : engine.info?.device === 'mock' ? 'Demo mode' : 'Ready · CPU'; }

async function send(text, files = []) {
  text = text.trim();
  if (!text && !files.length) return;
  if (!text) text = 'I attached ' + files.map((f) => f.name).join(', ') + '. Take a look.';
  if (!engine.ready) {
    state.queued = { text, files };
    toast('Waking Rill first — your message will send when it\'s ready.');
    loadModel();
    return;
  }
  if (state.busy) return;
  const chat = state.chat;
  const first = !chat.messages.length;
  const user = { id: uid('m'), role: 'user', content: text, files: files.map((f) => f.name), created: Date.now() };
  chat.messages.push(user);
  if (first) {
    chat.title = text.replace(/\s+/g, ' ').slice(0, 48) + (text.length > 48 ? '…' : '');
    $('chatTitle').textContent = chat.title;
  }
  appendMessage(user);
  stick = true; scrollDown(true);
  state.busy = true;
  state.stopped = false;
  state.lastCreatedPlan = null;
  updateComposer();
  setStatus('busy', 'Thinking');
  try {
    await agent.turn({
      messages: chat.messages,
      hooks: { onAppend: (m) => { appendMessage(m); saveChat(); }, onUpdate: (m) => { updateMessage(m); if (!m.streaming) saveChat(); } },
    });
  } catch (err) {
    toast('Something went wrong: ' + err.message, 'error');
    const last = chat.messages.at(-1);
    if (last?.streaming) { last.streaming = false; last.content ||= '_Generation failed._'; updateMessage(last); }
  } finally {
    state.busy = false;
    saveChat(true);
    if (!state.chats.some((c) => c.id === chat.id)) state.chats.push(chat);
    renderChatList();
    updateComposer();
    setStatus('ready', readyLabel());
  }
  const plan = state.lastCreatedPlan;
  if (plan && state.settings.autoRun && !state.stopped && plan.chatId === chat.id) startPlan(plan);
}

function stop() {
  state.stopped = true;
  if (state.runningPlan) state.pauseRequested = true;
  agent.stop();
}

/* ------------------------------------------------------------ composer */
function autoGrow() {
  const t = $('input');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 220) + 'px';
  updateComposer();
}

function updateComposer() {
  const btn = $('send');
  const has = $('input').value.trim() || state.pending.length;
  btn.classList.toggle('stop', state.busy);
  btn.replaceChildren(icon(state.busy ? 'stop' : 'up'));
  btn.setAttribute('aria-label', state.busy ? 'Stop' : 'Send');
  btn.disabled = !state.busy && !has;
  $('input').placeholder = state.runningPlan ? 'Rill is working through your plan…' : state.chat?.messages.length ? 'Reply to Rill…' : 'Ask Rill anything…';
}

$('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  if (state.busy) return stop();
  const text = $('input').value;
  const files = state.pending;
  state.pending = [];
  $('attachments').replaceChildren();
  $('input').value = '';
  autoGrow();
  send(text, files);
});
$('input').addEventListener('input', autoGrow);
$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit(); }
});
$('fileInput').accept = ACCEPT;
$('fileInput').addEventListener('change', () => { addFiles($('fileInput').files, true); $('fileInput').value = ''; });

// Drag & drop anywhere
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { dragDepth++; $('dropzone').hidden = false; } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('dropzone').hidden = true; } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; $('dropzone').hidden = true;
  if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files, true);
});
// Paste files
$('input').addEventListener('paste', (e) => { if (e.clipboardData?.files.length) { e.preventDefault(); addFiles(e.clipboardData.files, true); } });

/* ------------------------------------------------------------ chrome */
function setSidebar(open) {
  $('shell').dataset.sidebar = open ? 'open' : 'closed';
  $('scrim').hidden = !open && $('shell').dataset.panel !== 'open';
}
$('toggleSidebar').addEventListener('click', () => setSidebar($('shell').dataset.sidebar !== 'open'));
$('scrim').addEventListener('click', () => { setSidebar(false); setPanel(false); $('scrim').hidden = true; });
$('togglePanel').addEventListener('click', () => {
  const open = $('shell').dataset.panel !== 'open';
  setPanel(open);
  if (matchMedia('(max-width: 820px)').matches) $('scrim').hidden = !open;
});
$('closePanel').addEventListener('click', () => { setPanel(false); $('scrim').hidden = $('shell').dataset.sidebar !== 'open' || !matchMedia('(max-width: 820px)').matches; });
for (const t of ['plan', 'files', 'notes']) $('tab-' + t).addEventListener('click', () => { state.panelTab = t; renderPanel(); });
$('newChat').addEventListener('click', newChat);
$('statusPill').addEventListener('click', () => {
  if (!engine.ready) return loadModel();
  const last = [...(state.chat?.messages || [])].reverse().find((m) => m.stats?.tokensPerSecond);
  toast(`LFM3 1.7B · ${engine.info.device} · ${engine.info.dtype}${last ? ` · ${last.stats.tokensPerSecond} tok/s` : ''}`);
});
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); newChat(); }
  else if (e.key === 'Escape' && state.busy && !$('settings').open) stop();
});

// Settings
const form = $('settingsForm');
$('openSettings').addEventListener('click', () => {
  for (const [k, v] of Object.entries(state.settings)) {
    const f = form.elements[k];
    if (!f) continue;
    if (f.type === 'checkbox') f.checked = !!v; else f.value = v;
  }
  $('settings').showModal();
});
$('settings').addEventListener('close', () => {
  const s = { ...state.settings };
  for (const k of ['name', 'device']) s[k] = form.elements[k].value.trim();
  for (const k of ['thinking', 'webReader', 'autoRun']) s[k] = form.elements[k].checked;
  const deviceChanged = s.device !== state.settings.device;
  state.settings = s;
  saveSettings(s);
  if (deviceChanged && engine.ready) toast('Compute change applies after a reload.');
  if (!state.chat?.messages.length) renderWelcome();
});
$('clearData').addEventListener('click', async () => {
  if (!confirm('Erase all chats, plans, files and notes from this browser?')) return;
  await store.clear();
  localStorage.clear();
  location.reload();
});

/* ------------------------------------------------------------ boot */
async function boot() {
  const [chats, files, notes, plans] = await Promise.all(['chats', 'files', 'notes', 'plans'].map((s) => store.all(s).catch(() => [])));
  state.chats = chats.sort((a, b) => b.updated - a.updated);
  state.files = files;
  state.notes = notes.sort((a, b) => b.created - a.created);
  state.plans = plans;
  if (matchMedia('(max-width: 820px)').matches) setSidebar(false);
  await newChat();
  updateComposer();
  if (MOCK && params.has('autoload')) loadModel();
  // Interrupted plans (tab closed mid-run) are marked paused at boot so the UI
  // never claims work is happening when it is not.
  resumeInterrupted();
}

window.rill = { state, engine, agent }; // handy for debugging & e2e tests
boot();
