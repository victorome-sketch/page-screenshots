---
name: page-screenshots
description: Produce sharp, Figma-ready PNG screenshots of web pages at exact viewport widths (1440, 1024, 768, 375…), including pages behind a corporate login, and capture every card of a carousel, timeline or tabbed section as separate images. Use this skill whenever someone asks for screenshots, captures or "grabs" of a page or URL at specific viewports, breakpoints, widths or "desktop/tablet/mobile", wants a full-page screenshot as a file (for Figma, a design review, a deck, a before/after comparison), wants each slide/card/tab/year of a carousel screenshotted, or says a page screenshot came out blurry, cut off or low-res. Also use it when they mention Setup.command, Screenshot.command, screenshot.js or carousel.js. Do not use it when the person only wants to look at or verify a page — the browser tools do that directly.
---

# Page screenshots at exact viewports

Two Node scripts do the capturing and two double-click launchers wrap them so nobody has to type in a Terminal. `scripts/screenshot.js` captures a whole page; `scripts/carousel.js` finds the carousels on any page (`--detect`) and clicks through every card of one, by its dots/tabs or its next arrow, saving each state. `scripts/Setup.command` installs what's needed and opens a separate "screenshot" Chrome; `scripts/Screenshot.command` asks two questions (what to capture, which widths), lists the carousels it finds if carousels were asked for, and runs the right script. Everything connects to a Chrome on the person's own Mac, so pages behind corporate login work with no credential handling, and everything saves 2x PNGs sliced under 4096 px so Figma doesn't blur them.

**The one constraint that shapes everything:** the capture runs on the person's Mac, not here. The scripts talk to Chrome on `localhost:9222`, which the sandbox cannot reach. So the division of labour is: you prepare the folder and tell them what to double-click (or paste), they run it, you verify the files that land in the connected folder and fix whatever went wrong. Don't try to run the scripts yourself, and don't reinvent the capture with the browser tools: their screenshots are downscaled JPEGs for viewing, not files.

## Workflow

### 1. Pin down the request

Work out three things before doing anything:

- **Which page(s):** a URL, or "the page I have open". Either way the person will have the page showing in the screenshot Chrome, so the default is to capture that visible tab.
- **Which viewports:** widths in CSS px. Map words: desktop/XL → 1440, laptop/L → 1024, tablet → 768, mobile → 375. If none is mentioned, ask which they need and suggest 1440, 1024, 768, 375.
- **Whether carousels are in play:** a carousel, slider, timeline, tabs, "each card", "every slide". If so, take the full page *and* ask whether they also want every card of that section captured on its own. Offer it rather than assume: a person asking for "the testimonials section at 1440" may want the page, or every testimonial, or both (the launcher has a "Both" option for exactly this). Carousel capture works on any site: the launcher detects the carousels and asks which ones.

Keep questions to one round. Everything else has sensible defaults.

### 2. Make sure the folder is ready

The files live in the connected project folder, next to where the screenshots land. Check for `Setup.command`, `Screenshot.command`, `screenshot.js`, `carousel.js`, and `node_modules/playwright-core` + `node_modules/pngjs`.

- Any of the four files missing, or older than the copies in this skill's `scripts/` → copy the skill's versions in (Read the skill file, Write it to the folder). Don't alter their capture logic; the header comments explain hard-won reasons for each choice.
- `node_modules` missing → nothing to do; `Setup.command` installs them.
- No folder connected → ask them to connect the folder where they want the screenshots.

If the environment lets you set file permissions, make the two `.command` files executable; if not, `Setup.command` fixes `Screenshot.command` when it runs, and the fallback for Setup itself is right-click → Open.

### 3. Tell them what to do (the default path)

Three steps, in one short message sent with the user-message tool so it renders verbatim:

