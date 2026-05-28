// content.js — Element Print Picker (MV3)
// Picker UI + selection + print via hidden iframe (no popups)

(() => {
  // Prevent double-install if injected multiple times
  if (window.__EPP_INSTALLED__) return;
  window.__EPP_INSTALLED__ = true;

  // -----------------------------
  // State
  // -----------------------------
  let enabled = false;
  let hoveredEl = null;

  // Store actual Elements (MVP). Set preserves insertion order.
  const selected = new Set();

  // -----------------------------
  // Helpers: DOM / UI creation
  // -----------------------------
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    for (const child of children) node.append(child);
    return node;
  }

  function ensureUI() {
    // Highlight overlay
    let highlight = document.getElementById("epp-highlight");
    if (!highlight) {
      highlight = el("div", { id: "epp-highlight" });
      document.documentElement.appendChild(highlight);
    }

    // Badge
    let badge = document.getElementById("epp-badge");
    if (!badge) {
      badge = el("div", { id: "epp-badge" });
      badge.innerHTML = `
        <div class="row">
          <strong>Picker:</strong> <span id="epp-count">0</span> selected
        </div>
        <div class="row" style="margin-top:6px">
          <button id="epp-print" class="primary">Print</button>
          <button id="epp-clear" class="secondary">Clear</button>
          <button id="epp-exit" class="secondary">Exit</button>
        </div>
        <div id="epp-toast" style="margin-top:6px; opacity:.9; display:none;"></div>
      `;
      document.documentElement.appendChild(badge);

      // Wire badge buttons
      badge.querySelector("#epp-print").addEventListener("click", () => printSelected(true));
      badge.querySelector("#epp-clear").addEventListener("click", clearSelected);
      badge.querySelector("#epp-exit").addEventListener("click", stop);
    }

    return {
      highlight,
      badge,
      countEl: badge.querySelector("#epp-count"),
      toastEl: badge.querySelector("#epp-toast")
    };
  }

  const ui = ensureUI();

  function showUI() {
    ui.badge.style.display = "block";
    // highlight only shows once we have hovered element
    if (hoveredEl) ui.highlight.style.display = "block";
  }

  function hideUI() {
    ui.badge.style.display = "none";
    ui.highlight.style.display = "none";
    hideToast();
  }

  function updateCount() {
    ui.countEl.textContent = String(selected.size);
  }

  let toastTimer = null;
  function toast(message) {
    clearTimeout(toastTimer);
    ui.toastEl.textContent = message;
    ui.toastEl.style.display = "block";
    toastTimer = setTimeout(() => hideToast(), 2500);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    toastTimer = null;
    ui.toastEl.style.display = "none";
    ui.toastEl.textContent = "";
  }

  function isOurUI(node) {
    return !!node && (node.id === "epp-highlight" || !!node.closest?.("#epp-badge"));
  }

  // -----------------------------
  // Picker interactions
  // -----------------------------
  function drawHighlight(target) {
    const rect = target.getBoundingClientRect();

    ui.highlight.style.display = "block";
    ui.highlight.style.left = `${rect.left}px`;
    ui.highlight.style.top = `${rect.top}px`;
    ui.highlight.style.width = `${rect.width}px`;
    ui.highlight.style.height = `${rect.height}px`;
  }

  function onMouseMove(e) {
    if (!enabled) return;

    const target = e.target;
    if (!target || target === document.documentElement || target === document.body) return;
    if (isOurUI(target)) return;

    hoveredEl = target;
    drawHighlight(target);
  }

  function toggleSelection(target) {
    if (selected.has(target)) {
      selected.delete(target);
      // Remove marker
      try {
        target.style.outline = "";
        target.style.outlineOffset = "";
      } catch {}
    } else {
      selected.add(target);
      // Marker for selected elements
      try {
        target.style.outline = "2px solid #ffb300";
        target.style.outlineOffset = "2px";
      } catch {}
    }
    updateCount();
  }

  function onClick(e) {
    if (!enabled) return;
    const target = e.target;
    if (!target || isOurUI(target)) return;

    // uBlock-style: consume clicks while picker is active
    e.preventDefault();
    e.stopPropagation();

    toggleSelection(target);
  }

  function onKeyDown(e) {
    if (!enabled) return;

    if (e.key === "Escape") {
      e.preventDefault();
      stop();
      return;
    }

    // Optional convenience: Enter prints (works best from in-page badge)
    if (e.key === "Enter") {
      e.preventDefault();
      printSelected(false);
      return;
    }
  }

  // -----------------------------
  // Public controls
  // -----------------------------
  function start() {
    if (enabled) return;
    enabled = true;
    showUI();
    updateCount();
    toast("Click elements to select. Esc exits.");

    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
  }

  function stop() {
    enabled = false;
    hoveredEl = null;
    hideUI();

    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
  }

  function clearSelected() {
    for (const node of selected) {
      try {
        node.style.outline = "";
        node.style.outlineOffset = "";
      } catch {}
    }
    selected.clear();
    updateCount();
    toast("Selection cleared.");
  }

  // -----------------------------
  // Print pipeline (hidden iframe)
  // -----------------------------
  function collectPageStyles() {
    // Copy style tags and external stylesheets into the print document.
    // Note: CSP can affect loading some resources in the iframe.
    const nodes = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'));
    return nodes.map(n => n.outerHTML).join("\n");
  }

  function elementHTML(node) {
    const clone = node.cloneNode(true);

    // Clean any selection markers that are inline styles
    if (clone?.style) {
      clone.style.outline = "";
      clone.style.outlineOffset = "";
    }

    return clone.outerHTML;
  }

  function buildPrintHTML() {
    const styles = collectPageStyles();

    const body = Array.from(selected)
      .map(elementHTML)
      .join("\n\n<hr/>\n\n");

    const printCSS = `
      <style>
        body { margin: 16px; }
        @media print {
          hr {
            page-break-after: always;
            border: 0;
            border-top: 1px solid #ddd;
            margin: 24px 0;
          }
        }
      </style>
    `;

    // IMPORTANT: base href allows relative URLs (css/img) to resolve properly
    const base = `<base href="${location.href}">`;

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  ${base}
  <title>Print Selected Elements</title>
  ${styles}
  ${printCSS}
</head>
<body>
  ${body || "<p>(No elements selected)</p>"}
</body>
</html>`;
  }

  function printSelected(fromInPageGesture) {
    if (selected.size === 0) {
      // Avoid alert spam; keep it in-page
      toast("No elements selected.");
      return;
    }

    const html = buildPrintHTML();

    // Create or reuse hidden iframe
    let frame = document.getElementById("epp-print-frame");
    if (!frame) {
      frame = el("iframe", { id: "epp-print-frame" });
      frame.style.position = "fixed";
      frame.style.right = "0";
      frame.style.bottom = "0";
      frame.style.width = "0";
      frame.style.height = "0";
      frame.style.border = "0";
      frame.style.visibility = "hidden";
      frame.style.zIndex = "-1";
      document.documentElement.appendChild(frame);
    }

    // When iframe loads, trigger print
    frame.onload = () => {
      try {
        const w = frame.contentWindow;
        if (!w) throw new Error("No iframe window");

        w.focus();

        // Some environments restrict print() unless user-initiated.
        // If this fails when triggered from extension popup, use the in-page badge Print.
        w.print();
      } catch (err) {
        // Provide helpful guidance
        toast("Print blocked. Click Print in the on-page badge.");
        // If not already visible, show badge so user can click Print directly.
        showUI();
      } finally {
        // Clean up iframe after a moment (optional)
        setTimeout(() => {
          try { frame.remove(); } catch {}
        }, 1000);
      }
    };

    // Load the print document
    frame.srcdoc = html;

    // If called from popup message (not a direct gesture), hint user if needed.
    if (!fromInPageGesture) {
      // No-op; just avoid extra messaging.
    }
  }

  // -----------------------------
  // Message bridge (popup -> content script)
  // -----------------------------
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case "EPP_START":
        start();
        break;

      case "EPP_STOP":
        stop();
        break;

      case "EPP_CLEAR":
        clearSelected();
        break;

      case "EPP_PRINT":
        // Called from extension popup. This may still fail on some sites if print()
        // is considered not user-initiated. If so, user can click the in-page badge Print.
        showUI();
        printSelected(false);
        break;

      default:
        break;
    }
  });

})();
