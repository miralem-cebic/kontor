import { useEffect, useRef, useState } from 'react';
import { openCompany, startSetup, useSession } from '../../app/session';
import { Icon } from '../../components/Icon';
import { t } from '../../i18n';
import { useApp } from '../../store/appStore';

/** Button with the open company; its menu lists the other known companies and "Add company". */
export function CompanySwitcher() {
  const name = useApp((s) => s.company?.name ?? '');
  const logoUrl = useApp((s) => s.logoUrl);
  const companies = useSession((s) => s.companies);
  const currentId = useSession((s) => s.currentId);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = (focusButton: boolean) => {
    setOpen(false);
    if (focusButton) button.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (e.key === 'Tab') close(false);
  };

  return (
    <div className="switcher">
      <button
        ref={button}
        type="button"
        className="sw-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('switcher.label', { name })}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="sw-logo">{logoUrl ? <img src={logoUrl} alt="" /> : <Icon n="building" s={14} />}</span>
        <span className="sw-name">{name}</span>
        <Icon n="chevD" s={14} />
      </button>
      {open && (
        <div ref={menu} className="pop menu" role="menu" aria-label={t('switcher.menu')} onKeyDown={onKey}>
          <div className="mhead">{t('switcher.companies')}</div>
          {companies.map((c) => (
            <button
              key={c.id}
              type="button"
              className="mi"
              role="menuitemradio"
              aria-checked={c.id === currentId}
              onClick={() => {
                close(false);
                void openCompany(c.id);
              }}
            >
              <span className="mi-l">{c.name}</span>
              {c.id === currentId && <Icon n="check" s={14} className="mi-check" />}
            </button>
          ))}
          <div className="sep" />
          <button
            type="button"
            className="mi"
            role="menuitem"
            onClick={() => {
              close(false);
              startSetup();
            }}
          >
            <Icon n="plus" s={14} />
            <span className="mi-l">{t('switcher.add')}</span>
          </button>
        </div>
      )}
    </div>
  );
}
