import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toTemplate } from '../js/core/agent.js';
import { stepPrompt, stripFiller } from '../js/core/prompt.js';

test('history budget drops oldest turns and never starts mid-tool', () => {
  const msgs = [
    { role: 'user', content: 'a'.repeat(500) },
    { role: 'assistant', content: '', toolCalls: [{ name: 'run_js', arguments: { code: '1' } }] },
    { role: 'tool', content: '1' },
    { role: 'assistant', content: 'x'.repeat(500) },
    { role: 'user', content: 'latest' },
  ];
  const t = toTemplate(msgs, 600);
  assert.equal(t[0].role, 'user');
  assert.equal(t.at(-1).content, 'latest');
  const full = toTemplate(msgs, 1e6);
  assert.equal(full.length, 5);
  assert.equal(full[1].tool_calls[0].function.name, 'run_js');
});

test('step prompt marks progress and includes prior results', () => {
  const plan = { title: 'P', goal: 'G', steps: [{ text: 'one', status: 'done', result: 'r1' }, { text: 'two', status: 'active' }] };
  const s = stepPrompt({ plan, index: 1, previous: [{ n: 1, result: 'r1' }] });
  assert.match(s, /1\. \[x\] one/);
  assert.match(s, /2\. \[>\] two/);
  assert.match(s, /Step 1: r1/);
  assert.match(s, /Now do step 2/);
});

test('strips banned filler sentences but never empties a reply', () => {
  assert.equal(stripFiller("Anytime, Adrian. What's on your mind?"), 'Anytime, Adrian.');
  assert.equal(stripFiller('It is 12. Let me know if you need anything else!'), 'It is 12.');
  assert.equal(stripFiller('Hey, what can I help you with today?'), 'Hey, what can I help you with today?');
  assert.equal(stripFiller('Frank Herbert wrote Dune.'), 'Frank Herbert wrote Dune.');
  assert.equal(stripFiller('Hey Adrian! What can I help you with today?'), 'Hey Adrian!');
  const explain = 'The phrase "how can I help you" is a greeting. It is formal.';
  assert.equal(stripFiller(explain), explain);
  const code = '```py\n# Ask the user.\nname = input()\n```\nLet me know if you need anything else.';
  assert.equal(stripFiller(code), '```py\n# Ask the user.\nname = input()\n```');
  const quoted = 'A banned line is "Let me know if you need anything else."';
  assert.equal(stripFiller(quoted), quoted);
});
