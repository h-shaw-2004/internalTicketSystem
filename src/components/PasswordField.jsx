import { useState } from 'react';

// Inline SVG rather than an icon dependency — two paths each, and it keeps the
// bundle and the CSP story simple.
function EyeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M10.6 5.2A11 11 0 0 1 12 5c6.4 0 10 7 10 7a18.6 18.6 0 0 1-3.2 4.2" />
      <path d="M6.2 6.2A18.7 18.7 0 0 0 2 12s3.6 7 10 7a10.8 10.8 0 0 0 4.3-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <line x1="3" y1="3" x2="21" y2="21" />
    </svg>
  );
}

/**
 * Password input with a show/hide toggle.
 *
 * The toggle sits outside the <label> on purpose: a <button> nested inside a
 * label inherits the label's activation behaviour and steals focus back to the
 * input on every click, which makes the control feel broken.
 */
export default function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete = 'current-password',
  invalid = false,
  hint = null,
  required = true,
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>

      <div className="input-with-action">
        <input
          id={id}
          name={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={onChange}
          aria-invalid={invalid || undefined}
          required={required}
        />
        <button
          type="button"
          className="field-action"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>

      {hint && <small className="hint">{hint}</small>}
    </div>
  );
}
