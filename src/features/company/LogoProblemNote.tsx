import { t } from '../../i18n';
import { storedLogoProblemText } from '../../lib/labels';
import { useApp } from '../../store/appStore';

// When the logo file of the folder is not the one company.json names, or the checks refuse it (#78): in the logo
// settings the reason, and before a document is issued or finalized that it is made without the logo.

export function LogoProblemNote({ beforeIssue = false }: { beforeIssue?: boolean }) {
  const problem = useApp((s) => s.logoProblem);
  if (!problem) return null;
  return (
    <p className="f-error logo-problem" role="status">
      {beforeIssue ? t('logo.problem.onIssue') : storedLogoProblemText(problem)}
    </p>
  );
}
