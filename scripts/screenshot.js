#!/usr/bin/env node
/**
 * Full-page, high-quality screenshots of authenticated pages.
 *
 * Connects to a Chrome you launched with remote debugging enabled, so your
 * existing login (e.g. company SSO) is reused. Emulates an exact viewport width
 * with a 2x device scale factor and saves a full-page PNG.
 *
 * OUTPUT
 *   Each run gets its own folder, with one subfolder per viewport width:
 *     screenshots/<YYYY-MM-DD_HH-MM-SS>/1440w/   screenshots/<YYYY-MM-DD_HH-MM-SS>/375w/ ...
 *   Inside, per page:
 *   - Vertical slices, each under 4096 device px so Figma keeps them sharp, named
 *     <page>_<width>w_part1of7@2x.png ... Figma reads "@2x" and places them at 1x size.
 *     In Figma: drag all parts in together, select them, Shift+A (Auto layout), vertical, gap 0.
 *   - One stitched full-page PNG (<page>_<width>w_full@2x.png).
 *     Use --no-full to skip it. (Figma will blur it; it's for other tools/archiving.)
 *
 * ONE-TIME SETUP
 *   1. In this folder:  npm install playwright-core pngjs
 *   2. Launch a debug Chrome (separate profile, so your main Chrome is untouched):
 *        open -na "Google Chrome" --args --remote-debugging-port=9222 \
 *          --user-data-dir="$HOME/.chrome-screenshot-profile" \
 *          --disable-backgrounding-occluded-windows --disable-renderer-backgrounding
 *      (the last two flags keep Chrome rendering while the window is behind other apps —
 *       needed by carousel.js, harmless here)
 *   3. In that Chrome window, sign in to the site once. It stays signed in.
 *
 * USAGE
 *   node screenshot.js --current                       capture the tab currently shown in the debug Chrome
 *   node screenshot.js --current --width 1440,1024,375 several viewports in one run (one subfolder each)
 *   node screenshot.js <url> [<url> ...]               or give URLs (reuses a matching open tab if any)
 *   node screenshot.js <url> --reload                  reuse the matching open tab but reload it first
 *   --scale 2                                          device scale factor (2 = retina)
 *   --settle 700                                       ms to let the page re-layout after the viewport grows
 *   --no-full                                          skip the single stitched full-page PNG
 *   --run-name <name>                                  use screenshots/<name>/ instead of a timestamp folder
 *
 * HOW IT CAPTURES
 *   The page is first scrolled through at the normal viewport so lazy content loads, then the
 *   emulated viewport is grown to the full page height and the page is given time to react
 *   (reveal-on-scroll sections, carousels, resize handlers). Animations are snapped to their end
 *   state and the page is captured in one pass, so sticky elements appear exactly once.
 *
 * If a URL you pass is already open in a tab of the debug Chrome, that tab is reused
 * as-is (no new tab, no navigation). Otherwise a new tab is opened and closed afterwards.
 *
 * EXAMPLE
 *   node screenshot.js https://example.com/about/ --width 1440,375
 */

const path = require("path");
const fs = require("fs");
const http = require("http");

let chromium, PNG;
try {
  ({ chromium } = require("playwright-core"));
  ({ PNG } = require("pngjs"));
} catch {
  console.error("Missing dependencies. In this folder run:  npm install playwright-core pngjs");
  process.exit(1);
}

