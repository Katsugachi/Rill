// Upload ingestion: validate, extract text, chunk, and search.
// Security model: uploaded content is only ever treated as *text*. It is never
// executed, never parsed as HTML, and always rendered with textContent.

export const LIMITS = { pdf: 25 * 1024 * 1024, text: 2 * 1024 * 1024, files: 20, pdfPages: 300 };

const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'log', 'xml', 'html', 'htm', 'css', 'scss',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'php', 'sh', 'bash', 'zsh',
  'sql', 'r', 'lua', 'pl', 'dart', 'scala', 'vue', 'svelte', 'tex', 'rst', 'srt', 'vtt', 'env', 'gitignore', 'dockerfile']);
export const ACCEPT = ['.pdf', ...[...TEXT_EXT].map((e) => '.' + e)].join(',');

export function extOf(name) {
  const base = String(name).toLowerCase().split(/[\\/]/).pop();
  if (base === 'dockerfile' || base === 'makefile') return base === 'makefile' ? 'txt' : 'dockerfile';
  const i = base.lastIndexOf('.');
  return i === -1 ? '' : base.slice(i + 1);
}

export function safeName(name) {
  // Strip control / bidi-override characters that can disguise extensions.
  return String(name).replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, 120) || 'untitled';
}

export function classify(file) {
  const ext = extOf(file.name);
  if (ext === 'pdf') return 'pdf';
  if (TEXT_EXT.has(ext)) return 'text';
  return null;
}

export function decodeText(bytes) {
  // Reject binaries: NUL bytes are a reliable signal.
  const n = Math.min(bytes.length, 8192);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) throw new Error('This looks like a binary file, not text.');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

let pdfjs = null;
async function loadPdfJs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import('../../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  return pdfjs;
}

export async function extractPdf(bytes, onProgress) {
  const head = String.fromCharCode(...bytes.slice(0, 1024));
  if (!head.includes('%PDF-')) throw new Error('Not a valid PDF file.');
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({
    data: bytes,
    isEvalSupported: false,   // no eval/new Function for fonts (CVE-2024-4367 class)
    enableXfa: false,         // no XFA form HTML
    disableFontFace: true,    // never inject fonts into the page
    useSystemFonts: false,
    stopAtErrors: false,
  }).promise;
  const pages = Math.min(doc.numPages, LIMITS.pdfPages);
  const out = [];
  for (let p = 1; p <= pages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    let line = '';
    let lastY = null;
    const lines = [];
    for (const item of tc.items) {
      if (!('str' in item)) continue;
      const y = item.transform?.[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ''; }
      line += item.str + (item.hasEOL ? '\n' : '');
      lastY = y;
    }
    lines.push(line);
    out.push(`--- Page ${p} ---\n` + lines.join('\n').replace(/\n{3,}/g, '\n\n').trim());
    page.cleanup();
    onProgress?.(p, pages);
  }
  await doc.destroy();
  if (doc.numPages > pages) out.push(`(Stopped after ${pages} of ${doc.numPages} pages.)`);
  return out.join('\n\n');
}

export function chunk(text, size = 1800) {
  const parts = [];
  const paras = text.split(/\n{2,}/);
  let cur = '';
  for (const p of paras) {
    if (cur && cur.length + p.length > size) { parts.push(cur); cur = ''; }
    if (p.length > size) {
      for (let i = 0; i < p.length; i += size) parts.push(p.slice(i, i + size));
    } else cur += (cur ? '\n\n' : '') + p;
  }
  if (cur) parts.push(cur);
  return parts.length ? parts : [''];
}

export async function ingest(file, onProgress) {
  const kind = classify(file);
  if (!kind) throw new Error('Unsupported file type. Use PDF, text, Markdown, CSV, JSON or code.');
  const limit = kind === 'pdf' ? LIMITS.pdf : LIMITS.text;
  if (file.size > limit) throw new Error(`Too large (max ${Math.round(limit / 1048576)} MB).`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = kind === 'pdf' ? await extractPdf(bytes, onProgress) : decodeText(bytes);
  if (!text.trim()) throw new Error(kind === 'pdf' ? 'No selectable text found (scanned PDF?).' : 'File is empty.');
  return {
    id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: safeName(file.name),
    kind,
    ext: extOf(file.name),
    size: file.size,
    chars: text.length,
    chunks: chunk(text),
    added: Date.now(),
  };
}

const tokens = (s) => String(s).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];

// Small BM25 over chunks of all files.
export function searchFiles(files, query, k = 4) {
  const q = [...new Set(tokens(query))];
  if (!q.length) return [];
  const docs = [];
  for (const f of files) f.chunks.forEach((c, i) => docs.push({ f, i, toks: tokens(c) }));
  const N = docs.length || 1;
  const avg = docs.reduce((a, d) => a + d.toks.length, 0) / N || 1;
  const df = Object.fromEntries(q.map((t) => [t, docs.filter((d) => d.toks.includes(t)).length]));
  return docs.map((d) => {
    let score = 0;
    for (const t of q) {
      const tf = d.toks.filter((x) => x === t).length;
      if (!tf) continue;
      const idf = Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5));
      score += idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * d.toks.length / avg));
    }
    return { file: d.f.name, part: d.i + 1, parts: d.f.chunks.length, text: d.f.chunks[d.i], score };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
}
