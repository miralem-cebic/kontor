import { useState } from 'react';
import { downloadDocumentPdf } from '../../app/documentPdf';
import { Icon } from '../../components/Icon';
import type { DocumentId } from '../../data/ids';
import { t } from '../../i18n';
import { showToast } from '../../store/appStore';

/**
 * Downloads the PDF of a saved quote or invoice. `prepare` saves changes that are not saved yet and returns the
 * document's ID, or null when the form has errors; the PDF always shows the document as saved.
 */
export function PdfButton({ prepare }: { prepare: () => DocumentId | null }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const id = prepare();
    if (!id) return;
    setBusy(true);
    const r = await downloadDocumentPdf(id);
    setBusy(false);
    if (!r.ok) showToast(t('documents.pdfFailed'));
    else if (r.changed) showToast(t('documents.pdfChanged', { name: r.fileName }));
    else if (r.missing.length) showToast(t('documents.pdfMissing', { name: r.fileName, chars: r.missing.join(' ') }));
    else showToast(t('documents.pdfDone', { name: r.fileName }));
  };
  return (
    <button type="button" className="btn" onClick={() => void run()} disabled={busy}>
      <Icon n="download" s={14} />
      {busy ? t('documents.pdfBusy') : t('documents.pdf')}
    </button>
  );
}
