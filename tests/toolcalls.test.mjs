import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAssistant, splitThinking } from '../js/core/toolcalls.js';
import { SCHEMAS } from '../js/tools/index.js';

test('parses a run_js call exactly as LFM3 emits it', () => {
  const raw = '<tool_call>\n<function=run_js>\n<parameter=code>\nlet r = 0.175 * 2349.8;\nconsole.log(r);\n</parameter>\n</function>\n</tool_call><|im_end|>';
  const p = parseAssistant(raw, { schemas: SCHEMAS });
  assert.equal(p.content, '');
  assert.deepEqual(p.toolCalls, [{ name: 'run_js', arguments: { code: 'let r = 0.175 * 2349.8;\nconsole.log(r);' } }]);
});

test('coerces array parameters and keeps preceding text', () => {
  const raw = 'Here is a plan.\n<tool_call>\n<function=create_plan>\n<parameter=title>\nChem\n</parameter>\n<parameter=steps>\n["A", "B", "C"]\n</parameter>\n</function>\n</tool_call>';
  const p = parseAssistant(raw, { schemas: SCHEMAS });
  assert.equal(p.content, 'Here is a plan.');
  assert.deepEqual(p.toolCalls[0].arguments, { title: 'Chem', steps: ['A', 'B', 'C'] });
});

test('tolerates bullet-list arrays and integer params', () => {
  const raw = '<tool_call>\n<function=create_plan>\n<parameter=title>\nX\n</parameter>\n<parameter=steps>\n- one\n- two\n</parameter>\n</function>\n</tool_call><tool_call>\n<function=read_file>\n<parameter=name>\na.pdf\n</parameter>\n<parameter=part>\n3\n</parameter>\n</function>\n</tool_call>';
  const p = parseAssistant(raw, { schemas: SCHEMAS });
  assert.deepEqual(p.toolCalls[0].arguments.steps, ['one', 'two']);
  assert.equal(p.toolCalls[1].arguments.part, 3);
});

test('accepts JSON-style tool calls as a fallback', () => {
  const p = parseAssistant('<tool_call>{"name":"search_web","arguments":{"query":"rivers"}}</tool_call>');
  assert.deepEqual(p.toolCalls, [{ name: 'search_web', arguments: { query: 'rivers' } }]);
});

test('hides partial tags while streaming', () => {
  assert.equal(parseAssistant('Sure, one sec <tool_c').content, 'Sure, one sec');
  const p = parseAssistant('Ok <tool_call>\n<function=run_js>\n<parameter=co');
  assert.equal(p.content, 'Ok');
  assert.equal(p.pendingCall, true);
  assert.equal(p.toolCalls.length, 0);
});

test('splits thinking, including open thoughts mid-stream', () => {
  assert.deepEqual(splitThinking('<think>hmm</think>Hi'), { thinking: 'hmm', text: 'Hi', inThink: false });
  assert.deepEqual(splitThinking('still going', true), { thinking: 'still going', text: '', inThink: true });
  assert.equal(parseAssistant('a</think>Hello!<|im_end|>', { startedInThink: true }).content, 'Hello!');
});

test('strips special tokens', () => {
  assert.equal(parseAssistant('Done.<|im_end|><|im_start|>user\nhi').content, 'Done.');
});
