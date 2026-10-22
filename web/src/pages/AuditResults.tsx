import { Navigate, useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { useAsync } from '../lib/useAsync';
import { DiscrepancyTable } from '../components/DiscrepancyTable';
import { Badge, ButtonLink, EmptyState, ErrorState, Loading, Money, PageHeader, Sheet } from '../components/ui';
import { Circled, MarginNote } from '../components/Pen';
import { ExtractionBadge } from './AnalysisProgress';
import { IconAlert, IconArrowRight } from '../components/Icons';
import { TYPE_LABEL, overchargePct } from '../lib/calc';
import { integer } from '../lib/format';

export function AuditResults() {
  const { id = '' } = useParams();
  const { state, reload } = useAsync(() => api.getAnalysis(id), [id]);

  if (state.status === 'loading') return <Loading label="Loading audit results" />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={reload} />;

  const a = state.data;
  if (a.status === 'PENDING' || a.status === 'PROCESSING') return <Navigate to={`/analyses/${encodeURIComponent(id)}`} replace />;
  if (a.status === 'FAILED')
    return (
      <Sheet>
        <EmptyState title="This analysis failed" action={<ButtonLink to="/audit/new">Start a new audit</ButtonLink>}>
          {a.error?.message ?? 'No result is available.'}
        </EmptyState>
      </Sheet>
    );

  const items = a.discrepancies;
  const currency = a.totals.currency ?? 'EUR';
  // Le récupérable vérifié et les doublons « à vérifier » ne sont JAMAIS additionnés.
  const top = items
    .filter((d) => d.claimable)
    .sort((x, y) => y.differenceMinor - x.differenceMinor)[0];
  const pct = top ? overchargePct(top) : null;
  const reviewNotes = [
    ...(a.audit?.reviewItems.map((r) => r.message) ?? []),
    ...(a.audit?.warnings ?? []),
    ...a.extractionWarnings,
  ];

  return (
    <>
      <PageHeader
        eyebrow="Audit results"
        title={items.length ? `${integer(items.length)} anomal${items.length > 1 ? 'ies' : 'y'} detected` : 'No anomaly detected'}
        lead={
          a.documents.invoice && a.documents.contract ? (
            <>
              <span className="mono">{a.documents.invoice.filename}</span> checked against{' '}
              <span className="mono">{a.documents.contract.filename}</span>
            </>
          ) : undefined
        }
        actions={
          <>
            <ExtractionBadge method={a.extractionMethod} />
            {a.status === 'NEEDS_REVIEW' ? <Badge tone="warn">Needs review</Badge> : <Badge tone="green">Completed</Badge>}
          </>
        }
      />

      {(a.status === 'NEEDS_REVIEW' || reviewNotes.length > 0) && (
        <div className="notice notice--warn" role="status">
          <IconAlert />
          <div>
            <strong>Some findings need your review before anything is claimed</strong>
            {reviewNotes.length > 0 ? (
              <ul>
                {[...new Set(reviewNotes)].map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            ) : (
              <div>
                {a.totals.potentialDuplicateMinor > 0
                  ? 'Potential duplicate billing was found; it must be confirmed against payments first.'
                  : 'The analysis service flagged this audit for human review.'}
              </div>
            )}
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <Sheet>
          <EmptyState title="Nothing to claim" action={<ButtonLink to="/audit/new">Audit another invoice</ButtonLink>}>
            Every checked charge matches the contract.
          </EmptyState>
        </Sheet>
      ) : (
        <>
          {top ? (
            <Sheet className="headline">
              <div className="headline__grid">
                <div>
                  <div className="eyebrow">{TYPE_LABEL[top.type]}</div>
                  <h2 className="headline__title">Billed above your contract</h2>
                  <p className="muted">
                    Invoice <span className="mono">{top.invoiceNumber}</span>
                    {top.carrier ? ` · ${top.carrier}` : ''}
                    {top.shipmentId ? ` · ${top.shipmentId}` : ''}
                  </p>
                </div>
                <dl className="headline__figures">
                  <div>
                    <dt>Billed</dt>
                    <dd>
                      <Money minor={top.billedAmountMinor} currency={top.currency} />
                    </dd>
                  </div>
                  <div>
                    <dt>Contract</dt>
                    <dd>
                      <Money minor={top.expectedAmountMinor} currency={top.currency} />
                    </dd>
                  </div>
                  <div className="headline__diff">
                    <dt>Verified recoverable</dt>
                    <dd>
                      <Circled delay={300}>
                        <Money minor={a.totals.verifiedRecoverableMinor} currency={currency} tone="recover" />
                      </Circled>
                    </dd>
                    {pct !== null && (
                      <div className="headline__note">
                        <MarginNote>{pct}% above the contract rate</MarginNote>
                      </div>
                    )}
                  </div>
                </dl>
              </div>
              <div className="headline__foot">
                <ButtonLink to={`/discrepancies/${encodeURIComponent(top.id)}`} variant="primary">
                  Investigate anomaly <IconArrowRight />
                </ButtonLink>
              </div>
            </Sheet>
          ) : null}

          <Sheet
            title="All anomalies"
            aside={
              <span className="faint small">
                Verified recoverable: <Money minor={a.totals.verifiedRecoverableMinor} currency={currency} tone="recover" />
                {a.totals.potentialDuplicateMinor > 0 && (
                  <>
                    {' '}
                    · Potential duplicates to review: <Money minor={a.totals.potentialDuplicateMinor} currency={currency} />
                  </>
                )}
              </span>
            }
          >
            <DiscrepancyTable items={items} caption="Detected anomalies" />
          </Sheet>
        </>
      )}
      <p className="faint small">
        <Link to="/">Back to dashboard</Link>
      </p>
    </>
  );
}
