import { describe, expect, it } from 'vitest';
import { tabIndexForKey } from '../../src/lib/tabs';

// The keyboard of the WAI-ARIA tabs pattern (https://www.w3.org/WAI/ARIA/apg/patterns/tabs/): the arrow keys move to
// the next or previous tab and wrap around, Home and End go to the first and the last tab (#82).

describe('tabIndexForKey', () => {
  it('ArrowRight goes to the next tab and from the last one to the first', () => {
    expect(tabIndexForKey('ArrowRight', 0, 4)).toBe(1);
    expect(tabIndexForKey('ArrowRight', 2, 4)).toBe(3);
    expect(tabIndexForKey('ArrowRight', 3, 4)).toBe(0);
  });

  it('ArrowLeft goes to the previous tab and from the first one to the last', () => {
    expect(tabIndexForKey('ArrowLeft', 3, 4)).toBe(2);
    expect(tabIndexForKey('ArrowLeft', 0, 4)).toBe(3);
  });

  it('Home and End go to the first and the last tab', () => {
    expect(tabIndexForKey('Home', 2, 4)).toBe(0);
    expect(tabIndexForKey('End', 1, 4)).toBe(3);
  });

  it('other keys are left to the browser (Tab leaves the list, Enter and Space press the button)', () => {
    for (const key of ['Tab', 'Enter', ' ', 'ArrowUp', 'ArrowDown', 'a']) expect(tabIndexForKey(key, 1, 4)).toBeNull();
  });

  it('a list without tabs has nowhere to go', () => {
    expect(tabIndexForKey('ArrowRight', 0, 0)).toBeNull();
    expect(tabIndexForKey('End', 0, 0)).toBeNull();
  });
});
