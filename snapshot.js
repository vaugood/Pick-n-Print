// snapshot.js — DOM fidelity engine for Pick 'n' Print (MV3)
//
// Freezes a live subtree into a self-contained, style-locked clone so it can
// be printed in total isolation from the source page and still look exactly
// as it did on screen. Loaded before content.js into the same isolated
// world; its top-level functions are pure and stateless, so re-injection is
// harmless and needs no double-install guard.

// -----------------------------
// Computed-style inlining
// -----------------------------

const getAllStyleProps = (() => {
  let cache = null;
  return (cs) => {
    if (!cache) {
      cache = [];
      for (let i = 0; i < cs.length; i++) cache.push(cs[i]);
    }
    return cache;
  };
})();

function inlineComputedStyle(original, clone) {
  const cs = getComputedStyle(original);
  const props = getAllStyleProps(cs);
  const decls = [];
  for (const prop of props) {
    const value = cs.getPropertyValue(prop);
    if (value) decls.push(`${prop}:${value}`);
  }
  clone.setAttribute("style", decls.join(";"));
}

function resetSelectionArtifacts(clone) {
  if (!clone.classList) return;
  clone.classList.remove("epp-selected");
  clone.style.outline = "none";
  clone.style.outlineOffset = "0px";
}

// -----------------------------
// Pseudo-elements (::before / ::after)
// -----------------------------

function capturePseudoPair(original, clone, nextId) {
  let css = "";
  let id = null;

  for (const which of ["before", "after"]) {
    const cs = getComputedStyle(original, `::${which}`);
    const content = cs.getPropertyValue("content");
    if (!content || content === "none") continue;

    if (id === null) {
      id = nextId();
      clone.setAttribute("data-epp-pseudo-id", String(id));
    }

    const props = getAllStyleProps(cs);
    const decls = [];
    for (const prop of props) {
      const value = cs.getPropertyValue(prop);
      if (value) decls.push(`${prop}:${value}`);
    }
    css += `[data-epp-pseudo-id="${id}"]::${which}{${decls.join(";")}}\n`;
  }

  return css;
}

// -----------------------------
// Replaced content (canvas / video pixels don't survive cloneNode)
// -----------------------------

function createReplacementForNode(original) {
  const tag = original.tagName;

  if (tag === "CANVAS") {
    const img = document.createElement("img");
    img.width = original.width;
    img.height = original.height;
    try {
      img.src = original.toDataURL("image/png");
    } catch {
      img.alt = "Canvas content unavailable (cross-origin restriction)";
    }
    return img;
  }

  if (tag === "VIDEO") {
    const img = document.createElement("img");
    const w = original.videoWidth || original.clientWidth;
    const h = original.videoHeight || original.clientHeight;
    let dataUrl = null;
    if (w && h) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(original, 0, 0, w, h);
        dataUrl = canvas.toDataURL("image/png");
      } catch {
        dataUrl = null;
      }
    }
    img.src = dataUrl || original.poster || "";
    if (!dataUrl && !original.poster) {
      img.alt = "Video content unavailable for print";
    }
    return img;
  }

  return null;
}

// -----------------------------
// Live form state (cloneNode only copies initial attributes, not typed
// values / toggled checked-ness / current selection)
// -----------------------------

function freezeFormState(original, clone) {
  const tag = original.tagName;

  if (tag === "INPUT") {
    const type = (original.type || "text").toLowerCase();
    if (type === "checkbox" || type === "radio") {
      if (original.checked) clone.setAttribute("checked", "");
      else clone.removeAttribute("checked");
    } else if (type !== "password" && type !== "file") {
      // Password/file values are intentionally never exported.
      clone.setAttribute("value", original.value);
    }
  } else if (tag === "TEXTAREA") {
    clone.textContent = original.value;
  } else if (tag === "SELECT") {
    const originalOptions = original.querySelectorAll("option");
    const clonedOptions = clone.querySelectorAll("option");
    originalOptions.forEach((opt, idx) => {
      const co = clonedOptions[idx];
      if (!co) return;
      if (opt.selected) co.setAttribute("selected", "");
      else co.removeAttribute("selected");
    });
  }
}

