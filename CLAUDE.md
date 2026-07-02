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

Three pieces communicate via `chrome.tabs.sendMessage` / `chrome.runtime.onMessage`:

- **`popup.js`** (`popup.html`) — the toolbar popup UI. On every button click it calls
  `ensureContentScript()`, which injects `content.css` and `content.js` into the active tab via
  `chrome.scripting`, then sends one of `EPP_START` / `EPP_STOP` / `EPP_PRINT` / `EPP_CLEAR` to the
  tab. The content script is injected fresh on every click (idempotent — see below) rather than
  tracked as "already injected" from the popup side.

- **`content.js`** — an IIFE injected into the page. It guards against double-injection with
  `window.__EPP_INSTALLED__`. All picker state (`enabled`, `hoveredEl`, the `selected` Set of live
  DOM Element references) lives in this closure. Responsibilities:
  - Builds its own floating UI (`#epp-highlight` hover box, `#epp-badge` status/control panel)
    directly via DOM APIs and injects it into `document.documentElement`, styled by `content.css`.
  - Capturing-phase listeners (`mousemove`/`click`/`keydown`, all registered with `capture: true`)
    implement uBlock-style element picking: clicks are `preventDefault`/`stopPropagation`-ed while
    picking is active so the underlying page doesn't react. `Escape` exits, `Enter` prints.
  - Selected elements get an inline outline style as a visual marker and are stored by reference in
    the `selected` Set (not by selector) — this is an MVP simplification, so selection does not
    survive page navigation/reload.
  - Printing (`buildPrintHTML`/`printSelected`) clones each selected element's `outerHTML`, strips
    the outline marker, concatenates them with `<hr/>` page breaks, re-attaches the page's own
    `<style>`/`<link rel="stylesheet">` tags plus a `<base href>` (so relative CSS/image URLs
    resolve) and some print-specific CSS, then writes the whole document into a hidden `srcdoc`
    iframe and calls `iframe.contentWindow.print()` on load. This avoids opening a popup window.
    `window.print()` from a non-gesture context (e.g. triggered via the extension popup) can be
    blocked by the browser; the fallback path is clicking Print on the in-page `#epp-badge`, which
    is a direct user gesture.

- **`service_worker.js`** — currently a no-op `onInstalled` handler. It's a placeholder kept in the
  manifest for future background-script needs; all real logic lives in the popup and content
  script.

- **`manifest.json`** — MV3 manifest; permissions are `activeTab`, `scripting`, `storage` (storage
  is declared but not currently used anywhere in the code).

## Known quirks

- `README.md` is saved as UTF-16 and contains effectively no content beyond the title.
