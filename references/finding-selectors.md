# Finding the selectors for a carousel

Usually you don't need to: `node carousel.js --current --detect` (which `Screenshot.command` runs for options 2 and 3) lists every carousel it recognises with its selectors. It knows ARIA tabs (`[role=tablist]`), Swiper, Slick, Splide, Glide, Flickity, Owl, Bootstrap and Embla, generic pagination dots/indicators, and generic next/previous arrows. Tested on a production marketing site (a year-tabs timeline and an arrow-only looping carousel), the Bootstrap carousel example and the Slick demo page (10 carousels).

Use this recipe when detection misses one, or picks the wrong wrapper. You can also run the detection function itself in the page with the browser tools: copy `detectCarousels` out of `scripts/carousel.js` and evaluate `JSON.stringify(detectCarousels(), null, 1)`.

`carousel.js` needs a section selector (`--section`, the carousel's container) and either `--tabs` (the clickable items inside it, one per card: tabs, dots, year buttons, thumbnails) or, for carousels that only have arrows, `--next` (plus `--prev`, optional, used to rewind to the first card). `--section` has no default; `--tabs` defaults to `[role=tab]`. Find them like this.

## With the browser tools (preferred)

The person is usually signed in already in Claude in Chrome, so the page is reachable. Open it, then run this in the page with the JavaScript tool. Replace the heading text with a word from the section's title.

```js
const h = [...document.querySelectorAll('h1,h2,h3')].find(e => /meet the team/i.test(e.textContent));
let n = h, chain = [];
while (n && n !== document.body && chain.length < 8) {
  chain.push({ tag: n.tagName.toLowerCase(), id: n.id || null,
               classes: (typeof n.className === 'string' ? n.className.trim().split(/\s+/) : []) });
  n = n.parentElement;
}
// clickable things that look like carousel controls, near the heading
const root = h ? h.closest('section, [class*=carousel], [class*=slider], [class*=timeline], [class*=tabs]') || h.parentElement.parentElement : document;
const controls = [...root.querySelectorAll('[role=tab], [role=tablist] > *, button, [class*=dot], [class*=bullet], [class*=indicator]')]
  .slice(0, 15).map(e => ({ tag: e.tagName.toLowerCase(), text: e.textContent.trim().slice(0, 20),
    attrs: [...e.attributes].map(a => a.name + '=' + a.value.slice(0, 60)).join(' | ') }));
JSON.stringify({ chain, controls }, null, 1);
```

Read the result for:

- **The section:** the nearest ancestor that clearly wraps the whole component (often a `<section>` or a div with a class like `…-carousel`, `…-slider`, `…-timeline`). Prefer a class selector (`section.team-carousel`) over an id if the id looks generated (`#meet-the-team-eadadbffface`).
- **The tabs:** the repeated clickable elements, one per card. `[role=tab]` is ideal when present. Otherwise a class on the buttons (`.slider__dot`) or a structural selector (`.carousel-nav button`). Don't pass arrows as `--tabs`: they aren't one-per-card, so the script would only capture two states.
- **Arrows only:** if there are no per-card controls, use `--next` with the "next" button's selector (prefer a class that says next, e.g. `.carousel__button--next`) and `--prev` with the "previous" one. The script stops when next is disabled, nothing changes, or it loops back to the first card.

Some output filters redact strings that look like tokens; if a class name comes back as `[BLOCKED…]`, return class lists as arrays (as the snippet does) rather than joined strings.

## Confirm they respond to a real click

Synthetic clicks (`el.click()`) often do nothing for these components, so confirm with a real one before composing the command: take a screenshot, click one of the controls with the computer tool, then check what changed:

```js
const sec = document.querySelector('section.team-carousel');   // your section selector
const tabs = [...sec.querySelectorAll('[role=tab]')];            // your tabs selector
JSON.stringify({ selected: tabs.map(t => t.getAttribute('aria-selected')),
                 classes: tabs.map(t => t.className) });
```

A good sign is `aria-selected` flipping to `true` on the clicked tab, or an `--active` class moving. Note the class the *card* gets when active (e.g. `.card-active`) if the person wants `--card-only`; pass it as `--card`.

Put the carousel back on its first card when you're done inspecting.

## Without browser access

Ask the person to right-click the carousel in Chrome → Inspect, and paste two things: the opening tag of the element that wraps the whole carousel, and the opening tag of one of the dots/tabs. Derive the selectors from those and confirm the count of tabs matches the number of cards they expect.

## Sanity checks before handing over the command

- The section selector should match exactly one element (`document.querySelectorAll(sel).length === 1`).
- The tabs selector, scoped to the section, should match one element per card.
- If the tablist scrolls horizontally on narrow viewports (common at 375), that's fine: the script scrolls each tab into view before clicking.
