// Applies the saved theme before first paint. Light is the default.
(() => {
  let theme = 'light';
  try { theme = JSON.parse(localStorage.getItem('rill.settings') || '{}').theme || 'light'; } catch { /* keep light */ }
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
