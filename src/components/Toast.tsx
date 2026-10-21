import { useEffect } from 'react';
import { dismissToast, useApp } from '../store/appStore';
import { Icon } from './Icon';
import { t } from '../i18n';

export function ToastHost() {
  const toast = useApp((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(dismissToast, 4000);
    return () => clearTimeout(h);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className="toast" role="status" aria-live="polite" key={toast.id}>
      <span>{toast.msg}</span>
      <button type="button" className="icon-btn" onClick={dismissToast} aria-label={t('common.dismiss')}>
        <Icon n="x" s={14} />
      </button>
    </div>
  );
}
