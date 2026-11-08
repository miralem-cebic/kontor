import { t } from '../../i18n';
import { useApp } from '../../store/appStore';

// The files of the folder that could not be read when the company was opened (a file being synchronised, written by a
// newer kontor, or damaged). Their records are missing from every list and figure, so the notice stays on the overview,
// the reports and the tax aids for as long as the company is open, with the file names and the reason (#96).

export function LoadIssuesNotice() {
  const issues = useApp((s) => s.loadIssues);
  if (!issues.length) return null;
  const title = t('loadIssues.title', { n: issues.length });
  return (
    <div className="note warn load-issues" role="status" aria-label={title}>
      <p>
        <strong>{title}</strong>
      </p>
      <p>{t('loadIssues.text')}</p>
      <p>{t('loadIssues.causes')}</p>
      <details>
        <summary>{t('loadIssues.files')}</summary>
        <ul>
          {issues.map((issue) => (
            <li key={issue.file}>
              <code>{issue.file}</code>: {issue.message}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
