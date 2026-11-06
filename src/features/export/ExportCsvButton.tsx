import type { ExportKind } from '../../app/csvExport';
import { exportCsv } from '../../app/csvExport';
import { t } from '../../i18n';

/** Downloads one list as a CSV file for a spreadsheet (F35). The list itself does not change. */
export function ExportCsvButton({ kind }: { kind: ExportKind }) {
  return (
    <button type="button" className="btn" onClick={() => exportCsv(kind)}>
      {t('csv.export')}
    </button>
  );
}
