#!/usr/bin/env node
/**
 * Step through a carousel / tabbed timeline and screenshot every card, at one or more viewports.
 *
 * Works with any carousel, slider, tabbed section or timeline. Run it with --detect first and it
 * lists the carousels it finds on the page, with the selectors to use for each (Screenshot.command
 * does this for you and lets you pick). Two ways of stepping through the cards:
 *   --tabs "<sel>"   click each dot / tab / year button in turn (preferred: the count is known)
 *   --next "<sel>"   carousels with only arrows: press "next" until it's disabled or loops back
 *
 * Connects to a Chrome you launched with remote debugging (same setup as screenshot.js), so
 * your existing login is reused and real mouse clicks drive the carousel.
 *
 * ONE-TIME SETUP (already done if screenshot.js works)
 *   npm install playwright-core pngjs
 *   open -na "Google Chrome" --args --remote-debugging-port=9222 \
 *     --user-data-dir="$HOME/.chrome-screenshot-profile" \
 *     --disable-backgrounding-occluded-windows --disable-renderer-backgrounding
 *
 *   The last two flags stop Chrome from pausing rendering when the window is hidden behind
 *   other apps — without them, clicks can hang while you're looking at the Terminal. If your
 *   debug Chrome is already running without the flags, quit it (Cmd+Q) and relaunch with the
 *   line above. Either way, keep the window un-minimised while this runs; the script also brings
 *   it to the front by itself.
 *
 * USAGE
 *   node carousel.js --current --detect             list the carousels on the visible tab, then exit
 *   node carousel.js --current                      use the tab currently shown in the debug Chrome
 *   node carousel.js <url>                          or give the page URL (reuses the tab if open)
 *   --width 1440,1024                               one or more viewport widths (default 1440)
 *   --scale 2                                       device scale factor (default 2 = retina)
 *   --section "section.team-carousel"               the carousel section (required; --detect tells you)
 *   --tabs "[role=tab]"                             clickable items inside the section, one per card (default shown)
 *   --next ".slick-next"                            arrow-only carousels: the "next" button (instead of --tabs)
 *   --prev ".slick-prev"                            its "previous" button, used to rewind to the first card
 *   --max 30                                        arrow mode: stop after this many cards
 *   --label team                                    name used in the file names (default: from --section)
 *   --card-only                                    crop to the active card instead of the whole section
 *   --card ".card-active"                           selector for the active card (used with --card-only)
 *   --pad 0                                         extra css px around the crop
 *   --settle 1300                                   ms to wait after each click for the slide transition
 *   --out screenshots                               parent output folder
 *   --run-name <name>                               use screenshots/<name>/ instead of a timestamp folder
 *
 * OUTPUT
 *   Every run gets its own timestamped folder, and inside it EVERY VIEWPORT GETS ITS OWN
 *   SUBFOLDER, so all cards captured at the same size live together and you never have to
 *   guess which viewport a file came from:
 *
 *     screenshots/
 *       2026-09-17_14-05-00/            ← this run
 *         1440w/                        ← all 9 cards at the 1440px viewport
 *           about_team_1440w_card1of6_alex@2x.png
 *           about_team_1440w_card2of6_sam@2x.png
 *           ...
 *         1024w/                        ← all 9 cards at the 1024px viewport
 *           about_team_1024w_card1of6_alex@2x.png
 *           ...
 *
 *   "@2x" in the name makes Figma place the image at 1x size.
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
const opts = {
  widths: [1440],
  height: 900,
  scale: 2,
  section: null, // required unless --detect
  tabs: "[role=tab]",
  card: ".card-active",
  cardOnly: false,
  pad: 0,
  settle: 1300,
  out: "screenshots",
  runName: null, // folder name for this run; defaults to a timestamp
  port: 9222,
  current: false,
  detect: false,
  next: null, // arrow mode: selector of the "next" button inside the section
  prev: null,
  max: 30,
  label: null,
};
const urls = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--width") opts.widths = args[++i].split(",").map((s) => parseInt(s.trim(), 10)).filter(Boolean);
  else if (a === "--height") opts.height = parseInt(args[++i], 10);
  else if (a === "--scale") opts.scale = parseFloat(args[++i]);
  else if (a === "--section") opts.section = args[++i];
  else if (a === "--tabs") opts.tabs = args[++i];
  else if (a === "--card") opts.card = args[++i];
  else if (a === "--card-only") opts.cardOnly = true;
  else if (a === "--pad") opts.pad = parseInt(args[++i], 10);
  else if (a === "--settle") opts.settle = parseInt(args[++i], 10);
  else if (a === "--out") opts.out = args[++i];
  else if (a === "--run-name") opts.runName = args[++i];
  else if (a === "--port") opts.port = parseInt(args[++i], 10);
  else if (a === "--current") opts.current = true;
  else if (a === "--detect") opts.detect = true;
  else if (a === "--next") opts.next = args[++i];
  else if (a === "--prev") opts.prev = args[++i];
  else if (a === "--max") opts.max = parseInt(args[++i], 10);
  else if (a === "--label") opts.label = args[++i];
  else if (a.startsWith("--")) {
    console.error(`Unknown flag: ${a}`);
    process.exit(1);
  } else urls.push(a);
}
if (!opts.detect && !opts.section) {
  console.error('Missing --section. Run  node carousel.js --current --detect  to list the carousels on the page and their selectors.');
  process.exit(1);
}
if (urls.length === 0 && !opts.current) {
  console.error("Usage: node carousel.js --current [--width 1440,1024]\n       node carousel.js <url> [--width 1440,1024]");
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

function slugify(s) {
  return s.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function pageSlug(url) {
  const u = new URL(url);
  return slugify(u.pathname.replace(/\/+$/, "").split("/").filter(Boolean).pop() || u.hostname);
}

function runFolderName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

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

async function findCurrentTab(context) {
  for (const p of context.pages()) {
    if (p.url().startsWith("chrome://") || p.url().startsWith("devtools://")) continue;
    const visible = await p.evaluate(() => document.visibilityState === "visible").catch(() => false);
    if (visible) return p;
  }
  return null;
}

// Crop a PNG buffer to a css-px rect (viewport-relative), at the given device scale.
function cropPng(buf, rect, scale) {
  const img = PNG.sync.read(buf);
  const x0 = Math.max(0, Math.round(rect.x * scale));
  const y0 = Math.max(0, Math.round(rect.y * scale));
  const x1 = Math.min(img.width, Math.round((rect.x + rect.width) * scale));
  const y1 = Math.min(img.height, Math.round((rect.y + rect.height) * scale));
  const out = new PNG({ width: x1 - x0, height: y1 - y0 });
  for (let y = y0; y < y1; y++) {
    const src = (y * img.width + x0) * 4;
    img.data.copy(out.data, (y - y0) * out.width * 4, src, src + out.width * 4);
  }
  return PNG.sync.write(out);
}

// Wait until the section stops moving (transform / positions stable for a few frames).
async function waitForStill(page, sectionSel, maxMs) {
  const start = Date.now();
  let last = null;
  let stableFrames = 0;
  while (Date.now() - start < maxMs) {
    const sig = await page.evaluate((sel) => {
      const sec = document.querySelector(sel);
      if (!sec) return "";
      return [...sec.querySelectorAll("*")]
        .slice(0, 400)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return `${r.left | 0},${r.top | 0},${getComputedStyle(el).opacity}`;
        })
        .join(";");
    }, sectionSel);
    if (sig === last) {
      if (++stableFrames >= 3) return;
    } else stableFrames = 0;
    last = sig;
    await page.waitForTimeout(100);
  }
}

// Click a tab with real mouse events. If Chrome doesn't acknowledge the click within a few
// seconds (it won't while the window is occluded/minimised), fall back to dispatching the same
// pointer/mouse event sequence straight to the element, then verify the tab became selected.
async function clickTab(page, tab, index) {
  try {
    await tab.click({ timeout: 4000 });
    return;
  } catch {
    process.stdout.write(`  (card ${index + 1}: mouse click stalled — is the Chrome window visible? using direct events)\n`);
  }
  await tab.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true };
    for (const [type, Ctor] of [["pointerover", PointerEvent], ["pointerenter", PointerEvent], ["mouseover", MouseEvent], ["pointerdown", PointerEvent], ["mousedown", MouseEvent]]) el.dispatchEvent(new Ctor(type, init));
    el.focus();
    for (const [type, Ctor] of [["pointerup", PointerEvent], ["mouseup", MouseEvent], ["click", MouseEvent]]) el.dispatchEvent(new Ctor(type, { ...init, buttons: 0 }));
  });
  await page.waitForTimeout(300);
  const selected = await tab.getAttribute("aria-selected").catch(() => null);
  if (selected === "false") {
    throw new Error(
      `card ${index + 1} did not respond to the click. Bring the debug Chrome window to the front (not minimised, ` +
      `not fully covered) and re-run, or relaunch it with --disable-backgrounding-occluded-windows (see header).`
    );
  }
}

// Hide fixed and sticky overlays (floating play/pause button, the jump-links bar that sticks to
// the top of the viewport…) while capturing, so they don't sit on top of the carousel.
// Only visibility is changed, so the layout underneath is untouched. Restored afterwards.
async function setFixedOverlaysHidden(page, hidden, keepSelector) {
  await page
    .evaluate(([hide, keepSel]) => {
      const keep = keepSel ? document.querySelector(keepSel) : null;
      for (const el of document.body.querySelectorAll("*")) {
        if (hide) {
          if (keep && keep.contains(el)) continue; // never touch the carousel itself
          const pos = getComputedStyle(el).position;
          if ((pos === "fixed" || pos === "sticky") && !el.dataset.csHidden) {
            el.dataset.csHidden = el.style.visibility || "__unset__";
            el.style.setProperty("visibility", "hidden", "important");
          }
        } else if (el.dataset.csHidden) {
          const prev = el.dataset.csHidden;
          if (prev === "__unset__") el.style.removeProperty("visibility");
          else el.style.visibility = prev;
          delete el.dataset.csHidden;
        }
      }
    }, [hidden, keepSelector || null])
    .catch(() => {});
}

// ---------- carousel detection (runs inside the page) ----------
// Finds carousels, sliders, tabbed sections and timelines, and works out for each one:
//   section  a selector for the element that wraps it (its heading included when that's cheap)
//   control  the clickable items, one per card (dots, tabs, years…), or the "next" arrow
//   prev     the "previous" arrow (arrow mode only)
//   count    how many cards (known for dots/tabs; an estimate from the slides for arrows)
//   card     a selector for the active card, when the carousel library is recognised
//   label    a human name, from the heading or aria-label
// Must stay self-contained: Playwright serialises it into the page.
function detectCarousels() {
  const CAROUSELISH = /(^|[-_])(carousel|slider|slideshow|swiper|slick|splide|glide|flickity|owl|embla|keen-slider|gallery|timeline|tabs|tabset)([-_]|$)/i;
  const STATE = /(^|[-_])(is|has|js)-|active|selected|current|visible|hidden|enabled|disabled|initiali[sz]ed|ready|loaded|animat|focus|hover|open|show|cloned|duplicate/i;
  const GENERATED = /^(css|sc|jsx|emotion|svelte|ng|tw)-|[0-9a-f]{6,}|\d{3,}|^_/i;
  const NEXT_WORDS = /\b(next|forward|siguiente|suivant|weiter|pr[oó]xim|avanti|volgende)\b/i;
  const PREV_WORDS = /\b(prev|previous|back|anterior|pr[eé]c[eé]dent|zur[uü]ck|indietro|vorige)\b/i;
  const LIBS = [
    // [slides container, dots, next, prev, active card, real slides]
    [".swiper, .swiper-container", ".swiper-pagination-bullet", ".swiper-button-next", ".swiper-button-prev", ".swiper-slide-active", ".swiper-slide:not(.swiper-slide-duplicate)"],
    [".slick-slider", ".slick-dots button, .slick-dots li", ".slick-next", ".slick-prev", ".slick-current", ".slick-slide:not(.slick-cloned)"],
    [".splide", ".splide__pagination__page", ".splide__arrow--next", ".splide__arrow--prev", ".splide__slide.is-active", ".splide__slide:not(.splide__slide--clone)"],
    [".glide", ".glide__bullet", "[data-glide-dir='>']", "[data-glide-dir='<']", ".glide__slide--active", ".glide__slide:not(.glide__slide--clone)"],
    [".flickity-enabled", ".flickity-page-dot", ".flickity-prev-next-button.next", ".flickity-prev-next-button.previous", ".is-selected", ".flickity-slider > *"],
    [".owl-carousel", ".owl-dot", ".owl-next", ".owl-prev", ".owl-item.active", ".owl-item:not(.cloned)"],
    [".carousel", "[data-bs-slide-to], [data-slide-to]", "[data-bs-slide=next], [data-slide=next], .carousel-control-next", "[data-bs-slide=prev], [data-slide=prev], .carousel-control-prev", ".carousel-item.active", ".carousel-item"],
    [".embla", ".embla__dot", ".embla__next, .embla__button--next", ".embla__prev, .embla__button--prev", ".is-selected", ".embla__slide"],
  ];

  const vis = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && parseFloat(cs.opacity) > 0.05;
  };
  const classes = (el) => (el.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean);
  const goodClasses = (el) => classes(el).filter((c) => !STATE.test(c) && !GENERATED.test(c) && /^-?[a-z_][\w-]*$/i.test(c));
  const esc = (s) => CSS.escape(s);
  const count = (sel, root = document) => { try { return root.querySelectorAll(sel).length; } catch { return -1; } };
  const unique = (sel, el) => { try { const m = document.querySelectorAll(sel); return m.length === 1 && m[0] === el; } catch { return false; } };
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

  // A CSS selector that matches exactly this element, preferring readable class names.
  function selectorFor(el, depth = 0) {
    const tag = el.tagName.toLowerCase();
    if (unique(tag, el)) return tag;
    if (el.id && !GENERATED.test(el.id) && /^[a-z][\w-]*$/i.test(el.id) && unique("#" + esc(el.id), el)) return "#" + esc(el.id);
    const gc = goodClasses(el);
    for (const c of gc) if (unique(`${tag}.${esc(c)}`, el)) return `${tag}.${esc(c)}`;
    for (let i = 0; i < gc.length; i++)
      for (let j = i + 1; j < gc.length; j++) {
        const s = `${tag}.${esc(gc[i])}.${esc(gc[j])}`;
        if (unique(s, el)) return s;
      }
    for (const a of ["aria-label", "aria-roledescription", "data-testid", "data-component", "data-module", "data-section"]) {
      const v = el.getAttribute(a);
      if (v && v.length < 60) {
        const s = `${tag}[${a}="${v.replace(/"/g, '\\"')}"]`;
        if (unique(s, el)) return s;
      }
    }
    const parent = el.parentElement;
    if (!parent || depth > 12) return tag;
    const own = gc.length ? `${tag}.${esc(gc[0])}` : tag;
    const same = [...parent.children].filter((c) => c.tagName === el.tagName);
    const step = same.length > 1 ? `${own}:nth-of-type(${same.indexOf(el) + 1})` : own;
    return `${selectorFor(parent, depth + 1)} > ${step}`;
  }

  // Lowest common ancestor of a list of elements.
  function lca(items) {
    let a = items[0].parentElement;
    while (a && !items.every((i) => a.contains(i))) a = a.parentElement;
    return a || document.body;
  }

  // A selector, relative to the container, that matches exactly these items.
  function itemsSelector(items, container) {
    const tag = items[0].tagName.toLowerCase();
    const ok = (s) => count(s, container) === items.length && [...container.querySelectorAll(s)].every((e, i) => e === items[i]);
    if (items.every((i) => i.getAttribute("role") === "tab") && ok("[role=tab]")) return "[role=tab]";
    const common = goodClasses(items[0]).filter((c) => items.every((it) => it.classList.contains(c)));
    for (const c of common) if (ok("." + esc(c))) return "." + esc(c);
    for (const c of common) if (ok(`${tag}.${esc(c)}`)) return `${tag}.${esc(c)}`;
    const group = lca(items);
    const groupSels = goodClasses(group).map((c) => "." + esc(c));
    if (group.getAttribute("role")) groupSels.push(`[role=${group.getAttribute("role")}]`);
    for (const g of groupSels) {
      for (const s of [`${g} > ${tag}`, `${g} ${tag}`, `${g} > * > ${tag}`]) if (ok(s)) return s;
    }
    return null;
  }

  // One selector, relative to the container, for a single button (arrows).
  function buttonSelector(btn, container) {
    const tag = btn.tagName.toLowerCase();
    const ok = (s) => { try { return container.querySelector(s) === btn; } catch { return false; } };
    // Classes that say what the button does (…--next, …-prev, arrow…) first: they're the most stable.
    const cls = goodClasses(btn).sort((a, b) => /next|prev|arrow|forward|back/i.test(b) - /next|prev|arrow|forward|back/i.test(a));
    for (const c of cls) if (ok("." + esc(c))) return "." + esc(c);
    for (const a of ["aria-label", "title", "data-direction", "data-glide-dir", "data-bs-slide", "data-slide"]) {
      const v = btn.getAttribute(a);
      if (v && v.length < 60) {
        const s = `${tag}[${a}="${v.replace(/"/g, '\\"')}"]`;
        if (ok(s)) return s;
      }
    }
    return null;
  }

  const clickable = (el) =>
    /^(button|a|li)$/i.test(el.tagName) || /^(button|tab|link)$/.test(el.getAttribute("role") || "") ||
    el.hasAttribute("tabindex") || getComputedStyle(el).cursor === "pointer";

  // Walk up from the controls to the element that wraps the whole carousel (slides included).
  function containerFor(anchor, mustContain = []) {
    const aBox = anchor.getBoundingClientRect();
    let el = anchor.parentElement, fallback = null;
    while (el && el !== document.body) {
      const r = el.getBoundingClientRect();
      const bigger = r.height > aBox.height + 120;
      if (mustContain.every((m) => el.contains(m)) && bigger) {
        if (el.getAttribute("aria-roledescription") === "carousel" || classes(el).some((c) => CAROUSELISH.test(c)) || el.tagName === "SECTION") return el;
        if (!fallback && r.height >= 250) fallback = el;
      }
      el = el.parentElement;
    }
    return fallback || anchor.parentElement || document.body;
  }

  function labelFor(container) {
    const byAttr = container.getAttribute("aria-label") ||
      (container.getAttribute("aria-labelledby") && clean(document.getElementById(container.getAttribute("aria-labelledby"))?.textContent));
    if (byAttr) return clean(byAttr);
    // The section title is usually the biggest heading in the carousel or in the block just
    // before it (card titles inside the slides are smaller).
    // Ignore headings that belong to a slide or card (those are card titles, not the section's).
    const SLIDEISH = "[class*=slide], [class*=card], [class*=item], [role=tabpanel], [role=group], li";
    const inSlide = (h, scope) => { const x = h.closest(SLIDEISH); return x && x !== scope && scope.contains(x); };
    const before = [];
    for (let sib = container.previousElementSibling, k = 0; sib && k < 2; sib = sib.previousElementSibling, k++) before.push(sib);
    const scopes = [container, ...before, container.closest("section")].filter(Boolean);
    const pool = scopes
      .flatMap((s) => [...(/^H[1-6]$/.test(s.tagName) ? [s] : []), ...s.querySelectorAll("h1,h2,h3,h4,h5")].map((h) => [h, s]))
      .filter(([h, s]) => vis(h) && clean(h.textContent) && !inSlide(h, s) && !/^\d+$/.test(clean(h.textContent)))
      .map(([h]) => h);
    if (pool.length) {
      const size = (e) => parseFloat(getComputedStyle(e).fontSize) || 0;
      return clean(pool.reduce((best, e) => (size(e) > size(best) ? e : best)).textContent);
    }
    return goodClasses(container)[0] || container.tagName.toLowerCase();
  }

  const groups = []; // { kind, items | next/prev, container, card, slides }
  const taken = new Set();
  const addTabs = (items, container, card = null, slides = null) => {
    items = items.filter(vis);
    if (items.length < 2 || items.length > 80 || items.some((i) => taken.has(i))) return;
    items.forEach((i) => taken.add(i));
    groups.push({ kind: "tabs", items, container, card, slides });
  };

  // 1. ARIA tabs (tabbed sections, year timelines)
  for (const tl of document.querySelectorAll("[role=tablist]")) {
    const tabs = [...tl.querySelectorAll("[role=tab]")];
    const panel = tabs[0] && document.getElementById(tabs[0].getAttribute("aria-controls") || "");
    addTabs(tabs, containerFor(tl, panel ? [tl, panel] : [tl]), panel ? "[role=tabpanel]:not([hidden])" : null);
  }
  // 2. Known carousel libraries: dots first, arrows only when there are no dots
  for (const [root, dots, next, prev, card, slides] of LIBS) {
    for (const c of document.querySelectorAll(root)) {
      if (!vis(c)) continue;
      let items = [...c.querySelectorAll(dots)];
      if (!items.length) {
        // some libraries render the dots just outside the slides container
        const near = c.parentElement ? [...c.parentElement.querySelectorAll(dots)] : [];
        items = near;
      }
      if (items.some((i) => i.tagName === "BUTTON")) items = items.filter((i) => i.tagName === "BUTTON");
      const holder = items.length && !c.contains(items[0]) ? lca([c, ...items]) : c;
      if (items.filter(vis).length >= 2) { addTabs(items, holder, card, slides); continue; }
      const n = c.querySelector(next) || c.parentElement?.querySelector(next);
      if (n && vis(n) && !taken.has(n)) {
        taken.add(n);
        const p = c.querySelector(prev) || c.parentElement?.querySelector(prev);
        groups.push({ kind: "next", next: n, prev: p && vis(p) ? p : null, container: c.contains(n) ? c : c.parentElement, card, slides });
      }
    }
  }
  // 3. Anything else that looks like pagination dots / indicators
  // Real links (blog pagination, "page 2") would navigate away, so they never count as dots.
  const realLink = (el) => el.tagName === "A" && /^(https?:|\/|\.)/i.test(el.getAttribute("href") || "") && !/^#/.test(el.getAttribute("href"));
  const DOTS = /(^|[-_])(dots?|bullets?|indicators?|pager|paginations?)([-_]|$)/i;
  for (const el of document.querySelectorAll("[class]")) {
    if (!classes(el).some((c) => DOTS.test(c)) || !vis(el)) continue;
    let items = [...el.children].filter((c) => c.tagName !== "LI" && clickable(c));
    if (items.length < 2) items = [...el.querySelectorAll(":scope > * > button, :scope > * > a, :scope > li[tabindex], :scope > li[role]")];
    if (items.length < 2) items = [...el.children].filter((c) => c.tagName === "LI" && getComputedStyle(c).cursor === "pointer");
    if (items.length >= 2 && !items.some(realLink)) addTabs(items, containerFor(el, [el]));
  }
  // 4. Generic arrow-only carousels: a "next" button inside something carousel-like
  for (const b of document.querySelectorAll("button, a, [role=button]")) {
    if (taken.has(b) || !vis(b) || realLink(b)) continue;
    const words = [b.getAttribute("aria-label"), b.getAttribute("title"), ...classes(b)].filter(Boolean).join(" ").replace(/[-_]/g, " ");
    if (!NEXT_WORDS.test(words) || PREV_WORDS.test(words) || /\b(page|step|chapter|article|post)\b/i.test(words)) continue;
    if (b.closest("nav, header, footer, form")) continue;
    const c = containerFor(b, [b]);
    if (groups.some((g) => g.container.contains(b))) continue; // already covered by its dots
    const p = [...c.querySelectorAll("button, a, [role=button]")].find((x) => x !== b && vis(x) &&
      PREV_WORDS.test([x.getAttribute("aria-label"), x.getAttribute("title"), ...classes(x)].filter(Boolean).join(" ").replace(/[-_]/g, " ")));
    taken.add(b);
    groups.push({ kind: "next", next: b, prev: p || null, container: c, card: null, slides: null });
  }

  // Prefer the enclosing <section> when it holds only this carousel and isn't huge, so the
  // heading comes along in the capture.
  const anchors = groups.map((g) => (g.kind === "tabs" ? g.items[0] : g.next));
  for (const g of groups) {
    const s = g.container.closest("section");
    if (!s || s === g.container) continue;
    const others = anchors.filter((a) => a !== (g.kind === "tabs" ? g.items[0] : g.next) && s.contains(a));
    if (!others.length && s.getBoundingClientRect().height < innerHeight * 1.6) g.container = s;
  }

  const out = [];
  const seen = new Set();
  for (const g of groups) {
    const section = selectorFor(g.container);
    let control, prev = null, cnt;
    if (g.kind === "tabs") {
      control = itemsSelector(g.items, g.container);
      cnt = g.items.length;
    } else {
      control = buttonSelector(g.next, g.container);
      prev = g.prev ? buttonSelector(g.prev, g.container) : null;
      cnt = g.slides ? count(g.slides, g.container) || null : null;
    }
    if (!control || seen.has(section + "|" + control)) continue;
    seen.add(section + "|" + control);
    out.push({
      kind: g.kind, section, control, prev, count: cnt, card: g.card, label: labelFor(g.container).slice(0, 50),
      top: Math.round(g.container.getBoundingClientRect().top + scrollY),
    });
  }
  return out.sort((a, b) => a.top - b.top);
}

// Is a button usable? (arrow mode: stops when "next" is disabled or hidden at the last card)
async function buttonEnabled(loc) {
  if ((await loc.count()) === 0) return false;
  return loc.evaluate((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return !el.disabled && el.getAttribute("aria-disabled") !== "true" && !/(^|[-_ ])(disabled|is-disabled|inactive)([-_ ]|$)/i.test(el.getAttribute("class") || "") &&
      cs.visibility !== "hidden" && cs.display !== "none" && parseFloat(cs.opacity) > 0.2 && r.width > 0 && r.height > 0 && cs.pointerEvents !== "none";
  }).catch(() => false);
}

// A fingerprint of the carousel's current state: which headings, text and images are showing,
// left to right. Content, not positions, so background animations and a looping carousel's
// clones don't fool it (a looping carousel comes back to exactly the first fingerprint).
// Falls back to element positions for carousels without text or images.
async function stateSignature(page, sectionSel) {
  return page.evaluate((sel) => {
    const sec = document.querySelector(sel);
    if (!sec) return "";
    const W = window.innerWidth;
    const content = [...sec.querySelectorAll("h1,h2,h3,h4,h5,h6,p,img,video,figcaption,blockquote,li")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        return r.width > 1 && r.height > 1 && cx >= 0 && cx <= W &&
          (el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true);
      })
      .map((el) => ({
        x: el.getBoundingClientRect().left,
        t: el.tagName === "IMG" ? (el.currentSrc || el.src || "").slice(-80) : (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 50),
      }))
      .filter((o) => o.t)
      .sort((a, b) => Math.round(a.x / 60) - Math.round(b.x / 60))
      .map((o) => o.t)
      .join("|");
    if (content) return content;
    const o = sec.getBoundingClientRect();
    return [...sec.querySelectorAll("*")].slice(0, 400).map((el) => {
      const r = el.getBoundingClientRect();
      return `${(r.left - o.left) | 0},${(r.top - o.top) | 0}`;
    }).join(";");
  }, sectionSel);
}

// ---------- main ----------
(async () => {
  if (!(await debugChromeIsUp(opts.port))) {
    console.error(
      `\nNo Chrome with remote debugging found on port ${opts.port}.\nLaunch one with:\n\n` +
      `  open -na "Google Chrome" --args --remote-debugging-port=${opts.port} --user-data-dir="$HOME/.chrome-screenshot-profile" \\\n` +
      `    --disable-backgrounding-occluded-windows --disable-renderer-backgrounding\n\n` +
      `Sign in to the site in that window, then re-run this script.\n`
    );
    process.exit(1);
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${opts.port}`);
  const context = browser.contexts()[0];

  // Resolve the page to work on.
  let page, existing;
  if (opts.current) {
    page = await findCurrentTab(context);
    if (!page) {
      console.error("Couldn't find a visible tab in the debug Chrome. Open the page there and re-run.");
      await browser.close();
      process.exit(1);
    }
    existing = true;
  } else {
    page = context.pages().find((p) => sameUrl(p.url(), urls[0])) || null;
    existing = !!page;
    if (!page) page = await context.newPage();
  }

  // --detect: list the carousels on the page (one tab-separated line each) and stop.
  // Line format: CAROUSEL  kind(tabs|next)  section  control  prev  count  card  label   ("-" = none)
  if (opts.detect) {
    try {
      if (!existing) await page.goto(urls[0], { waitUntil: "networkidle", timeout: 90_000 });
      // Scroll through the page once so lazily initialised carousels get built, then put it back.
      await page.evaluate(async () => {
        const y0 = window.scrollY;
        const h = document.documentElement.scrollHeight;
        for (let y = 0, n = 0; y < h && n < 60; y += 700, n++) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 60));
        }
        window.scrollTo(0, y0);
        await new Promise((r) => setTimeout(r, 400));
      }).catch(() => {});
      const found = await page.evaluate(detectCarousels);
      const f = (v) => (v === null || v === undefined || v === "" ? "-" : String(v).replace(/[\t\r\n]+/g, " "));
      for (const c of found) console.log(["CAROUSEL", c.kind, c.section, c.control, c.prev, c.count, c.card, c.label].map(f).join("\t"));
    } catch (err) {
      console.error(`detection failed: ${err.message}`);
      process.exitCode = 1;
    } finally {
      if (!existing) await page.close().catch(() => {});
      await browser.close();
    }
    return;
  }

  const outDir = path.resolve(__dirname, opts.out, opts.runName || runFolderName());
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`Saving to ${path.relative(process.cwd(), outDir)}/`);

  const cdp = await context.newCDPSession(page);
  const setViewport = (width, height) =>
    cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: opts.scale, mobile: false });

  try {
    await setViewport(opts.widths[0], opts.height);
    if (!existing) {
      console.log(`→ ${urls[0]}`);
      await page.goto(urls[0], { waitUntil: "networkidle", timeout: 90_000 });
    } else {
      console.log(`→ ${page.url()}  (using open tab)`);
    }
    const slug = pageSlug(page.url());
    const sectionSlug = slugify(opts.label || opts.section.replace(/^section\./, "").replace(/[.#\[\]=:"'>()]/g, "-")).slice(0, 40) || "carousel";
    const suffix = opts.scale === 1 ? "" : `@${opts.scale}x`;

    for (const width of opts.widths) {
      // One subfolder per viewport width: screenshots/<run>/1440w/, screenshots/<run>/1024w/ ...
      const widthDir = path.join(outDir, `${width}w`);
      fs.mkdirSync(widthDir, { recursive: true });
      console.log(`\n${width}px viewport → ${path.relative(process.cwd(), widthDir)}/`);
      await setViewport(width, opts.height);
      await page.waitForTimeout(600);

      const section = page.locator(opts.section).first();
      if ((await section.count()) === 0) {
        console.error(`  no element matches --section "${opts.section}" at this width (the carousel may not exist here)`);
        process.exitCode = 1;
        continue;
      }
      await section.scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);

      // Make sure the whole section fits in the viewport (grow it if the section is taller).
      let secBox = await section.boundingBox();
      const neededH = Math.ceil(secBox.height + opts.pad * 2 + 40);
      const viewportH = Math.max(opts.height, neededH);
      if (viewportH !== opts.height) {
        await setViewport(width, viewportH);
        await page.waitForTimeout(500);
      }

      // Position the section at the top of the viewport, then capture it (or the active card).
      const shoot = async (i) => {
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          const top = el.getBoundingClientRect().top + window.scrollY - 20;
          window.scrollTo(0, Math.max(0, top));
        }, opts.section);
        await page.waitForTimeout(250);

        let rect;
        if (opts.cardOnly) {
          const card = section.locator(opts.card).first();
          rect = (await card.count()) ? await card.boundingBox() : null;
          if (!rect) console.warn(`  card ${i + 1}: no element matches --card "${opts.card}", using the section instead`);
        }
        if (!rect) {
          secBox = await section.boundingBox();
          // Full viewport width so neighbouring cards that peek in are included.
          rect = { x: 0, y: secBox.y, width, height: secBox.height };
        }
        rect = {
          x: rect.x - opts.pad,
          y: rect.y - opts.pad,
          width: rect.width + opts.pad * 2,
          height: rect.height + opts.pad * 2,
        };
        const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
        return cropPng(Buffer.from(data, "base64"), rect, opts.scale);
      };
      const settleAfterClick = async () => {
        await page.waitForTimeout(opts.settle);
        await waitForStill(page, opts.section, 3000);
      };

      await setFixedOverlaysHidden(page, true, opts.section);

      // Chrome stops rendering (and acknowledging mouse input) for windows hidden behind other
      // apps or minimised, so make sure this window is in front before we start clicking.
      await page.bringToFront().catch(() => {});
      await page.waitForTimeout(300);

      if (opts.next) {
        // ---- Arrow mode: press "next" until it's disabled, nothing changes, or it loops back ----
        const nextBtn = section.locator(opts.next).first();
        const prevBtn = opts.prev ? section.locator(opts.prev).first() : null;
        if ((await nextBtn.count()) === 0) {
          console.error(`  no element matches --next "${opts.next}" inside the section`);
          process.exitCode = 1;
          await setFixedOverlaysHidden(page, false);
          continue;
        }

        // Rewind to the first card: press "previous" until it's disabled or the carousel repeats
        // itself (carousels that loop have no first card, so any start is fine for those).
        if (prevBtn && (await buttonEnabled(prevBtn))) {
          const seenRewind = new Set([await stateSignature(page, opts.section)]);
          for (let k = 0; k < opts.max && (await buttonEnabled(prevBtn)); k++) {
            await clickTab(page, prevBtn, k).catch(() => {});
            await settleAfterClick();
            const sig = await stateSignature(page, opts.section);
            if (seenRewind.has(sig)) break;
            seenRewind.add(sig);
          }
        }

        const shots = [];
        const firstSig = await stateSignature(page, opts.section);
        const seen = new Set([firstSig]);
        let backAtStart = false; // true when the carousel looped round to the first card
        shots.push(await shoot(0));
        for (let i = 1; i < opts.max; i++) {
          if (!(await buttonEnabled(nextBtn))) break; // last card
          await nextBtn.scrollIntoViewIfNeeded().catch(() => {});
          await clickTab(page, nextBtn, i);
          await settleAfterClick();
          const sig = await stateSignature(page, opts.section);
          if (seen.has(sig)) { backAtStart = sig === firstSig; break; } // looped back, or the click did nothing
          seen.add(sig);
          const png = await shoot(i);
          if (png.equals(shots[0])) { backAtStart = true; break; }
          if (png.equals(shots[shots.length - 1])) break;
          shots.push(png);
        }
        if (shots.length >= opts.max) console.warn(`  stopped at --max ${opts.max} cards`);
        const total = shots.length;
        const pad = String(total).length;
        console.log(`  ${total} card${total === 1 ? "" : "s"} (stepped with the next arrow)`);
        if (total === 1) console.warn(`  only one state found: the "next" button didn't change anything. Is the Chrome window visible?`);
        shots.forEach((png, i) => {
          const name = `${slug}_${sectionSlug}_${width}w_card${String(i + 1).padStart(pad, "0")}of${total}${suffix}.png`;
          fs.writeFileSync(path.join(widthDir, name), png);
          console.log(`  saved ${width}w/${name}`);
        });

        // Leave it where we found it for the next width: rewind again.
        if (prevBtn && !backAtStart) {
          for (let k = 0; k < total - 1 && (await buttonEnabled(prevBtn)); k++) {
            await clickTab(page, prevBtn, k).catch(() => {});
            await page.waitForTimeout(Math.min(opts.settle, 800));
          }
          await settleAfterClick();
        }
        await setFixedOverlaysHidden(page, false);
        continue;
      }

      // ---- Tabs / dots mode: click each item in turn ----
      const tabs = section.locator(opts.tabs);
      const count = await tabs.count();
      if (count === 0) {
        console.error(`  no elements match --tabs "${opts.tabs}" inside the section`);
        process.exitCode = 1;
        await setFixedOverlaysHidden(page, false);
        continue;
      }
      const labels = [];
      for (let i = 0; i < count; i++) {
        const t = (await tabs.nth(i).innerText().catch(() => "")).trim() || (await tabs.nth(i).getAttribute("aria-label")) || "";
        labels.push(slugify(t).slice(0, 30) || String(i + 1));
      }
      console.log(`  ${count} cards: ${labels.join(", ")}`);
      const pad = String(count).length;

      let prevPng = null, identical = 0;
      for (let i = 0; i < count; i++) {
        const tab = tabs.nth(i);
        await tab.scrollIntoViewIfNeeded().catch(() => {});
        await clickTab(page, tab, i);
        await settleAfterClick();
        const png = await shoot(i);
        if (prevPng && png.equals(prevPng)) identical++;
        prevPng = png;

        const name = `${slug}_${sectionSlug}_${width}w_card${String(i + 1).padStart(pad, "0")}of${count}_${labels[i]}${suffix}.png`;
        fs.writeFileSync(path.join(widthDir, name), png);
        console.log(`  saved ${width}w/${name}`);
      }
      if (identical)
        console.warn(`  ${identical} card(s) came out identical to the one before: those dots/tabs may not react to clicks. ` +
          `If the carousel has arrows, try arrow mode (--next).`);

      await setFixedOverlaysHidden(page, false);
      await clickTab(page, tabs.nth(0), 0).catch(() => {}); // leave the carousel on its first card
      await page.waitForTimeout(opts.settle);
    }
  } catch (err) {
    console.error(`failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await setFixedOverlaysHidden(page, false);
    if (existing) {
      await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
    } else {
      await page.close().catch(() => {});
    }
    await browser.close(); // disconnects only; your Chrome stays open
  }
})();
