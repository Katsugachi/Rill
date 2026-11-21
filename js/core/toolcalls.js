// Parse LFM3 assistant output into thinking, visible content, and tool calls.
// LFM3 emits:
//   <think>…</think>visible text<tool_call>
//   <function=name>
//   <parameter=key>
//   value
//   </parameter>
//   </function>
//   </tool_call><|im_end|>
// Pure functions: safe to run on partial (streaming) text.

const END_TOKENS = /<\|im_end\|>|<\|endoftext\|>|<\|im_start\|>[\s\S]*$/g;

export function stripSpecial(text) {
  return String(text ?? '').replace(END_TOKENS, '');
}

// `startedInThink`: the prompt ended with "<think>", so output begins inside a thought.
export function splitThinking(raw, startedInThink) {
  let text = stripSpecial(raw);
  let thinking = '';
  let inThink = false;
  if (startedInThink && !text.startsWith('<think>')) text = '<think>' + text;
  // With thinking off, LFM3 sometimes drafts, writes a bare </think>, then
  // answers. Everything before that closing tag is the draft.
  const bare = text.indexOf('</think>');
  if (bare !== -1 && !text.slice(0, bare).includes('<think>')) text = '<think>' + text;
  const open = text.indexOf('<think>');
  if (open !== -1) {
    const close = text.indexOf('</think>', open);
    if (close === -1) {
      thinking = text.slice(open + 7);
      text = text.slice(0, open);
      inThink = true;
    } else {
      thinking = text.slice(open + 7, close);
      text = text.slice(0, open) + text.slice(close + 8);
    }
  }
  return { thinking: thinking.trim(), text, inThink };
}

function coerce(value, schema) {
  const type = schema?.type;
  const v = value;
  if (type === 'string' || !type) {
    if (type === 'string') return v;
    // Unknown type: try JSON for structured values only.
    const t = v.trim();
    if (/^[[{]/.test(t)) { try { return JSON.parse(t); } catch { /* keep string */ } }
    return v;
  }
  const t = v.trim();
  if (type === 'number' || type === 'integer') {
    const n = Number(t);
    return Number.isFinite(n) ? n : v;
  }
  if (type === 'boolean') return t === 'true' ? true : t === 'false' ? false : v;
  if (type === 'array' || type === 'object') {
    try { return JSON.parse(t); } catch { /* fall through */ }
    if (type === 'array') {
      // Tolerate newline / bullet lists from a small model.
      return t.split(/\n+/).map((s) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);
    }
    return v;
  }
  return v;
}

function parseXmlCall(body, schemas) {
  const fn = /<function=([^>\n]+)>([\s\S]*?)(?:<\/function>|$)/.exec(body);
  if (!fn) return null;
  const name = fn[1].trim();
  const props = (schemas?.[name]?.function ?? schemas?.[name])?.parameters?.properties || {};
  const args = {};
  const re = /<parameter=([^>\n]+)>\n?([\s\S]*?)\n?<\/parameter>/g;
  let m;
  while ((m = re.exec(fn[2]))) {
    const key = m[1].trim();
    args[key] = coerce(m[2], props[key]);
  }
  return { name, arguments: args };
}

function parseJsonCall(body) {
  try {
    const obj = JSON.parse(body.trim());
    if (obj && typeof obj.name === 'string') {
      let args = obj.arguments ?? obj.parameters ?? {};
      if (typeof args === 'string') args = JSON.parse(args);
      return { name: obj.name, arguments: args && typeof args === 'object' ? args : {} };
    }
  } catch { /* not JSON */ }
  return null;
}

// Returns { thinking, inThink, content, toolCalls, pendingCall }
export function parseAssistant(raw, { startedInThink = false, schemas = {} } = {}) {
  const { thinking, text, inThink } = splitThinking(raw, startedInThink);
  const toolCalls = [];
  let content = '';
  let pendingCall = false;
  let rest = text;
  for (;;) {
    const open = rest.indexOf('<tool_call>');
    if (open === -1) {
      // Hide a partially streamed opening tag.
      const partial = rest.match(/<(?:t(?:o(?:o(?:l(?:_(?:c(?:a(?:l(?:l)?)?)?)?)?)?)?)?)?$/);
      content += partial ? rest.slice(0, partial.index) : rest;
      break;
    }
    content += rest.slice(0, open);
    const close = rest.indexOf('</tool_call>', open);
    const body = rest.slice(open + 11, close === -1 ? undefined : close);
    if (close === -1) {
      pendingCall = true;
      break;
    }
    const call = parseXmlCall(body, schemas) || parseJsonCall(body);
    if (call) toolCalls.push(call);
    rest = rest.slice(close + 12);
  }
  return { thinking, inThink, content: content.replace(/^\s+/, '').replace(/\s+$/, ''), toolCalls, pendingCall };
}