1. **Once only:** double-click `Setup.command` in the folder. It installs two packages and opens a separate "screenshot" Chrome window (own profile, their normal Chrome is untouched). If it says Node.js is missing, install it from the page it opens and run Setup again.
2. Open the page in that Chrome window and sign in (only the first time).
3. Double-click `Screenshot.command`. Answer: what to capture (1 full page, 2 carousels card by card, 3 both) and which widths (e.g. `1440, 375`). For 2 or 3 it then lists the carousels it found and asks which ones (numbers, `all`, or `m` to enter selectors). Keep that Chrome window open and un-minimised; the results folder opens in Finder when it's done.

Tell them the answers to type for *their* request ("type 3, then 1440, 768, 375, then pick the testimonials carousel"). If you can reach the page with the browser tools, run the detection there first (see step 4) so you can tell them which number to pick. If Setup has already been run and the Chrome is open, only step 3 applies; say so.

**Fallback (Terminal instead of double-click):** if the launchers can't be used (permissions they can't fix, or they prefer Terminal), send one paste-ready block:

```
cd ~/path/to/Connected\ Folder
npm install playwright-core pngjs
open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-screenshot-profile" --disable-backgrounding-occluded-windows --disable-renderer-backgrounding
node screenshot.js --current --width 1440,375
node carousel.js --current --detect
node carousel.js --current --width 1440,375 --section "<from detect>" --tabs "<from detect>"
```

Drop lines that aren't needed. Widths are comma-separated for both scripts; each width gets its own subfolder.

### 4. Carousels: detection first, selectors only when it misses

`carousel.js --detect` lists every carousel it recognises on the visible tab, one tab-separated line each: kind (`tabs` = dots/tabs/year buttons, one per card; `next` = arrow-only), section selector, control selector, prev selector, card count, active-card selector, and a label from the section heading. It knows ARIA tabs, Swiper, Slick, Splide, Glide, Flickity, Owl, Bootstrap and Embla, generic pagination dots, and generic next/previous arrows. `Screenshot.command` runs it for options 2 and 3 and lets the person pick.

In `tabs` mode each control is clicked in turn. In `next` mode the script rewinds with `--prev`, then presses next until it's disabled, the visible content stops changing, or it loops back to the first card (capped by `--max`, default 30). File names use `--label` (the launcher passes the detected heading), e.g. `about_meet-the-team_1440w_card1of6_alex@2x.png`.

When detection misses a carousel, or the person asks which number to pick, inspect the page yourself: read `references/finding-selectors.md` (it includes how to run the detection function in the browser tools). If the page isn't reachable from the browser tools, ask the person to right-click the carousel → Inspect and paste the section's opening tag and one of the dots/tabs (or the next arrow).

Then either tell them to type `m` at the launcher's "Which ones?" prompt and enter the selectors, or give the Terminal line:

```
node carousel.js --current --width 1440,1024,768,375 --section "section.other-carousel" --tabs ".dots button"
node carousel.js --current --width 1440,375 --section "section.team-carousel" --next ".carousel__next" --prev ".carousel__prev"
```

### 5. Verify the output

