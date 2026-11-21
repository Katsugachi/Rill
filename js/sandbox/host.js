// Runs inside the sandboxed iframe. Each job gets a fresh blob Worker with
// network and storage APIs removed, and is terminated on timeout.
(function () {
  'use strict';
  var WORKER_SRC = [
    '"use strict";',
    '(function lock(g){',
    '  var names=["fetch","XMLHttpRequest","WebSocket","WebTransport","EventSource","importScripts","indexedDB","caches",',
    '    "BroadcastChannel","Worker","SharedWorker","navigator","location","Request","Response","Headers","FileReader",',
    '    "FileSystemHandle","WebAssembly","Notification","postMessage","close","onmessage","addEventListener","removeEventListener"];',
    '  var protos=[g]; var p=Object.getPrototypeOf(g); while(p&&p!==Object.prototype){protos.push(p);p=Object.getPrototypeOf(p);}',
    '  names.forEach(function(n){protos.forEach(function(o){try{delete o[n];}catch(e){}',
    '    try{if(n in o)Object.defineProperty(o,n,{value:undefined,configurable:false,writable:false});}catch(e){}});});',
    '})',
  ].join('\n');

  function fmt(v, depth) {
    depth = depth || 0;
    if (typeof v === 'string') return depth ? JSON.stringify(v) : v;
    if (typeof v === 'number' || typeof v === 'boolean' || v == null || typeof v === 'bigint') return String(v) + (typeof v === 'bigint' ? 'n' : '');
    if (typeof v === 'function') return '[Function ' + (v.name || 'anonymous') + ']';
    if (v instanceof Error) return v.name + ': ' + v.message;
    if (depth > 3) return '…';
    if (Array.isArray(v)) return '[' + v.slice(0, 100).map(function (x) { return fmt(x, depth + 1); }).join(', ') + (v.length > 100 ? ', …' : '') + ']';
    if (v instanceof Map) return 'Map(' + v.size + ')';
    if (v instanceof Set) return 'Set(' + v.size + ') ' + fmt(Array.from(v), depth + 1);
    if (v instanceof Date) return v.toISOString();
    try { var k = Object.keys(v).slice(0, 50); return '{' + k.map(function (x) { return x + ': ' + fmt(v[x], depth + 1); }).join(', ') + '}'; } catch (e) { return String(v); }
  }

  // Runner executed inside the worker. Written as a function so it is
  // serialised with toString(); it captures nothing from this scope.
  function runner(fmtSrc) {
    var fmt = (0, eval)('(' + fmtSrc + ')');
    var out = [];
    var size = 0;
    function push(kind, args) {
      if (size > 20000) return;
      var line = Array.prototype.map.call(args, function (a) { return fmt(a); }).join(' ');
      size += line.length;
      out.push(kind === 'log' ? line : kind + ': ' + line);
    }
    var con = { log: function () { push('log', arguments); }, info: function () { push('log', arguments); },
      warn: function () { push('warn', arguments); }, error: function () { push('error', arguments); },
      table: function (d) { push('log', [d]); } };
    var reply = self.postMessage.bind(self);
    self.onmessage = function (e) {
      var code = String(e.data.code);
      self.console = con;
      var lock = e.data.lock; (0, eval)(lock)(self);
      var finish = function (ok, val) {
        var res = ok && val !== undefined ? fmt(val) : '';
        reply({ ok: ok, output: out.join('\n'), result: res, error: ok ? '' : fmt(val) });
      };
      try {
        var isAsync = /\bawait\b/.test(code);
        var value = isAsync ? (0, eval)('(async () => {\n' + code + '\n})()') : (0, eval)(code);
        Promise.resolve(value).then(function (v) { finish(true, v); }, function (err) { finish(false, err); });
      } catch (err) { finish(false, err); }
    };
  }

  var parentWin = window.parent;
  window.addEventListener('message', function (e) {
    if (e.source !== parentWin) return;
    var d = e.data || {};
    if (d.type !== 'run' || typeof d.code !== 'string') return;
    var timeout = Math.min(Math.max(+d.timeout || 5000, 100), 30000);
    var src = '(' + runner.toString() + ')(' + JSON.stringify(fmt.toString()) + ');';
    var url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    var w = new Worker(url);
    URL.revokeObjectURL(url);
    var done = false;
    var send = function (r) {
      if (done) return; done = true; clearTimeout(timer); w.terminate();
      r.type = 'result'; r.id = d.id;
      parentWin.postMessage(r, '*');
    };
    var timer = setTimeout(function () { send({ ok: false, output: '', result: '', error: 'Timed out after ' + timeout / 1000 + 's (infinite loop?)' }); }, timeout);
    w.onmessage = function (m) { send(m.data || {}); };
    w.onerror = function (err) { err.preventDefault(); send({ ok: false, output: '', result: '', error: err.message || 'Error' }); };
    w.postMessage({ code: d.code.slice(0, 50000), lock: WORKER_SRC });
  });
  parentWin.postMessage({ type: 'sandbox-ready' }, '*');
})();
