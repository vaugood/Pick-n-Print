# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Pick 'n' Print" is a Chrome Manifest V3 extension that lets a user pick specific elements on a
web page and print only those elements. There is no build system, package manager, bundler, or
test suite — it's plain vanilla JS/HTML/CSS loaded directly by Chrome.

## Running / testing changes

There are no build or test commands. To try changes:
1. Open `chrome://extensions`, enable Developer Mode, "Load unpacked", select this directory.
2. After editing files, click the reload icon for the extension on `chrome://extensions`.
3. Open the popup on any page to exercise Start Picker / Stop Picker / Print Selected / Clear Selection.

## Architecture

Four pieces communicate via `chrome.tabs.sendMessage` / `chrome.runtime.onMessage`:

- **`popup.js`** (`popup.html`) — the toolbar popup UI. On every button click it calls
  `ensureContentScript()`, which injects `content.css`, `snapshot.js`, then `content.js` into the
  active tab via `chrome.scripting` (order matters — see below), then sends one of `EPP_START` /
  `EPP_STOP` / `EPP_PRINT` / `EPP_CLEAR` to the tab. Injection happens fresh on every click
  (idempotent — see below) rather than tracked as "already injected" from the popup side.

- **`content.js`** — an IIFE injected into the page; owns the picker UI/interaction only. It
  guards against double-injection with `window.__EPP_INSTALLED__`. All picker state (`enabled`,
  `hoveredEl`, the `selected` Set of live DOM Element references) lives in this closure.
  - Builds its own floating UI (`#epp-highlight` hover box, `#epp-badge` status/control panel)
    directly via DOM APIs and injects it into `document.documentElement`, styled by `content.css`.
  - Capturing-phase listeners (`mousemove`/`click`/`keydown`, all registered with `capture: true`)
    implement uBlock-style element picking: clicks are `preventDefault`/`stopPropagation`-ed while
    picking is active so the underlying page doesn't react. `Escape` exits, `Enter` prints.
  - Selected elements get an `.epp-selected` class (defined in `content.css`) as a visual marker —
    deliberately a class, not a mutated inline style, so clearing a selection can never clobber a
    page's own pre-existing inline `outline`. Elements are stored by reference in the `selected`
    Set (not by selector), so selection does not survive page navigation/reload.
  - `getEffectiveSelection()` drops any selected element that is a descendant of another selected
    element before printing, so selecting both a container and one of its own children doesn't
    duplicate that child's content in the output.
  - `printSelected()` hands the effective selection to `buildPrintHTML()` (from `snapshot.js`) and
    writes the resulting HTML into a hidden `srcdoc` iframe, then calls
    `iframe.contentWindow.print()` on load. This avoids opening a popup window. `window.print()`
    from a non-gesture context (e.g. triggered via the extension popup) can be blocked by the
    browser; the fallback path is clicking Print on the in-page `#epp-badge`, which is a direct
    user gesture.

- **`snapshot.js`** — the DOM fidelity/extraction engine, injected before `content.js` so both
  share one isolated-world global scope and `content.js` can call its top-level
  `buildPrintHTML(elements)` as a plain global function (no module system, no build step — see
  below for why). Its functions are pure/stateless, so re-injection needs no guard. Given a
  selected element it does *not* just clone `outerHTML` — it freezes the element's actual rendered
  appearance so it survives being lifted out of its original page context. Per element in the
  subtree it:
  - Inlines every `getComputedStyle()` property as a literal value (`inlineComputedStyle`) — this
    is what preserves "exactly as shown," since computed style already resolves inheritance, CSS
    variables, and cascade/media-query effects into concrete values, and freezing them as literal
    pixel sizes is what keeps a narrow element narrow instead of stretching to fill an assumed
    page.
  - Reconstructs `::before`/`::after` via `capturePseudoPair`, generating a scoped stylesheet rule
    keyed off a `data-epp-pseudo-id` attribute, since pseudo-elements can't be targeted by an
    inline style on the real element.
  - Rasterizes `<canvas>`/`<video>` to `<img>` (`createReplacementForNode`), since their pixel
    content doesn't survive `cloneNode`.
  - Copies live form state — `value`/`checked`/`selected` (`freezeFormState`) — that `cloneNode`
    only captures from initial HTML attributes, not user interaction. Password and file input
    values are deliberately excluded from export.
  - Re-attaches open shadow roots via Declarative Shadow DOM (`freezeShadowDom`, recursing back
    into `freezeElement`), so web-component content renders in the isolated print document without
    needing any of the page's own JavaScript. Closed shadow roots can't be introspected at all —
    an accepted platform limitation.
  - Neutralizes `position: fixed/sticky/absolute` when the element's containing block (via
    `offsetParent`) didn't survive into the extracted subtree (`constrainPositioning`), so nothing
    ends up adrift at stale page-relative coordinates.
  - `lockRootFormFactor` pins only the outermost selected element's box (via `!important`, so a
    page's own `!important` rules can't fight it) to its captured `getBoundingClientRect()` size —
    this is the actual "form factor" guarantee — and backfills a transparent root's background
    with whatever color would have shown through it on the source page.
  - `buildPrintHTML(elements)` assembles one `<div class="epp-page epp-page-N">` per selected
    element and gives each its own CSS Paged Media named page (`@page pgN { size: ... }` +
    `.epp-page-N { page: pgN }`), so each prints at its own exact size instead of all being
    centered on one fixed paper size. `collectFontFaceCSS()` re-attaches only `@font-face` rules
    (not whole stylesheets) pulled via the CSSOM, to avoid a page's broad/`!important` selectors
    leaking onto the generated wrapper markup; cross-origin sheets it can't introspect are
    re-linked wholesale as a fallback (in practice almost always font CDNs).

- **`service_worker.js`** — currently a no-op `onInstalled` handler. It's a placeholder kept in the
  manifest for future background-script needs; all real logic lives in the popup, content script,
  and snapshot engine.

- **`manifest.json`** — MV3 manifest; permissions are `activeTab`, `scripting`, `storage` (storage
  is declared but not currently used anywhere in the code).

Given there's no build step (see top), `content.js`/`snapshot.js` can't use ES module
import/export — they're injected as classic scripts via `chrome.scripting.executeScript({files:
[...]})`, which runs them in array order sharing one global scope per tab. That's why
`snapshot.js` exposes its API as plain top-level functions rather than anything importable, and
why injection order in `popup.js`'s `ensureContentScript()` matters.