When they say it ran (or paste the window's text), find the newest folder under `screenshots/` in the connected folder and run `scripts/check_run.py <that folder>`. It lists every PNG with its pixel size and flags the three things that go wrong: width not equal to viewport × scale (the capture fell back to 1x), any side over 4096 px on a slice (Figma will blur it), and a missing member of a `partNofM` / `cardNofM` set. Then open one or two PNGs with Read and actually look: overlapping headings, a collapsed section, a sticky bar on top of a card, a half-finished fade. The numbers won't catch those. Report in a sentence or two, and remind them how to place slices in Figma (drag all parts in, select, Shift+A, vertical, gap 0).

### 6. When something goes wrong

Read `references/troubleshooting.md` and match the symptom. The common ones: Setup not run (`Setup hasn't been run in this folder yet`), the screenshot Chrome not open or not signed in, a click timeout in carousel mode because the Chrome window was covered, a `.command` file that lost its executable permission when shared, or a blurry result because the tall stitched image was placed in Figma instead of the slices. Give the fix, not a lecture.

## Optional flags (keep out of the default path)

Mention these only when the request calls for them or the person asks:

| Flag | Default | Script | Use when |
|---|---|---|---|
| `--scale 1` | 2 | both | They explicitly want standard-resolution files |
| `--settle 1500` | 700 / 1300 | both | A section came out mid-animation or collapsed |
| `--no-full` | off | screenshot.js | They don't want the stitched single image |
| `--reload` | off | screenshot.js | The open tab should be refreshed first |
| `--next` / `--prev` | – | carousel.js | Arrow-only carousels (instead of `--tabs`); detection fills these in |
| `--max 30` | 30 | carousel.js | Arrow mode ran past the real number of cards |
| `--label x` | from `--section` | carousel.js | Name used in the file names |
| `--card-only` | off | carousel.js | Just the active card, no neighbours peeking in (`--card` sets its selector; default `.card-active`) |
| `--pad 24` | 0 | carousel.js | Breathing room around the crop |
| URLs instead of `--current` | – | both | Several pages in one run; reuses a matching open tab |
| `--run-name x` | timestamp | both | Group several commands into one run folder (the launcher does this for "Both") |

The launcher exposes the same options when the person types `a` at its first question.

## Output conventions

Every run makes its own folder, with one subfolder per viewport, so people can rerun freely and never have to guess which viewport a file came from:

```
screenshots/
  2026-09-18_14-05-00/
    1440w/
      about_1440w_part1of7@2x.png                              slices ≤ 4096 px → use these in Figma
      about_1440w_full@2x.png                                  stitched → archive / other tools
      about_meet-the-team_1440w_card1of6_alex@2x.png           carousel cards, if chosen
    375w/  ...
```

`@2x` in the filename makes Figma place the image at 1x size, so a 2880 px file lands at 1440 px, retina-sharp.

## Why the scripts work the way they do

You'll be tempted to "simplify" these if someone asks for a tweak. Each was learned the hard way, so keep them unless you have a reason:

- **Viewport is emulated over the DevTools protocol, not by resizing the window.** Window resizing is unreliable (full-screen windows ignore it, side panels eat width) and can't set a 2x scale factor. Never call Playwright's `setViewportSize` after the emulation call: it silently resets the scale factor to 1.
- **Full page is captured by growing the emulated viewport and *waiting*, not with `captureBeyondViewport`.** The latter stretches the viewport only for the instant of capture, so reveal-on-scroll sections and carousels are caught in their hidden state and collapse. Scroll-and-stitch is not the answer either: sticky elements then repeat on every screen.
- **Slices, not one tall image.** Figma downsamples anything over 4096 px per side.
- **Arrow mode recognises "same card" by content, not layout.** It compares the visible headings, text and images left to right. Element positions don't work: background animations and a looping carousel's clones make every state look different, so the loop back to card 1 is never noticed.
- **Setup writes a `package.json` before `npm install`.** Without one, npm installs into the nearest parent folder that has a `package.json` (often the home folder) and `Screenshot.command` then says Setup hasn't run.
- **Carousel tabs are clicked with real mouse events.** Synthetic `element.click()` does nothing for these components. If Chrome's window is covered or minimised, it stops acknowledging mouse input, which is why the launch line carries the two `--disable-…backgrounding` flags and the script brings the window to the front.
- **Sticky and fixed overlays are hidden during carousel captures** and pinned to their first-screen position in full-page captures, so the jump-link bar and floating buttons don't land on top of the content.

## Don't use this for

Looking at or checking a page (use the browser tools), recording motion or video (a screen recording tool), pages that need touch-device emulation beyond width (this emulates width and scale only), or when the person has no Mac/Terminal at all, in which case Chrome DevTools' *Capture full size screenshot* with the device toolbar is the manual fallback to describe.
