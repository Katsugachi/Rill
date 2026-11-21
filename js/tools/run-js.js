// Main-thread side of the JS sandbox. See sandbox.html / js/sandbox/host.js.
let frame = null;
let ready = null;
let seq = 0;
const jobs = new Map();

function ensureFrame() {
  if (ready) return ready;
  ready = new Promise((resolve) => {
    frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('tabindex', '-1');
    frame.title = 'JavaScript sandbox';
    frame.className = 'sandbox-frame';
    frame.src = new URL('../../sandbox.html', import.meta.url).href;
    const onMsg = (e) => {
      if (!frame || e.source !== frame.contentWindow) return;
      const d = e.data || {};
      if (d.type === 'sandbox-ready') resolve();
      else if (d.type === 'result' && jobs.has(d.id)) {
        const job = jobs.get(d.id);
        jobs.delete(d.id);
        clearTimeout(job.timer);
        job.resolve({
          ok: !!d.ok,
          output: String(d.output ?? '').slice(0, 8000),
          result: String(d.result ?? '').slice(0, 4000),
          error: String(d.error ?? '').slice(0, 2000),
        });
      }
    };
    window.addEventListener('message', onMsg);
    document.body.appendChild(frame);
  });
  return ready;
}

function resetFrame() {
  frame?.remove();
  frame = null;
  ready = null;
}

export async function runJS(code, { timeout = 5000 } = {}) {
  await ensureFrame();
  const id = 'j' + (++seq);
  return new Promise((resolve) => {
    // Outer watchdog in case the sandbox itself stops responding.
    const timer = setTimeout(() => {
      jobs.delete(id);
      resetFrame();
      resolve({ ok: false, output: '', result: '', error: 'Sandbox did not respond' });
    }, timeout + 3000);
    jobs.set(id, { resolve, timer });
    frame.contentWindow.postMessage({ type: 'run', id, code: String(code), timeout }, '*');
  });
}

export function formatRun(r) {
  const parts = [];
  if (r.output) parts.push(r.output);
  if (r.result && r.result !== r.output.split('\n').pop()) parts.push('=> ' + r.result);
  if (!r.ok) parts.push('Error: ' + r.error);
  return parts.join('\n') || '(no output — use console.log to print values)';
}
