import { useId, type ReactNode } from 'react';

// Form controls with a visible label, an optional hint and an error that is announced and linked to the control.

interface Common {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
}

function Messages({ id, hint, error }: { id: string; hint?: string | undefined; error?: string | undefined }) {
  return (
    <>
      {hint && (
        <p className="f-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="f-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </>
  );
}

const describedBy = (id: string, hint?: string, error?: string) =>
  [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;

export function TextField({
  label,
  hint,
  error,
  value,
  onChange,
  required,
  type = 'text',
  autoComplete,
  inputMode,
  maxLength,
  className,
}: Common & {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: 'text' | 'email' | 'tel';
  autoComplete?: string;
  inputMode?: 'text' | 'numeric' | 'email' | 'tel';
  maxLength?: number;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={'field' + (className ? ` ${className}` : '')}>
      <label htmlFor={id}>
        {label}
        {required && <span className="f-req" aria-hidden="true"> *</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        aria-required={required || undefined}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        spellCheck={false}
      />
      <Messages id={id} hint={hint} error={error} />
    </div>
  );
}

export function TextArea({ label, hint, error, value, onChange, maxLength }: Common & { value: string; onChange: (value: string) => void; maxLength?: number }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        value={value}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        maxLength={maxLength}
      />
      <Messages id={id} hint={hint} error={error} />
    </div>
  );
}

/** A group of radio buttons. `value` null means nothing is chosen yet. */
export function Choice<T extends string>({
  label,
  hint,
  error,
  value,
  options,
  onChange,
  required,
}: Common & { value: T | null; options: readonly { value: T; label: string; hint?: string }[]; onChange: (value: T) => void; required?: boolean }) {
  const id = useId();
  return (
    <fieldset className="field choice" aria-describedby={describedBy(id, hint, error)} aria-invalid={error ? true : undefined}>
      <legend>
        {label}
        {required && <span className="f-req" aria-hidden="true"> *</span>}
      </legend>
      {hint && (
        <p className="f-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      <div className="choice-opts">
        {options.map((o) => {
          // the whole box is clickable; the option's name is its label, the hint is its description
          const optId = `${id}-${o.value}`;
          return (
            <label key={o.value} className={'opt' + (value === o.value ? ' on' : '')}>
              <input
                type="radio"
                name={id}
                value={o.value}
                checked={value === o.value}
                onChange={() => onChange(o.value)}
                aria-labelledby={`${optId}-l`}
                aria-describedby={o.hint ? `${optId}-h` : undefined}
              />
              <span>
                <span id={`${optId}-l`}>{o.label}</span>
                {o.hint && <small id={`${optId}-h`}>{o.hint}</small>}
              </span>
            </label>
          );
        })}
      </div>
      <Messages id={id} error={error} />
    </fieldset>
  );
}

export function CheckField({ label, hint, checked, onChange }: Omit<Common, 'error'> & { checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label className="check" htmlFor={id}>
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-describedby={hint ? `${id}-hint` : undefined} />
        {label}
      </label>
      <Messages id={id} hint={hint} />
    </div>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="f-row">{children}</div>;
}
