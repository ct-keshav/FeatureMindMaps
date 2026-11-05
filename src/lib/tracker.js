// Tracker helpers shared by the browser app AND the build (vite.config.js → build/features-plugin.js).
// Keep this file dependency-free and DOM-free.

/** Statuses that count as "not open" (greyed chip, excluded from badge counts). */
const CLOSED = /^(resolved|closed|done|fixed|won'?t fix|n\/?a)$/i;

/** Item fields rendered in the item header instead of as labelled fields. */
export const HEADER_FIELDS = new Set(['title', 'status', 'owner']);

/** Panel colour tones, in the order they're assigned when feature.json doesn't pick one. */
export const TONES = ['critical', 'warning', 'info', 'success', 'neutral'];

export const isOpen = (item) => !CLOSED.test(String(item?.status ?? '').trim());

/** Normalise a field value to display text. Arrays become one line per entry. */
export function fieldText(value) {
  if (Array.isArray(value)) return value.join('\n').trim();
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** "discussedSolution" / "blockers_on_engage" / "MyFeature" → "Discussed solution" / "Blockers on engage" / "My feature" */
export function humanize(key) {
  const words = String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The items for one panel. Plain strings are accepted as title-only items. */
export function itemsFor(tracker, id) {
  const list = tracker?.[id];
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => (typeof item === 'string' ? { title: item } : item))
    .filter((item) => item && typeof item === 'object');
}

/**
 * Toolbar panels for a feature.
 * - feature.json `panels` wins (controls order, labels, tones, empty text).
 * - Otherwise every array in tracker.json becomes a panel, in file order.
 */
export function resolvePanels(config, tracker) {
  const declared = Array.isArray(config?.panels) ? config.panels : null;
  const source =
    declared ??
    (tracker && typeof tracker === 'object'
      ? Object.keys(tracker)
          .filter((key) => Array.isArray(tracker[key]))
          .map((id) => ({ id }))
      : []);

  return source
    .filter((panel) => panel && panel.id != null)
    .map((panel, i) => {
      const label = panel.label || humanize(panel.id);
      return {
        id: String(panel.id),
        label,
        tone: TONES.includes(panel.tone) ? panel.tone : TONES[i % (TONES.length - 1)],
        empty: panel.empty || `Nothing open in “${label}”.`,
      };
    });
}
