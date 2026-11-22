// The loading mark: a small hand-drawn stream (a rill). It draws itself in,
// then the water drifts to the right while two glints run along it faster,
// so the motion has depth. With a progress value the stream fills its course
// from left to right over a dotted guide of the distance still to go.
const NS = 'http://www.w3.org/2000/svg';
const H = 14;
const MID = 6;
const UNDER = 10.5;
const HALF = 11;
// Uneven crests over one repeat read as drawn rather than plotted.
const CRESTS = [2.6, 1.5, 2.2, 1.1, 2.8, 1.8, 1.4, 2.4];
const REPEAT = HALF * CRESTS.length;

function wave(length, mid = MID, scale = 1, shift = 0) {
  let d = `M0 ${mid}`;
  for (let i = 0, x = 0; x < length; i++, x += HALF) {
    const k = (CRESTS[(i + shift) % CRESTS.length] * scale / 0.75) * (i % 2 ? 1 : -1);
    d += ` C${x + HALF * 0.3} ${mid + k} ${x + HALF * 0.7} ${mid + k} ${x + HALF} ${mid}`;
  }
  return d;
}

function svg(width, cls) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', `0 0 ${width} ${H}`);
  s.setAttribute('width', width);
  s.setAttribute('height', H);
  s.setAttribute('class', cls);
  s.setAttribute('aria-hidden', 'true');
  return s;
}

function path(d, cls) {
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  p.setAttribute('class', cls);
  return p;
}

// Arc length of one repeat. Two glints per repeat, so when the drift loops back
// by one repeat the glints land exactly where they were.
const REPEAT_LENGTH = (() => {
  let len = 0;
  for (let i = 0; i < CRESTS.length; i++) {
    const k = CRESTS[i] / 0.75;
    let px = 0; let py = 0;
    for (let t = 1 / 48; t <= 1.0001; t += 1 / 48) {
      const u = 1 - t;
      const x = 3 * u * u * t * 0.3 + 3 * u * t * t * 0.7 + t * t * t;
      const y = 3 * u * u * t * k + 3 * u * t * t * k;
      len += Math.hypot((x - px) * HALF, y - py);
      px = x; py = y;
    }
  }
  return len;
})();

function stream(width, under) {
  const s = svg(width, 'rill-water');
  if (under) {
    // A thinner, slower current underneath gives the water some depth.
    const low = document.createElementNS(NS, 'g');
    low.setAttribute('class', 'rill-flow rill-flow-slow');
    low.append(path(wave(width + REPEAT, UNDER, 0.45, 3), 'rill-under'));
    s.append(low);
  }
  const flow = document.createElementNS(NS, 'g');
  flow.setAttribute('class', 'rill-flow');
  const d = wave(width + REPEAT);
  const glint = path(d, 'rill-glint');
  glint.setAttribute('stroke-dasharray', `7 ${(REPEAT_LENGTH / 2 - 7).toFixed(3)}`);
  glint.style.setProperty('--run', `-${REPEAT_LENGTH.toFixed(3)}px`);
  flow.append(path(d, 'rill-bed'), glint);
  s.append(flow);
  return s;
}

export function rill(width = 32, { progress = null, label = 'Working' } = {}) {
  const box = document.createElement('span');
  box.className = 'rill';
  box.style.setProperty('--w', width + 'px');
  if (progress == null) {
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', label);
    box.append(stream(width, width >= 32));
    return box;
  }
  box.classList.add('rill-progress');
  box.setAttribute('role', 'progressbar');
  box.setAttribute('aria-label', label);
  box.setAttribute('aria-valuemin', '0');
  box.setAttribute('aria-valuemax', '100');
  const guide = svg(width, 'rill-guide');
  guide.append(path(wave(width), 'rill-course'));
  const fill = document.createElement('span');
  fill.className = 'rill-fill';
  fill.append(stream(width, false));
  box.append(guide, fill);
  setRillProgress(box, progress);
  return box;
}

export function setRillProgress(box, p) {
  const pct = Math.max(0, Math.min(1, p)) * 100;
  box.style.setProperty('--p', pct.toFixed(1) + '%');
  box.setAttribute('aria-valuenow', Math.round(pct));
}
