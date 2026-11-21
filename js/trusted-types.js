// Trusted Types default policy. The CSP requires Trusted Types, so every DOM
// "injection sink" (innerHTML, script src, Worker URLs, eval…) goes through here.
// Rill never needs HTML or script strings, so those always throw; script URLs
// are allowed only for files that ship with Rill (same origin + same base path).
(() => {
  if (!window.trustedTypes?.createPolicy) return;
  const base = new URL('.', document.baseURI).href;
  const reject = (kind) => () => { throw new TypeError(`Rill blocked a ${kind} injection (Trusted Types).`); };
  window.trustedTypes.createPolicy('default', {
    createHTML: reject('HTML'),
    createScript: reject('script'),
    createScriptURL: (url) => {
      const u = new URL(url, document.baseURI);
      if (u.href.startsWith(base) || u.protocol === 'blob:' && u.origin === location.origin) return u.href;
      throw new TypeError('Rill blocked a script URL: ' + u.origin);
    },
  });
})();
