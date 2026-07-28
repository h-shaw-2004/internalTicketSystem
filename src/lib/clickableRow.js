/**
 * Makes a whole table row activate the link or button inside it, so the click
 * target is the full bar rather than a few characters of text.
 *
 * Deliberately does NOT put `role="button"` or `tabIndex` on the row. That would
 * break the table's semantics for screen readers and create a second tab stop
 * for the same action. The real link/button stays in the row and remains the
 * keyboard and assistive-tech path; this only widens the mouse target.
 *
 * Spread onto a `<tr>`:
 *   <tr {...clickableRow(() => navigate(href))}>
 */
export function clickableRow(activate) {
  return {
    className: 'row-clickable',
    onClick: (event) => {
      // A real control was clicked — let it do its own job rather than firing
      // the action twice.
      if (event.target.closest('a, button, input, select, textarea, label')) return;

      // Selecting text inside a row shouldn't navigate away from it.
      if (window.getSelection()?.toString()) return;

      activate();
    },
  };
}
