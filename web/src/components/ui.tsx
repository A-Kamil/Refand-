import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { ApiError } from '../api';
import { IconAlert, IconRefresh } from './Icons';
import { moneyMinor } from '../lib/format';

/* ── Boutons ─────────────────────────────────────────────── */

type Variant = 'primary' | 'secondary' | 'ghost';

export function Button({
  variant = 'secondary',
  busy,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={`btn btn--${variant} ${busy ? 'is-busy' : ''} ${className}`}
    >
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = 'secondary',
  className = '',
  ...rest
}: LinkProps & { variant?: Variant }) {
  return <Link {...rest} className={`btn btn--${variant} ${className}`} />;
}

/* ── Badges ──────────────────────────────────────────────── */

export type Tone = 'neutral' | 'green' | 'danger' | 'warn';

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

/* ── Montant ─────────────────────────────────────────────── */

/** `minor` : montant en centimes entiers, tel que renvoyé par l'API. */
export function Money({
  minor,
  currency,
  tone,
  decimals,
}: {
  minor: number;
  currency: string;
  tone?: 'recover' | 'danger';
  decimals?: boolean;
}) {
  return <span className={`money ${tone ? `money--${tone}` : ''}`}>{moneyMinor(minor, currency, { decimals })}</span>;
}

/* ── États ───────────────────────────────────────────────── */

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden />
      <p className="muted">{label}…</p>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state state--empty">
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  extra,
}: {
  error: Error;
  onRetry?: () => void;
  extra?: ReactNode;
}) {
  const network = error instanceof ApiError && error.kind === 'network';
  return (
    <div className="state state--error" role="alert">
      <IconAlert width={22} height={22} />
      <h3>{network ? 'Backend unreachable' : 'Something went wrong'}</h3>
      <p className="muted">{error.message}</p>
      <div className="row">
        {onRetry && (
          <Button onClick={onRetry}>
            <IconRefresh /> Retry
          </Button>
        )}
        {extra}
      </div>
    </div>
  );
}

/* ── Mise en page de page ────────────────────────────────── */

export function PageHeader({
  title,
  lead,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {lead && <p className="muted lead">{lead}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}

export function Sheet({
  title,
  aside,
  children,
  className = '',
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`sheet ${className}`}>
      {(title || aside) && (
        <header className="sheet__head">
          <h2>{title}</h2>
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}
