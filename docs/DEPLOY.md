# Deployment

Rill is static files. Deploy the repository root (or just `index.html`, `sandbox.html`, `css/`, `js/`, `assets/`, `vendor/`, `.nojekyll`).

## GitHub Pages (recommended)

1. Push the repository to GitHub.
2. Go to **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**.
3. Push to `main`, or run **Deploy to GitHub Pages** from the Actions tab.

`.github/workflows/pages.yml` runs `node --test tests/*.test.mjs`, copies the site files into
`_site/`, and publishes them with `actions/deploy-pages`. `.nojekyll` stops Jekyll from processing the files.

Things that make Rill work on Pages:

- **Relative paths everywhere**, so it works at `https://<user>.github.io/<repo>/` and at a custom domain root.
- **CSP in a `<meta>` tag**, because Pages can't send custom headers.
- **No cross-origin isolation needed.** WebGPU doesn't need `SharedArrayBuffer`. The WASM fallback
  runs single-threaded on Pages, which is slower but works.
- **Large binaries.** `vendor/ort/*.wasm` (26 MB and 14 MB) are under GitHub's 100 MB file limit.
  The model weights are *not* in the repo. The browser downloads them from Hugging Face and caches them.

### Custom domain

Add a `CNAME` file or set the domain in Settings → Pages. A dedicated domain gives Rill its own
origin, so its IndexedDB isn't shared with your other `github.io` project sites (see [SECURITY.md](SECURITY.md)).

## Other static hosts

Netlify, Cloudflare Pages, Vercel and S3 all work with the same files. If the host lets you set
headers, add these for extra hardening:

```
Content-Security-Policy: frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless   # enables multi-threaded WASM fallback
```

`.wasm` files must be served as `application/wasm`. `.mjs` files must be served as `text/javascript`.

## Local

```bash
python3 -m http.server 8080
```

Use `http://localhost`, not `file://`. Browsers treat localhost as a secure context, so WebGPU works there.
