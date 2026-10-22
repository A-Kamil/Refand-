import type { ReactNode } from 'react';
import { api } from '../api';
import { useAsync } from '../lib/useAsync';
import { integer, moneyCompactMinor, moneyMinor } from '../lib/format';
import { Badge, ButtonLink, EmptyState, ErrorState, Loading, Sheet } from '../components/ui';
import { Stamp, Underlined } from '../components/Pen';
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
          <ButtonLink to="/audit/new" variant="primary" className="btn--lg">
            Find out what you’re owed <IconArrowRight />
          </ButtonLink>
          <a href="#how" className="hero__scroll">
            How it works <IconArrowDown width={16} height={16} strokeWidth={2.2} />
          </a>
        </div>
        <p className="faint small hero__note">You review every claim before anything is sent.</p>
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
          {/* Portefeuille fictif — fourni par le backend, toujours étiqueté « simulated » */}
          <Sheet
            title="Enterprise portfolio"
            aside={<Stamp tone="warn">Simulated demo data</Stamp>}
            className="sheet--simulated"
          >
            {(() => {
              const p = state.data.simulatedPortfolio;
              return (
                <>
                  <div className="kpi-strip">
                    <Kpi label="Annual freight spend" value={moneyCompactMinor(p.annualFreightSpendMinor, p.currency)} />
                    <Kpi
                      label="Potentially recoverable"
                      value={moneyCompactMinor(p.potentiallyRecoverableMinor, p.currency)}
                      tone="recover"
                    />
                    <Kpi label="Invoices analyzed" value={integer(p.invoicesAnalyzed)} />
                    <Kpi label="Anomalies identified" value={integer(p.anomaliesIdentified)} />
                  </div>
                  <p className="sheet__foot faint small">{p.label}</p>
                </>
              );
            })()}
          </Sheet>

          {/* Chiffres réels, calculés par le backend depuis la base de données */}
          <Sheet
            title="Your audits"
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
                        <ButtonLink to="/audit/new" variant="primary">
                          Find out what you’re owed
                        </ButtonLink>
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
