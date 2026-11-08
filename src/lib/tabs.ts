// The keyboard of a tab list after the WAI-ARIA tabs pattern (https://www.w3.org/WAI/ARIA/apg/patterns/tabs/): only
// the selected tab is in the Tab order (roving tabindex), and the arrow keys, Home and End move between the tabs of a
// horizontal list. Tab leaves the list; Enter and Space press the focused tab as a button.

/** The tab a key moves to, from the tab at `current` of `count` tabs, or null for a key the list does not handle */
export function tabIndexForKey(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
      return (current + 1) % count;
    case 'ArrowLeft':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
