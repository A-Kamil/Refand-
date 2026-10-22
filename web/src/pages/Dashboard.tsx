import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAsync } from '../lib/useAsync';
import { integer, moneyMinor } from '../lib/format';
import { Badge, EmptyState, ErrorState, Loading, Sheet } from '../components/ui';
import { Underlined } from '../components/Pen';
import { HowItWorks } from '../components/HowItWorks';
import { DiscrepancyTable } from '../components/DiscrepancyTable';
import { IconArrowDown, IconArrowRight } from '../components/Icons';

function Kpi({ label, value, note, tone }: { label: string; value: ReactNode; note?: string; tone?: 'recover' }) {
  return (
    <div className="kpi">
      <div className="eyebrow">{label}</div>
      <div className={`kpi__value ${tone ? `kpi__value--${tone}` : ''}`}>{value}</div>
      {note && <div className="faint small">{note}</div>}
    </div>
  );
}

export function Dashboard() {
  const { state, reload } = useAsync(() => api.getDashboard(), []);

  return (
    <>
      <section className="hero">
        <div className="eyebrow">Ocean freight audit &amp; recovery</div>
        <h1 className="hero__title">
          Get back what’s <Underlined>yours.</Underlined>
        </h1>
        <p className="hero__lead">
          refand checks every freight invoice against your carrier contract and helps you claim back what was billed
          above it — money you may not know you’ve lost.
        </p>
        <div className="hero__actions">
          <Link to="/audit/new" className="cta-route">
            <span className="cta-route__label">Find out what you’re owed</span>
            <span className="cta-route__path" aria-hidden />
            <span className="cta-route__go" aria-hidden>
              <IconArrowRight width={18} height={18} strokeWidth={2.4} />
            </span>
          </Link>
          <a href="#how" className="hero__scroll">
            How it works <IconArrowDown width={16} height={16} strokeWidth={2.2} />
          </a>
        </div>
      </section>

      <HowItWorks />

      {state.status === 'loading' && <Loading label="Loading your dashboard" />}

      {state.status === 'error' && (
        <Sheet title="Dashboard">
          <ErrorState
            error={state.error}
            onRetry={reload}
          />
        </Sheet>
      )}

      {state.status === 'ready' && (
        <>
          {/* Chiffres réels, calculés par le backend depuis la base de données */}
          <Sheet
            title="Your audits"
            className="sheet--card"
            aside={<Badge tone="green">Live data</Badge>}
          >
            {(() => {
              const l = state.data.live;
              return (
                <>
                  <div className="kpi-strip kpi-strip--3">
                    <Kpi
                      label="Verified recoverable"
                      value={moneyMinor(l.verifiedRecoverableMinor, l.currency, { decimals: false })}
                      note={`${integer(l.discrepancies.verified)} verified anomal${l.discrepancies.verified === 1 ? 'y' : 'ies'}`}
                      tone="recover"
                    />
                    <Kpi
                      label="Potential to review"
                      value={moneyMinor(l.potentialToReviewMinor, l.currency, { decimals: false })}
                      note={`${integer(l.discrepancies.needsReview)} to confirm — not counted as recoverable`}
                    />
                    <Kpi
                      label="Analyses completed"
                      value={integer(l.analyses.total)}
                      note={`${integer(l.claims.total)} claim draft${l.claims.total === 1 ? '' : 's'}`}
                    />
                  </div>
                  <p className="sheet__foot faint small">{l.label}</p>

                  <h3 className="sheet__subhead">Recent anomalies</h3>
                  {l.recentDiscrepancies.length === 0 ? (
                    <EmptyState
                      title="No audit yet"
                      action={
                        <Link to="/audit/new" className="cta-route">
                          <span className="cta-route__label">Start your first audit</span>
                          <span className="cta-route__path" aria-hidden />
                          <span className="cta-route__go" aria-hidden>
                            <IconArrowRight width={18} height={18} strokeWidth={2.4} />
                          </span>
                        </Link>
                      }
                    >
                      Upload a freight invoice and its contract — refand shows where you were billed above what you
                      agreed.
                    </EmptyState>
                  ) : (
                    <DiscrepancyTable items={l.recentDiscrepancies} caption="Recent anomalies" />
                  )}
                </>
              );
            })()}
          </Sheet>
        </>
      )}
    </>
  );
}
