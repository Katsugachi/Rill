"""End-to-end checks with the mock engine (no GPU needed).

Run:  python3 -m http.server 8080 &   then   python3 tests/e2e.py
Env:  RILL_URL (default http://localhost:8080/), CHROME (optional executable path)
"""
import os, sys, json
from playwright.sync_api import sync_playwright

URL = os.environ.get("RILL_URL", "http://localhost:8080/")
SHOTS = os.environ.get("RILL_SHOTS", "/tmp/rill-shots")
os.makedirs(SHOTS, exist_ok=True)
failures = []

def wait_until(page, fn, timeout=15000):
    # page.wait_for_function uses eval, which Rill's CSP (correctly) blocks.
    import time
    end = time.time() + timeout / 1000
    while time.time() < end:
        if page.evaluate(fn): return
        page.wait_for_timeout(100)
    raise TimeoutError("wait_until: " + fn)

def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond: failures.append(msg)

with sync_playwright() as p:
    kw = {"executable_path": os.environ["CHROME"]} if os.environ.get("CHROME") else {}
    browser = p.chromium.launch(**kw)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors, dialogs = [], []
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
    page.goto(URL + "?mock")
    page.wait_for_selector(".welcome")
    page.wait_for_selector("#statusPill[data-state=ready]")
    check(page.locator("#loadCard").count() == 0, "model line hides when ready")
    check(page.inner_text("#statusText") == "Demo", "status reads Demo in demo mode")
    page.wait_for_timeout(400)
    page.screenshot(path=f"{SHOTS}/01-welcome.png")

    # Maths -> run_js tool in sandbox
    page.fill("#input", "What is 17.5% of 2349.80?")
    page.keyboard.press("Enter")
    page.wait_for_selector(".tool:not(.running)")
    wait_until(page, "() => !window.rill.state.busy")
    page.locator(".tool summary").first.click()
    res = page.locator(".tool-detail pre").last.inner_text()
    check("411.215" in res, f"sandbox computed result ({res!r})")
    page.screenshot(path=f"{SHOTS}/02-math.png")

    # Sandbox isolation
    iso = page.evaluate("""async () => {
      const { runJS } = await import('./js/tools/run-js.js');
      const r = {};
      r.fetch = await runJS('typeof fetch');
      r.idb = await runJS('typeof indexedDB');
      r.parent = await runJS('typeof parent');
      r.loop = await runJS('while(true){}', { timeout: 800 });
      r.math = await runJS('[1,2,3].reduce((a,b)=>a+b)');
      r.await = await runJS('const x = await Promise.resolve(5); console.log(x*2)');
      r.cookie = await runJS('typeof document');
      return r;
    }""")
    check(iso["fetch"]["result"] == "undefined", "sandbox: fetch removed")
    check(iso["idb"]["result"] == "undefined", "sandbox: indexedDB removed")
    check(iso["cookie"]["result"] == "undefined", "sandbox: no document")
    check("Timed out" in iso["loop"]["error"], "sandbox: infinite loop killed")
    check(iso["math"]["result"] == "6", "sandbox: completion value returned")
    check(iso["await"]["output"] == "10", "sandbox: top-level await")

    # XSS: model output with markup must render inert
    page.fill("#input", "xss test <img src=x onerror=alert(1)>")
    page.keyboard.press("Enter")
    wait_until(page, "() => !window.rill.state.busy")
    check(page.locator(".thread img").count() == 0 and page.locator(".thread script").count() == 0, "xss: no img/script elements created")
    check(page.locator(".thread a[href^='javascript']").count() == 0, "xss: no javascript: links")
    check(not dialogs, "xss: no alert fired")
    tt = page.evaluate("() => { try { document.body.innerHTML = '<b>x</b>'; return 'allowed'; } catch (e) { return 'blocked'; } }")
    check(tt == "blocked", "trusted types: innerHTML blocked")

    # Plan -> autonomous run -> summary
    page.fill("#input", "Make a plan for my weekend project")
    page.keyboard.press("Enter")
    page.wait_for_selector(".plan-card")
    page.wait_for_timeout(600)
    page.screenshot(path=f"{SHOTS}/03-plan-running.png")
    wait_until(page, "() => window.rill.state.plans.at(-1)?.status === 'done'", 30000)
    plan = page.evaluate("window.rill.state.plans.at(-1)")
    check(all(s["status"] == "done" and s["result"] for s in plan["steps"]), "plan: every step done with a result")
    check(page.locator(".msg-assistant .md h2, .msg-assistant .md h3").count() > 0, "plan: summary rendered")
    check(page.locator(".caret").count() == 0 and page.locator(".typing").count() == 0, "no streaming indicators left after finishing")
    page.wait_for_timeout(3500)
    page.screenshot(path=f"{SHOTS}/04-plan-done.png")

    # Upload text + PDF-type validation
    page.set_input_files("#fileInput", files=[{"name": "notes.md", "mimeType": "text/markdown", "buffer": b"# Worksheet\n\nQ1: what is photosynthesis?"}])
    page.wait_for_selector(".attachments .file-chip:not(.loading)")
    page.set_input_files("#fileInput", files=[{"name": "fake.pdf", "mimeType": "application/pdf", "buffer": b"<script>alert(1)</script>"}])
    page.wait_for_selector(".toast.error")
    check("Not a valid PDF" in page.locator(".toast.error").last.inner_text(), "upload: fake PDF rejected")
    page.set_input_files("#fileInput", files=[{"name": "bin.txt", "mimeType": "text/plain", "buffer": b"ab\x00\x01cd"}])
    page.wait_for_timeout(300)
    check(any("binary" in t for t in page.locator(".toast.error").all_inner_texts()), "upload: binary rejected")
    if page.get_attribute("#shell", "data-panel") != "open": page.click("#togglePanel")
    page.click("#tab-files")
    check(page.locator("#pane-files .card").count() == 1, "upload: file listed in panel")
    page.screenshot(path=f"{SHOTS}/05-files.png")

    page.click("#closePanel"); page.click("#openSettings"); page.wait_for_timeout(400)
    page.screenshot(path=f"{SHOTS}/07-settings.png")
    page.keyboard.press("Escape")

    # Persistence across reload
    page.reload(); page.wait_for_selector(".chat-item")
    check(page.locator(".chat-item").count() >= 1, "chats persisted across reload")

    # Mobile layout
    m = browser.new_page(viewport={"width": 390, "height": 844})
    m.goto(URL + "?mock"); m.wait_for_selector(".welcome")
    m.wait_for_selector("#statusPill[data-state=ready]", state="attached"); m.wait_for_timeout(400)
    m.screenshot(path=f"{SHOTS}/06-mobile.png")
    m.fill("#input", "What is 17.5% of 2349.80?"); m.keyboard.press("Enter")
    m.wait_for_selector(".tool:not(.running)"); wait_until(m, "() => !window.rill.state.busy"); m.wait_for_timeout(500)
    m.screenshot(path=f"{SHOTS}/08-mobile-chat.png")
    # Real (non-demo) welcome: model not loaded
    r = browser.new_page(viewport={"width": 1440, "height": 900})
    r.goto(URL); r.wait_for_selector("#loadCard"); r.wait_for_timeout(500)
    check(r.inner_text("#statusText") == "Not loaded", "status reads Not loaded before loading")
    r.screenshot(path=f"{SHOTS}/00-welcome-unloaded.png")

    real = [e for e in errors if "favicon" not in e]
    check(not real, "no console errors: " + json.dumps(real[:5]))
    browser.close()

print(f"\n{len(failures)} failure(s)")
sys.exit(1 if failures else 0)
