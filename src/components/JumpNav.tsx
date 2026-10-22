import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';

// A side panel with jump marks to the sections of a long form. It stays in view while the content area scrolls
// (CSS: .subnav is sticky) and marks the section that is being read. A jump scrolls the section into view and moves
// the focus to its heading, so keyboard and screen reader users land there too.

export interface JumpSection {
  /** The id of the section element; its first h2 gets the focus */
  id: string;
  title: string;
  icon: IconName;
}

/** How far below the top of the content area a section counts as the one being read, in pixels */
const READ_LINE = 96;

export function JumpNav({ label, sections }: { label: string; sections: readonly JumpSection[] }) {
  const ref = useRef<HTMLElement>(null);
  const [current, setCurrent] = useState(sections[0]?.id);
  // the effect depends on the ids only, so a new array with the same sections does not restart it
  const ids = sections.map((s) => s.id).join(' ');

  useEffect(() => {
    const scroller = ref.current?.closest('.main');
    if (!scroller) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = scroller.getBoundingClientRect().top + READ_LINE;
      const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      const list = ids.split(' ');
      let id = list[0];
      for (const s of list) {
        const el = document.getElementById(s);
        if (el && (atEnd || el.getBoundingClientRect().top <= top)) id = s;
      }
      setCurrent(id);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [ids]);

  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    el.querySelector('h2')?.focus({ preventScroll: true });
  };

  return (
    <nav ref={ref} className="subnav" aria-label={label}>
      <ul>
        {sections.map((s) => (
          <li key={s.id}>
            <button type="button" className={'nav' + (current === s.id ? ' on' : '')} aria-current={current === s.id ? 'location' : undefined} onClick={() => jump(s.id)}>
              <Icon n={s.icon} />
              <span>{s.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
