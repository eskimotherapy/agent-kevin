/**
 * HTML sanitizer for untrusted markup the dashboard renders inline (currently
 * the where-am-i radar digest; reusable for any future inline-HTML surface).
 *
 * DOMPurify needs a real DOM to walk, and linkedom is too thin for it (no
 * `document.implementation.createHTMLDocument`, so DOMPurify silently no-ops).
 * jsdom provides a complete enough DOM. Both deps are heavy, so they load
 * lazily on first call and the configured DOMPurify instance is memoised for
 * the life of the process.
 */

import type { WindowLike } from 'dompurify';

type Sanitizer = (dirty: string) => string;

let sanitizerPromise: Promise<Sanitizer> | null = null;

const buildSanitizer = async (): Promise<Sanitizer> => {
  const [{ default: createDOMPurify }, { JSDOM }] = await Promise.all([import('dompurify'), import('jsdom')]);
  const purify = createDOMPurify(new JSDOM('').window as unknown as WindowLike);
  return (dirty) => purify.sanitize(dirty);
};

/**
 * Strip scripts, event-handler attributes, and dangerous URLs from untrusted
 * HTML. Safe presentational markup (headings, links, code, lists, emphasis) is
 * preserved. Async because the DOM backing loads lazily on first use.
 */
export const sanitizeHtml = async (dirty: string): Promise<string> => {
  sanitizerPromise ??= buildSanitizer();
  return (await sanitizerPromise)(dirty);
};
