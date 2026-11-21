// Research tools. Default source: Wikipedia's public API (CORS-enabled, no key).
// Optional "web reader" (off by default) fetches arbitrary pages through r.jina.ai,
// which means the URL is sent to a third party; the user must opt in.

const WIKI = (lang) => `https://${lang}.wikipedia.org`;
const clip = (s, n) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + ' …' : s);

async function getJSON(url, signal) {
  const res = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function searchWeb(query, { lang = 'en', signal } = {}) {
  const q = String(query || '').slice(0, 300).trim();
  if (!q) return { text: 'Empty query.', sources: [] };
  const url = `${WIKI(lang)}/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=4&gsrsearch=${encodeURIComponent(q)}&prop=extracts|info&inprop=url&exintro=1&explaintext=1&exlimit=4`;
  const data = await getJSON(url, signal);
  const pages = Object.values(data?.query?.pages || {}).sort((a, b) => a.index - b.index);
  if (!pages.length) return { text: `No results for "${q}". Try simpler keywords.`, sources: [] };
  const sources = pages.map((p) => ({ title: p.title, url: p.fullurl }));
  const text = pages.map((p, i) => `[${i + 1}] ${p.title} — ${p.fullurl}\n${clip(p.extract || '', 700)}`).join('\n\n');
  return { text, sources };
}

function isHttpUrl(u) {
  try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:'; } catch { return false; }
}

export async function readPage(url, { webReader = false, signal } = {}) {
  const u = String(url || '').trim();
  if (!isHttpUrl(u)) return { text: 'Invalid URL. Use a full https:// link.', sources: [] };
  const parsed = new URL(u);
  const wiki = /^([a-z-]+)\.(?:m\.)?wikipedia\.org$/.exec(parsed.hostname);
  if (wiki) {
    const title = decodeURIComponent(parsed.pathname.replace(/^\/wiki\//, ''));
    const api = `${WIKI(wiki[1])}/w/api.php?action=query&format=json&origin=*&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(title)}`;
    const data = await getJSON(api, signal);
    const page = Object.values(data?.query?.pages || {})[0];
    if (!page || page.missing !== undefined) return { text: 'Page not found.', sources: [] };
    return { text: `${page.title}\n\n${clip(page.extract || '', 6000)}`, sources: [{ title: page.title, url: u }] };
  }
  if (!webReader) return { text: 'Reading non-Wikipedia pages is turned off. The user can enable "Web reader" in Settings.', sources: [] };
  const res = await fetch('https://r.jina.ai/' + u, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Accept: 'text/plain' } });
  if (!res.ok) return { text: `Could not read page (HTTP ${res.status}).`, sources: [] };
  const text = await res.text();
  return { text: clip(text, 6000), sources: [{ title: parsed.hostname, url: u }] };
}
