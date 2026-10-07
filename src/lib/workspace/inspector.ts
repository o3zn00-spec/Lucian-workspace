"use client";

// Visual Editor — element inspector (Phase: visual editor foundation).
//
// Strategy (honest about capabilities):
//  - The Live Runtime iframe is cross-origin (WebContainer URL), so direct
//    DOM access is impossible. Instead we inject an inspector script INTO the
//    project before mount (index.html or a JS entry) that reports clicked
//    elements back via postMessage.
//  - The inspector reports tag/class/text/selector for the clicked element.
//    LUCIAN then searches project source files for the best match so the
//    user can jump straight to the code (and later, edit visually).

export interface InspectedElement {
  tag: string;
  id: string | null;
  classes: string[];
  text: string;
  selector: string;
}

/** The script injected into the running project. Framework-agnostic. */
export const INSPECTOR_SCRIPT = `
(function () {
  if (window.__lucianInspector) return;
  window.__lucianInspector = true;
  var enabled = false;
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #f97316;background:rgba(249,115,22,0.08);border-radius:2px;display:none;transition:all 40ms ease;';
  document.documentElement.appendChild(overlay);

  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'lucian-inspect-toggle') {
      enabled = !!e.data.enabled;
      if (!enabled) overlay.style.display = 'none';
    }
    if (e.data && e.data.type === 'lucian-dom-snapshot-request') {
      var requestId = e.data.requestId;
      var selector = e.data.selector || 'body';
      try {
        var root = document.querySelector(selector);
        if (!root) throw new Error('No rendered element matches ' + selector);
        var clone = root.cloneNode(true);
        Array.prototype.forEach.call(clone.querySelectorAll('script,style,link,meta,noscript'), function (node) { node.remove(); });
        var interactive = Array.prototype.slice.call(root.querySelectorAll('a,button,input,select,textarea,[role]'), 0, 80).map(function (node) {
          var label = (node.getAttribute('aria-label') || node.textContent || node.getAttribute('placeholder') || '').trim().replace(/\\s+/g, ' ').slice(0, 100);
          return '<' + node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') + '>' + (label ? ' ' + label : '');
        });
        parent.postMessage({
          type: 'lucian-dom-snapshot-response',
          requestId: requestId,
          payload: {
            url: location.href,
            title: document.title,
            selector: selector,
            text: (root.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 8000),
            html: clone.outerHTML.slice(0, 16000),
            interactive: interactive
          }
        }, '*');
      } catch (error) {
        parent.postMessage({ type: 'lucian-dom-snapshot-response', requestId: requestId, error: String(error && error.message || error) }, '*');
      }
    }
  });

  function describe(el) {
    var classes = (typeof el.className === 'string' ? el.className : '').split(/\\s+/).filter(Boolean);
    var selector = el.tagName.toLowerCase();
    if (el.id) selector += '#' + el.id;
    else if (classes.length) selector += '.' + classes.slice(0, 3).join('.');
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: classes,
      text: (el.textContent || '').trim().slice(0, 120),
      selector: selector
    };
  }

  document.addEventListener('mousemove', function (e) {
    if (!enabled) return;
    var el = e.target;
    if (!el || el === overlay) return;
    var r = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left = r.left + 'px';
    overlay.style.top = r.top + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
  }, true);

  document.addEventListener('click', function (e) {
    if (!enabled) return;
    e.preventDefault();
    e.stopPropagation();
    parent.postMessage({ type: 'lucian-inspect-click', element: describe(e.target) }, '*');
  }, true);
})();
`;

/** Inject the inspector into project files before mounting (idempotent). */
export function injectInspector(files: { path: string; content: string; binary: boolean }[]): void {
  const scriptTag = `<script>/*lucian-inspector*/${INSPECTOR_SCRIPT}</script>`;
  const html = files.find((f) => !f.binary && /(^|\/)index\.html$/i.test(f.path));
  if (html && !html.content.includes("lucian-inspector")) {
    if (/<\/body>/i.test(html.content)) {
      html.content = html.content.replace(/<\/body>/i, `${scriptTag}</body>`);
    } else {
      html.content += scriptTag;
    }
  }
}

/** Find source files likely containing the clicked element (by class/id/text). */
export function findElementInSource(
  element: InspectedElement,
  files: { path: string; content: string; binary: boolean }[],
): { path: string; line: number; preview: string }[] {
  const hits: { path: string; line: number; preview: string; score: number }[] = [];
  const needles: { value: string; score: number }[] = [];
  if (element.id) needles.push({ value: element.id, score: 10 });
  for (const cls of element.classes.slice(0, 4)) needles.push({ value: cls, score: 5 });
  if (element.text && element.text.length >= 4) {
    needles.push({ value: element.text.slice(0, 40), score: 8 });
  }
  if (needles.length === 0) return [];

  for (const f of files) {
    if (f.binary) continue;
    if (!/\.(html|jsx?|tsx?|vue|svelte|css)$/i.test(f.path)) continue;
    const lines = f.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      let lineScore = 0;
      for (const n of needles) {
        if (lines[i].includes(n.value)) lineScore += n.score;
      }
      if (lineScore >= 5) {
        hits.push({ path: f.path, line: i + 1, preview: lines[i].trim().slice(0, 120), score: lineScore });
      }
    }
  }
  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ path, line, preview }) => ({ path, line, preview }));
}