// ---------- args ----------
const args = process.argv.slice(2);
const FIGMA_MAX = 4096; // Figma downsamples any image with a side longer than this (device px)
const opts = {
  widths: [1440],  // viewport width(s) in css px — comma-separated on the command line
  height: 900,     // viewport height (css px) used while loading and for placing fixed overlays
  scale: 2,        // device scale factor → 2 = retina
  settle: 700,     // ms to let the page re-layout after the viewport is grown to full height
  out: "screenshots",
  runName: null,   // folder name for this run; defaults to a timestamp
  port: 9222,
  current: false,
  reload: false,
  full: true,
};
const urls = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--width") opts.widths = args[++i].split(",").map((s) => parseInt(s.trim(), 10)).filter(Boolean);
  else if (a === "--run-name") opts.runName = args[++i];
  else if (a === "--height") opts.height = parseInt(args[++i], 10);
  else if (a === "--scale") opts.scale = parseFloat(args[++i]);
  else if (a === "--settle") opts.settle = parseInt(args[++i], 10);
  else if (a === "--out") opts.out = args[++i];
  else if (a === "--port") opts.port = parseInt(args[++i], 10);
  else if (a === "--current") opts.current = true;
  else if (a === "--reload") opts.reload = true;
  else if (a === "--no-full") opts.full = false;
  else if (a.startsWith("--")) {
    console.error(`Unknown flag: ${a}`);
    process.exit(1);
  } else urls.push(a);
}
if (urls.length === 0 && !opts.current) {
  console.error(
    "Usage: node screenshot.js <url> [<url> ...] [--width 1440] [--scale 2] [--out screenshots]\n" +
    "       node screenshot.js --current      (capture the tab currently shown in the debug Chrome)"
  );
  process.exit(1);
}

// ---------- helpers ----------
function debugChromeIsUp(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/json/version", timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

function fileNameFor(url, width) {
  const u = new URL(url);
  const slug = (u.pathname.replace(/\/+$/, "").split("/").filter(Boolean).pop() || u.hostname)
    .replace(/[^a-z0-9-_]+/gi, "-")
    .toLowerCase();
  return `${slug}_${width}w`;
}

// Folder name for this run, in local time: 2026-09-17_14-32-05
function runFolderName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

// Normalise URLs so "…/about" and "…/about/#top" count as the same tab.
function sameUrl(a, b) {
  try {
    const norm = (s) => {
      const u = new URL(s);
      u.hash = "";
      return (u.origin + u.pathname.replace(/\/+$/, "") + u.search).toLowerCase();
    };
    return norm(a) === norm(b);
  } catch {
    return false;
  }
}

// Find an already-open tab in the debug Chrome for this URL, if any.
function findOpenTab(context, url) {
  return context.pages().find((p) => sameUrl(p.url(), url)) || null;
}

// Find the tab currently visible to the user (one per window; take the first).
async function findCurrentTab(context) {
  for (const p of context.pages()) {
    if (p.url().startsWith("chrome://") || p.url().startsWith("devtools://")) continue;
    const visible = await p.evaluate(() => document.visibilityState === "visible").catch(() => false);
    if (visible) return p;
  }
  return null;
}

// Jump finite animations/transitions (fade-ins, reveals) to their end state and pause infinite
// ones (marquees, spinners) so each captured screen is stable. Runs after every scroll step.
async function settleAnimations(page) {
  await page
    .evaluate(() => {
      for (const a of document.getAnimations()) {
        try {
          const t = a.effect && a.effect.getTiming();
          if (t && t.iterations === Infinity) a.pause();
          else a.finish();
        } catch {}
      }
    })
    .catch(() => {});
}

// Pin position:fixed overlays (floating play/pause button, cookie bar…) to the spot where they
// sit on the first screen. Once the viewport is grown to the full page, a fixed element would
// otherwise anchor to the bottom of the whole page. Measured at the normal viewport, scrollY 0.
async function pinFixedOverlays(page) {
  await page
    .evaluate(() => {
      for (const el of document.body.querySelectorAll("*")) {
        if (el.dataset.ssPinned) continue;
        if (getComputedStyle(el).position !== "fixed") continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        el.dataset.ssPinned = el.getAttribute("style") || "__unset__";
        el.style.setProperty("position", "absolute", "important");
        el.style.setProperty("top", `${r.top + window.scrollY}px`, "important");
        el.style.setProperty("left", `${r.left + window.scrollX}px`, "important");
        el.style.setProperty("right", "auto", "important");
        el.style.setProperty("bottom", "auto", "important");
        el.style.setProperty("margin", "0", "important");
      }
    })
    .catch(() => {});
}

async function unpinFixedOverlays(page) {
  await page
    .evaluate(() => {
      for (const el of document.querySelectorAll("[data-ss-pinned]")) {
        const prev = el.dataset.ssPinned;
        if (prev === "__unset__") el.removeAttribute("style");
        else el.setAttribute("style", prev);
        delete el.dataset.ssPinned;
      }
      window.scrollTo(0, 0);
    })
    .catch(() => {});
}

// Read width/height from a PNG's IHDR chunk (no dependencies).
function pngDimensions(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// Stack PNG buffers vertically into one PNG buffer.
function stitchBuffers(buffers) {
  if (buffers.length === 1) return buffers[0];
  const parts = buffers.map((b) => PNG.sync.read(b));
  const width = parts[0].width;
  const height = parts.reduce((s, p) => s + p.height, 0);
  const out = new PNG({ width, height });
  let offset = 0;
  for (const p of parts) {
    p.data.copy(out.data, offset);
    offset += p.data.length;
  }
  return PNG.sync.write(out);
}

// Scroll through the page so lazy-loaded images/sections render, then return to top.
async function primeLazyContent(page) {
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    const total = () => document.documentElement.scrollHeight;
    for (let y = 0; y < total(); y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, total());
    await new Promise((r) => setTimeout(r, 400));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 400));
  });
}

