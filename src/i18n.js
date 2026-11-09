// Interface language: English or Chinese (简体中文). Strings are written in place as pairs, tr('Open', '打开'),
// and the static page marks its text with data-zh attributes (applyI18n). The language comes from, in order: the
// URL (?lang=zh or ?lang=en), the host app (DollPet sets window.DOLL_LANG), the choice saved in this browser, and
// the browser's own language. setLang switches it live; DollPet calls window.setDollLang when its setting changes.

const KEY = 'dollStudio.lang';
const norm = l => (/^zh/i.test(l ?? '') ? 'zh' : /^en/i.test(l ?? '') ? 'en' : null);

function detect() {
  try {
    const q = norm(new URLSearchParams(location.search).get('lang'));
    if (q) return q;
  } catch {}
  const host = norm(globalThis.DOLL_LANG);
  if (host) return host;
  try {
    const saved = norm(localStorage.getItem(KEY));
    if (saved) return saved;
  } catch {}
  const nav = globalThis.navigator?.languages?.[0] ?? globalThis.navigator?.language;
  return norm(nav) ?? 'en';
}

let lang = detect();
const listeners = new Set();

export const getLang = () => lang;
export const tr = (en, zh) => (lang === 'zh' ? zh : en);
// A label object's text in the current language: { label, zh }.
export const labelOf = o => (lang === 'zh' && o?.zh) || o?.label || '';
export const onLang = fn => listeners.add(fn);

export function setLang(l, { save = true } = {}) {
  l = norm(l) ?? 'en';
  if (save) try { localStorage.setItem(KEY, l); } catch {}
  if (l === lang) return;
  lang = l;
  applyI18n();
  for (const fn of listeners) fn(l);
}

// Swaps the text of every element marked for translation:
//   data-zh            its own text (the last text node, so icons inside it stay)
//   data-zh-html       its whole content, for text with markup in it
//   data-zh-title, data-zh-placeholder, data-zh-aria   those attributes
// The English is the page as written; it is kept on the element the first time round.
export function applyI18n(root = globalThis.document) {
  if (!root) return;
  if (root.documentElement) root.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  const zh = lang === 'zh';
  for (const el of root.querySelectorAll('[data-zh]')) {
    const nodes = [...el.childNodes].filter(n => n.nodeType === 3 && n.nodeValue.trim());
    const node = nodes[nodes.length - 1];
    if (!node) { el._en ??= el.textContent; el.textContent = zh ? el.dataset.zh : el._en; continue; }
    node._en ??= node.nodeValue;
    node.nodeValue = zh ? el.dataset.zh : node._en;
  }
  for (const el of root.querySelectorAll('[data-zh-html]')) {
    el._enHTML ??= el.innerHTML;
    el.innerHTML = zh ? el.dataset.zhHtml : el._enHTML;
  }
  for (const [data, attr] of [['zhTitle', 'title'], ['zhPlaceholder', 'placeholder'], ['zhAria', 'aria-label']]) {
    const sel = '[data-' + data.replace(/[A-Z]/g, c => '-' + c.toLowerCase()) + ']';
    for (const el of root.querySelectorAll(sel)) {
      const k = '_en_' + attr;
      el[k] ??= el.getAttribute(attr) ?? '';
      el.setAttribute(attr, zh ? el.dataset[data] : el[k]);
    }
  }
}

if (typeof window !== 'undefined') window.setDollLang = l => setLang(l, { save: false });
