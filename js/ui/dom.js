// Small DOM helpers. Text always goes through textContent / append(string).
export function h(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (/^(on.*|href|src|srcdoc|action|formaction|style)$/i.test(k)) throw new Error('Use explicit, validated assignment for ' + k);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c != null && c !== false) n.append(c);
  return n;
}
export const icon = (name) => h('span', { class: 'i i-' + name, 'aria-hidden': 'true' });
// Icon-only copy control; swaps to a tick for a moment after copying.
export function copyButton(getText, label = 'Copy') {
  const b = h('button', { type: 'button', class: 'copy-btn', 'aria-label': label, title: label }, icon('copy'));
  b.addEventListener('click', async () => {
    let ok = true;
    try { await navigator.clipboard.writeText(getText()); } catch { ok = false; }
    b.classList.toggle('done', ok);
    b.replaceChildren(icon(ok ? 'check' : 'x'));
    b.setAttribute('aria-label', ok ? 'Copied' : 'Copy failed');
    setTimeout(() => { b.classList.remove('done'); b.replaceChildren(icon('copy')); b.setAttribute('aria-label', label); }, 1400);
  });
  return b;
}
export function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), 3);
  return (n / 1024 ** i).toFixed(i > 1 ? 1 : 0) + ' ' + u[i];
}
export function toast(text, kind = '') {
  const box = document.getElementById('toasts');
  const t = h('div', { class: 'toast ' + kind, text });
  box.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, kind === 'error' ? 5200 : 3000);
}
