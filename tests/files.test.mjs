import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, decodeText, safeName, chunk, searchFiles, extOf } from '../js/tools/files.js';

test('classifies by extension allowlist', () => {
  assert.equal(classify({ name: 'w.pdf' }), 'pdf');
  assert.equal(classify({ name: 'main.py' }), 'text');
  assert.equal(classify({ name: 'evil.exe' }), null);
  assert.equal(classify({ name: 'page.svg' }), null); // SVG can carry script; not accepted
  assert.equal(extOf('Dockerfile'), 'dockerfile');
});

test('rejects binary content', () => {
  assert.throws(() => decodeText(new Uint8Array([65, 0, 66])), /binary/);
  assert.equal(decodeText(new TextEncoder().encode('\uFEFFhéllo')), 'héllo');
});

test('strips bidi overrides and control chars from names', () => {
  assert.equal(safeName('invoice\u202Efdp.exe'), 'invoicefdp.exe');
  assert.equal(safeName('a\u0000b'), 'ab');
});

test('chunks and searches', () => {
  const text = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} about ${i === 17 ? 'photosynthesis in leaves' : 'other things'}.`).join('\n\n');
  const f = { name: 'bio.txt', chunks: chunk(text, 200) };
  assert.ok(f.chunks.length > 3);
  const hits = searchFiles([f], 'photosynthesis');
  assert.equal(hits.length, 1);
  assert.match(hits[0].text, /photosynthesis/);
});
