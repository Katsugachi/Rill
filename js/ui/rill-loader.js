// The loading mark: a small eddy, the size of a letter. Three strokes curl out
// from a still centre like water turning in a rill. The eddy turns slowly while
// each stroke lengthens and draws back in turn, so it reads as moving water
// rather than a spinning wheel. Built with DOM/SVG APIs only.
const NS = 'http://www.w3.org/2000/svg';
const ARMS = 3;

// One arm of an Archimedean spiral, from radius 2.6 to 9.4 over 150 degrees.
function arm(start) {
  let d = '';
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const a = start + t * (150 * Math.PI / 180);
    const r = 2.6 + 6.8 * t;
    d += (i ? ' L' : 'M') + (12 + r * Math.cos(a)).toFixed(2) + ' ' + (12 + r * Math.sin(a)).toFixed(2);
  }
  return d;
}

const PATHS = Array.from({ length: ARMS }, (_, i) => arm((i * 2 * Math.PI) / ARMS));

export function eddy(size = 16, label = 'Working') {
  const box = document.createElement('span');
  box.className = 'eddy';
  box.style.setProperty('--s', size + 'px');
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', label);
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'eddy-turn');
  PATHS.forEach((d, i) => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('pathLength', '1');
    p.setAttribute('class', 'eddy-arm');
    p.style.setProperty('--i', i);
    g.append(p);
  });
  const core = document.createElementNS(NS, 'circle');
  core.setAttribute('cx', '12');
  core.setAttribute('cy', '12');
  core.setAttribute('r', '1.4');
  core.setAttribute('class', 'eddy-core');
  s.append(g, core);
  box.append(s);
  return box;
}