// ---------- main ----------
(async () => {
  if (!(await debugChromeIsUp(opts.port))) {
    console.error(
      `\nNo Chrome with remote debugging found on port ${opts.port}.\n` +
      `Launch one with:\n\n` +
      `  open -na "Google Chrome" --args --remote-debugging-port=${opts.port} ` +
      `--user-data-dir="$HOME/.chrome-screenshot-profile" \\\n` +
      `    --disable-backgrounding-occluded-windows --disable-renderer-backgrounding\n\n` +
      `Sign in to the site in that window, then re-run this script.\n`
    );
    process.exit(1);
  }

  // Every run gets its own folder: screenshots/2026-09-17_14-32-05/  (or --run-name)
  const runDir = path.resolve(__dirname, opts.out, opts.runName || runFolderName());
  fs.mkdirSync(runDir, { recursive: true });
  console.log(`Saving to ${path.relative(process.cwd(), runDir)}/`);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${opts.port}`);
  const context = browser.contexts()[0]; // default context = your signed-in profile

  // Build the work list: either the currently visible tab, or one entry per URL.
  const jobs = [];
  if (opts.current) {
    const page = await findCurrentTab(context);
    if (!page) {
      console.error("Couldn't find a visible tab in the debug Chrome. Open the page there and re-run.");
      await browser.close();
      process.exit(1);
    }
    jobs.push({ url: page.url(), page, existing: true });
  }
  for (const url of urls) {
    const page = findOpenTab(context, url);
    jobs.push({ url, page, existing: !!page });
  }

  for (const job of jobs) {
    const { url, existing } = job;
    const page = job.page || (await context.newPage());
    let cdp;
    try {
      // Exact viewport + device scale factor, applied via CDP so it works on the signed-in context.
      // (Do NOT call page.setViewportSize here: it silently resets deviceScaleFactor to 1.)
      cdp = await context.newCDPSession(page);
      const applyMetrics = (width) =>
        cdp.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: opts.height,
          deviceScaleFactor: opts.scale,
          mobile: false,
        });
      await applyMetrics(opts.widths[0]);

      console.log(`→ ${url}${existing ? "  (reusing open tab)" : ""}`);
      if (!existing) {
        await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 });
      } else if (opts.reload) {
        await page.reload({ waitUntil: "networkidle", timeout: 90_000 });
      } else {
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      }

      // Detect a login redirect instead of silently capturing a sign-in page.
      const finalUrl = page.url();
      if (/accounts\.google\.com|login\.microsoftonline|okta|auth0|login|signin|sso/i.test(finalUrl) && !sameUrl(finalUrl, url)) {
        console.error(`  Redirected to ${finalUrl}\n  Sign in in the debug Chrome window, then re-run.`);
        continue;
      }

      // One subfolder per viewport width: screenshots/<run>/1440w/, screenshots/<run>/375w/ ...
      for (const width of opts.widths) {
      const outDir = path.join(runDir, `${width}w`);
      fs.mkdirSync(outDir, { recursive: true });
      console.log(`  ${width}px viewport → ${path.relative(process.cwd(), outDir)}/`);

      await applyMetrics(width); // (re)assert: after navigation, and for each new width
      await page.waitForTimeout(400);
      await primeLazyContent(page);
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(800);

      const dpr = await page.evaluate(() => window.devicePixelRatio);
      if (dpr !== opts.scale) {
        console.warn(`  warning: page reports devicePixelRatio ${dpr}, expected ${opts.scale}`);
      }

      // --- One-shot full-page capture, done in a way the page's scripts can keep up with ---
      // 1. Note where fixed overlays (play/pause button etc.) sit on the first screen.
      // 2. Grow the emulated viewport to the full page height and *wait*, so reveal-on-scroll
      //    sections, carousels and resize handlers all get to run with everything "in view".
      //    (Chrome's built-in capture-beyond-viewport stretches the viewport only for the instant
      //    of the capture, which is why scroll-driven sections came out collapsed before.)
      // 3. Snap animations to their end state, pin fixed overlays where a visitor sees them,
      //    then capture the page in Figma-sized slices. Sticky elements appear once, in place.
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(200);
      await pinFixedOverlays(page); // measured at the normal viewport, applied after the resize

      let pageH = await page.evaluate(() => document.documentElement.scrollHeight);
      const normalH = pageH;
      for (let i = 0; i < 4; i++) {
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: pageH,
          deviceScaleFactor: opts.scale,
          mobile: false,
        });
        await page.waitForTimeout(opts.settle);
        await settleAnimations(page);
        await page.waitForTimeout(150);
        const h = await page.evaluate(() => document.documentElement.scrollHeight);
        if (h === pageH) break; // layout is stable at this height
        pageH = h;
      }
      if (Math.abs(pageH - normalH) > normalH * 0.1) {
        console.warn(`  note: page height changed from ${normalH} to ${pageH} css px when the viewport grew (vh-based layout?)`);
      }
      await page.evaluate(() => window.scrollTo(0, 0));

      const base = fileNameFor(finalUrl, width);
      const suffix = opts.scale === 1 ? "" : `@${opts.scale}x`; // Figma reads @2x and places at half size
      const outputs = [];
      const chunks = [];

      // --- Slices for Figma: each <= FIGMA_MAX device px tall ---
      const sliceCss = Math.floor(FIGMA_MAX / opts.scale);
      const count = Math.ceil(pageH / sliceCss);
      const pad = String(count).length;
      for (let i = 0; i < count; i++) {
        const y = i * sliceCss;
        const h = Math.min(sliceCss, pageH - y);
        const { data } = await cdp.send("Page.captureScreenshot", {
          format: "png",
          clip: { x: 0, y, width, height: h, scale: 1 },
        });
        const png = Buffer.from(data, "base64");
        chunks.push(png);
        const name = `${base}_part${String(i + 1).padStart(pad, "0")}of${count}${suffix}.png`;
        const file = path.join(outDir, name);
        fs.writeFileSync(file, png);
        outputs.push(file);
      }
      console.log(`  ${count} slice${count === 1 ? "" : "s"} → ${path.relative(process.cwd(), outDir)}/${base}_part*${suffix}.png`);

      // --- One stitched full-page PNG (Figma will blur this one; it's for other tools/archiving) ---
      if (opts.full && count > 1) {
        const file = path.join(outDir, `${base}_full${suffix}.png`);
        fs.writeFileSync(file, stitchBuffers(chunks));
        outputs.push(file);
        console.log(`  full-page → ${path.relative(process.cwd(), file)}`);
      }

      const first = pngDimensions(fs.readFileSync(outputs[0]));
      const totalMb = outputs.reduce((s, f) => s + fs.statSync(f).size, 0) / 1024 / 1024;
      console.log(`  ${width}×${pageH} css px @${opts.scale}x → ${first.width}px wide, ${totalMb.toFixed(1)} MB total`);

      await unpinFixedOverlays(page);
      await applyMetrics(width); // back to a normal-height viewport before the next width
      } // end per-width loop
    } catch (err) {
      console.error(`  failed: ${err.message}`);
    } finally {
      if (existing) {
        // Leave your tab as you had it: drop the viewport emulation instead of closing it.
        if (cdp) await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
      } else {
        await page.close().catch(() => {});
      }
    }
  }

  await browser.close(); // disconnects only; your Chrome stays open
})();