// -----------------------------
// Shadow DOM (invisible to outerHTML entirely otherwise)
// -----------------------------

function freezeShadowDom(original, clone, addPseudoCSS) {
  const shadow = original.shadowRoot;
  if (!shadow) return;

  const template = document.createElement("template");
  template.setAttribute("shadowrootmode", "open");

  for (const child of Array.from(shadow.children)) {
    const frozen = freezeElement(child);
    if (frozen.pseudoCSS) addPseudoCSS(frozen.pseudoCSS);
    template.content.appendChild(frozen.clone);
  }

  clone.prepend(template);
}

// -----------------------------
// Positioning sanity: an absolute/fixed/sticky descendant only makes sense
// once frozen if its containing block survived into the extracted subtree.
// -----------------------------

function constrainPositioning(original, clone, root) {
  const position = clone.style.position;

  if (position === "fixed" || position === "sticky") {
    clone.style.position = "static";
    clone.style.top = "auto";
    clone.style.right = "auto";
    clone.style.bottom = "auto";
    clone.style.left = "auto";
    return;
  }

  if (position === "absolute") {
    const containingBlock = original.offsetParent;
    if (!containingBlock || !root.contains(containingBlock)) {
      clone.style.position = "static";
      clone.style.top = "auto";
      clone.style.right = "auto";
      clone.style.bottom = "auto";
      clone.style.left = "auto";
    }
  }
}

// -----------------------------
// Backdrop color (a transparent root would otherwise show as blank white
// instead of whatever showed through it on the source page)
// -----------------------------

function isTransparent(colorStr) {
  if (!colorStr) return true;
  if (colorStr === "transparent") return true;
  const m = colorStr.match(/rgba?\(([^)]+)\)/);
  if (!m) return false;
  const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
  return parts.length === 4 && parts[3] === 0;
}

function resolveBackdropColor(root) {
  let node = root.parentElement;
  while (node) {
    const bg = getComputedStyle(node).backgroundColor;
    if (!isTransparent(bg)) return bg;
    node = node.parentElement;
  }
  return (document.body && getComputedStyle(document.body).backgroundColor) || "#ffffff";
}

// -----------------------------
// Form-factor lock: the exported page must be exactly the element's own
// box, not an element adrift on a Letter/A4 canvas.
// -----------------------------

function lockRootFormFactor(root, clone) {
  const rect = root.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width));
  const height = Math.max(1, Math.ceil(rect.height));
  const important = (prop, value) => clone.style.setProperty(prop, value, "important");

  const originalPosition = clone.style.position;
  const mustNeutralize =
    originalPosition === "fixed" || originalPosition === "absolute" || originalPosition === "sticky";

  important("position", mustNeutralize ? "relative" : originalPosition || "static");
  if (mustNeutralize) {
    important("top", "auto");
    important("right", "auto");
    important("bottom", "auto");
    important("left", "auto");
    important("inset", "auto");
  }

  important("margin", "0");
  important("width", `${width}px`);
  important("height", `${height}px`);
  important("box-sizing", "border-box");
  important("float", "none");
  important("clear", "none");

  const rootComputed = getComputedStyle(root);
  if (isTransparent(rootComputed.backgroundColor) && rootComputed.backgroundImage === "none") {
    important("background-color", resolveBackdropColor(root));
  }

  return { width, height };
}

// -----------------------------
// Core recursive freeze (light DOM only — shadow trees are handled by
// freezeShadowDom, which recurses back into this function per shadow child)
// -----------------------------

