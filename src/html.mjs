// Module-private safe-render helpers for the Ideen module.
// Deliberately tiny and NOT a shared framework: indiv.crm-module-sdk#1 owns the shared
// safe UI primitives. Replace these with the SDK primitives once that contract is published.

const ESCAPES = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' });

/** Escapes any value for HTML text and double-quoted attribute contexts. */
export const escapeHtml = value => String(value ?? '').replace(/[&<>"'`]/g, c => ESCAPES[c]);

/** Restricts host-provided identifiers (e.g. instance ids) to a DOM-id-safe alphabet. */
export const domId = (value, fallback = 'main') => {
  const cleaned = typeof value === 'string' ? value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) : '';
  return cleaned || fallback;
};

/** Recursively freezes acyclic plain data so host code cannot mutate module contracts or results. */
export function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}
