import type { ExportKind } from '../../app/csvExport';
import { exportCsv, exportXlsx } from '../../app/csvExport';
import { t } from '../../i18n';

/** Downloads one list as a CSV file (F35) or as an Excel file (F37). The list itself does not change. */
export function ExportCsvButton({ kind }: { kind: ExportKind }) {
  return (
    <>
      <button type="button" className="btn" onClick={() => exportCsv(kind)}>
        {t('csv.export')}
      </button>
      <button type="button" className="btn" onClick={() => void exportXlsx(kind)}>
        {t('export.excel')}
      </button>
    </>
  );
}