function freezeElement(root) {
  const originals = [root, ...root.querySelectorAll("*")];
  let finalRoot = root.cloneNode(true);
  const clones = [finalRoot, ...finalRoot.querySelectorAll("*")];
  let pseudoCSS = "";
  let nextPseudoId = 0;

  for (let i = 0; i < originals.length; i++) {
    const original = originals[i];
    let clone = clones[i];

    inlineComputedStyle(original, clone);
    resetSelectionArtifacts(clone);
    pseudoCSS += capturePseudoPair(original, clone, () => nextPseudoId++);

    const replacement = createReplacementForNode(original);
    if (replacement) {
      replacement.setAttribute("style", clone.getAttribute("style") || "");
      if (clone.parentNode) clone.replaceWith(replacement);
      else finalRoot = replacement;
      clone = replacement;
    }

    freezeFormState(original, clone);
    freezeShadowDom(original, clone, (css) => {
      pseudoCSS += css;
    });

    if (original !== root) constrainPositioning(original, clone, root);
  }

  return { clone: finalRoot, pseudoCSS };
}

function captureSelection(root) {
  const { clone, pseudoCSS } = freezeElement(root);
  const { width, height } = lockRootFormFactor(root, clone);
  return { clone, pseudoCSS, width, height };
}

// -----------------------------
// Fonts: re-including whole page stylesheets risks a page's own broad/
// !important rules leaking onto our wrapper markup, so pull out only the
// @font-face rules actually needed to render inlined font-family values.
// Cross-origin sheets we can't introspect (CORS) are re-linked wholesale —
// in practice these are almost always font CDNs, so this is the case that
// most needs the fallback anyway.
// -----------------------------

function collectFontFaceCSS() {
  const seen = new Set();
  let css = "";
  let links = "";

  function visitSheet(sheet) {
    if (!sheet || seen.has(sheet)) return;
    seen.add(sheet);

    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      if (sheet.ownerNode && sheet.ownerNode.tagName === "LINK") {
        links += sheet.ownerNode.outerHTML + "\n";
      }
      return;
    }

    for (const rule of rules) {
      if (typeof CSSFontFaceRule !== "undefined" && rule instanceof CSSFontFaceRule) {
        css += rule.cssText + "\n";
      } else if (typeof CSSImportRule !== "undefined" && rule instanceof CSSImportRule && rule.styleSheet) {
        visitSheet(rule.styleSheet);
      }
    }
  }

  for (const sheet of document.styleSheets) visitSheet(sheet);
  return { css, links };
}

function escapeStyleText(cssText) {
  // Defends against pseudo-element `content` text that happens to contain
  // a literal "</style" sequence, which would otherwise truncate the block.
  return cssText.replace(/<\/style/gi, "<\\/style");
}

// -----------------------------
// Public entry point
// -----------------------------

function buildPrintHTML(elements) {
  const container = document.createElement("div");
  let pageCSS = "";
  let pseudoCSS = "";

  elements.forEach((el, idx) => {
    const capture = captureSelection(el);
    pseudoCSS += capture.pseudoCSS;

    const pageClass = `epp-page-${idx}`;
    capture.clone.classList.add("epp-page", pageClass);
    pageCSS += `@page pg${idx}{size:${capture.width}px ${capture.height}px;margin:0}\n`;
    pageCSS += `.${pageClass}{page:pg${idx}}\n`;

    container.appendChild(capture.clone);
  });

  const bodyHTML = container.innerHTML;
  const fonts = collectFontFaceCSS();
  const base = `<base href="${location.href}">`;
  const structuralCSS = `
html, body { margin: 0; padding: 0; background: #fff; }
.epp-page { break-after: page; }
.epp-page:last-child { break-after: auto; }
`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
${base}
<title>Print Selected Elements</title>
${fonts.links}
<style>${escapeStyleText(fonts.css)}</style>
<style>${escapeStyleText(structuralCSS + pageCSS + pseudoCSS)}</style>
</head>
<body>
${bodyHTML || "<p>(No elements selected)</p>"}
</body>
</html>`;
}
