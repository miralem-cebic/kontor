import { t } from '../../i18n';
import { showToast } from '../../store/appStore';

/**
 * Copies a text to the clipboard. `navigator.clipboard` needs a secure context and a permission; when it is missing or
 * refused, a hidden text field and the old copy command are tried. If both fail, the toast says so and the person copies
 * the value by hand.
 */
export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    showToast(t('ustva.copied', { value }));
    return true;
  } catch {
    // fall through to the fallback
  }
  try {
    const field = document.createElement('textarea');
    field.value = value;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    const ok = document.execCommand('copy');
    field.remove();
    if (ok) {
      showToast(t('ustva.copied', { value }));
      return true;
    }
  } catch {
    // fall through to the message
  }
  showToast(t('ustva.copyFailed'));
  return false;
}
