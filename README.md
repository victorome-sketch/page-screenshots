# page-screenshots

A Claude skill for sharp, true-to-size screenshots of any web page at the viewport widths you choose (1440, 1024, 768, 375…), including pages behind a login. It captures the full page, every card of the page's carousels, or both, as 2x PNGs sliced so Figma keeps them sharp.

You can use it by asking Claude, or without Claude by double-clicking two files.

---

## Page screenshots (Figma-ready)

**Tool:** Claude Cowork or Claude Code, with this skill installed. Also works without Claude: `scripts/Setup.command` once, then `scripts/Screenshot.command`.
**Skill doc:** [SKILL.md](./SKILL.md) (what Claude follows) · [Troubleshooting](./references/troubleshooting.md) · [Finding carousel selectors](./references/finding-selectors.md)

**What it does:** Drives a separate Chrome window on your Mac to capture pages at exact viewport widths with a 2x scale factor. It saves full pages as slices under 4096 px (Figma's limit) plus one stitched image. It also finds the carousels, sliders and tabbed sections on the page and saves one image per card. Claude prepares the folder, tells you what to double-click and which answers to type, then checks the files: pixel sizes, missing slices, and a visual look.

**Use it when:**

- You need a page at several breakpoints for a design review, a Figma file or a deck, e.g. "screenshot this page at 1440, 1024, 768 and 375".
- The page is behind a login (staging, a CMS preview, an intranet). You sign in once in the screenshot Chrome and it stays signed in.
- You need every slide of a carousel or every tab of a timeline as its own image, e.g. "grab every card of the testimonials carousel on tablet and mobile".
- Browser or extension screenshots came out blurry, cut off or low-res in Figma.

**Don't use it for:**

- **Just looking at or checking a page.** Ask Claude to open it with its browser tools instead.
- **Recording motion or video.** Use a screen recorder.
- **Testing touch behaviour on phones.** This emulates width and pixel density only. Use real devices or a device lab.
- **Windows or Linux.** The launchers are macOS-only. The Node scripts run elsewhere but aren't tested there. As a manual fallback, use Chrome DevTools' device toolbar → *Capture full size screenshot*.

**Before you run it:**

- A Mac with Google Chrome.
- Node.js (free, one-time install). `Setup.command` checks for it and opens the download page if it's missing.
- A folder for the screenshots, connected to Claude (in Cowork: the folder you select for the session).
- Access to the page. If it needs a login, you sign in yourself in the screenshot Chrome. The skill never sees or enters credentials.

**Example output:**

What you type into `Screenshot.command`:

```
What do you want to capture?
  1) The full page                        (default)
  2) Carousels on the page, card by card  (I'll find them for you)
  3) Both
Type 1, 2 or 3:  3

Widths [1440]:  1440, 375

Looking for carousels on the page…
Found 2:
  1) Meet the team   — 6 cards    (section.team-carousel)
  2) Testimonials    — arrows     (section.quotes)
Which ones? Numbers separated by commas, all, or m to enter selectors yourself [all]:  all
```

What lands in your folder (it opens in Finder when done):

```
screenshots/
  2026-09-24_10-15-00/                         ← one folder per run, nothing gets overwritten
    1440w/                                     ← one subfolder per viewport
      about_1440w_part1of5@2x.png              ← full page in slices ≤ 4096 px → use these in Figma
      …
      about_1440w_full@2x.png                  ← one stitched image, for archive / other tools
      about_meet-the-team_1440w_card1of6_alex@2x.png
      …
      about_testimonials_1440w_card1of4@2x.png
    375w/
      …
```

A 1440 viewport at 2x gives 2880 px wide files. The `@2x` in the name makes Figma place them at 1440 px, sharp.

---

## Install

**Claude Cowork (desktop app):** download this repo as a ZIP (green **Code** button → *Download ZIP*) and add it as a skill in Claude's skills settings. If someone sends you a `page-screenshots.skill` file, open it in Claude and click **Save skill**.

**Claude Code:** copy the folder to your skills directory:

```
git clone https://github.com/victorome-sketch/page-screenshots.git ~/.claude/skills/page-screenshots
```

**Without Claude:** copy the four files from `scripts/` (`Setup.command`, `Screenshot.command`, `screenshot.js`, `carousel.js`) into the folder where you want the screenshots. Then follow "How to use" below from step 2.

## How to use

**With Claude**, ask in plain words. For example:

- "Screenshot https://example.com/pricing at desktop, tablet and mobile"
- "Take the page I have open at 1440 and 375, and every card of the carousel"
- "My screenshot is blurry in Figma, can you redo it?"

Claude copies the scripts into your folder and tells you exactly what to do:

1. **Once only:** double-click `Setup.command`. It installs two small packages (`playwright-core`, `pngjs`) into that folder and opens a separate "screenshot" Chrome window. That window has its own profile, so your everyday Chrome is untouched.
2. **In that Chrome window:** open the page, and sign in if needed. You only sign in the first time.
3. **Double-click `Screenshot.command`** and answer its questions. Keep the Chrome window visible (not minimised) while it runs.
4. **Tell Claude it's done.** It checks the files and tells you if anything needs a rerun.

**Into Figma:** drag in the `part…@2x.png` slices, select them, press **Shift+A** (Auto layout), and set direction to vertical with a gap of 0. Don't place the `_full` image; Figma blurs anything taller than 4096 px.

## Carousels

When you pick option 2 or 3, the launcher looks for carousels on the page and lists them. It recognises ARIA tabs, Swiper, Slick, Splide, Glide, Flickity, Owl, Bootstrap, Embla, generic pagination dots, and generic next/previous arrows.

- **Dots or tabs:** clicks each one and saves one image per card.
- **Arrows only:** goes back to the first card, then presses next until the arrow is disabled or the carousel loops back to the start.
- **Not found:** type `m` and enter two CSS selectors: the section that wraps the carousel, and either its dots or its next arrow. Claude can find them for you if it can open the page.

## What's in this repo

| Path | What it is |
|---|---|
| `SKILL.md` | The instructions Claude follows |
| `scripts/Setup.command` | One-time setup: checks Node, installs packages, opens the screenshot Chrome |
| `scripts/Screenshot.command` | The launcher: asks what to capture and which widths, finds carousels |
| `scripts/screenshot.js` | Full-page capture (Node, Playwright over Chrome DevTools) |
| `scripts/carousel.js` | Carousel detection (`--detect`) and card-by-card capture |
| `scripts/check_run.py` | Claude's check of a run: pixel sizes, Figma limit, missing slices |
| `references/troubleshooting.md` | Symptoms and fixes |
| `references/finding-selectors.md` | How to find a carousel's selectors by hand |

## Privacy and safety

- **Runs on your Mac.** Nothing is uploaded; the screenshots are saved in your folder.
- **Uses a separate Chrome profile** (`~/.chrome-screenshot-profile`), so your everyday Chrome stays untouched.
- **Never handles passwords.** You sign in yourself; the scripts reuse that session.
- **Chrome debugging port.** The screenshot Chrome opens a debugging port (9222) on your own machine only. Quit that window (Cmd+Q) when you're done if you prefer not to leave it open.

## Troubleshooting

The launchers print the fix for the common problems. The full list is in [references/troubleshooting.md](./references/troubleshooting.md). The usual ones:

| What you see | What to do |
|---|---|
| "Setup hasn't been run in this folder yet" | Double-click `Setup.command` (again) in the same folder as `Screenshot.command` |
| Double-clicking does nothing / "no access privileges" | Right-click → Open once. Share the folder as a zip so this doesn't happen to others |
| "Redirected to … sign in" | Sign in on that page in the screenshot Chrome window and run again |
| "locator.click: Timeout" | The Chrome window was covered or minimised; bring it to the front and run again |
| Blurry in Figma | You placed the `_full` image; use the `part…@2x.png` slices |
| A section is collapsed or mid-animation | Run again with a longer wait: type `a` at the first question |
