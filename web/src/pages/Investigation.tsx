import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAsync } from '../lib/useAsync';
import type { Discrepancy, LabeledRow, SourceEvidence } from '../api';
import { Badge, ButtonLink, ErrorState, Loading, Money, PageHeader, Sheet } from '../components/ui';
import { Marker } from '../components/Pen';
import { ExtractionBadge } from './AnalysisProgress';
import { IconAlert, IconArrowLeft, IconArrowRight } from '../components/Icons';
import { TYPE_LABEL, computeDifferenceMinor, differenceMismatch } from '../lib/calc';
import { moneyMinor } from '../lib/format';

const CRITERION_LABEL: Record<string, string> = {
  CHARGE_TYPE: 'Charge type',
  CARRIER: 'Carrier',
  ROUTE: 'Route',
  CONTAINER: 'Container',
  DATE: 'Date',
  CURRENCY: 'Currency',
};

function Rows({ rows }: { rows: LabeledRow[] }) {
  const shown = rows.filter((r) => r.value);
  if (!shown.length) return <p className="faint small">No structured values provided by the backend.</p>;
  return (
    <dl className="kv">
      {shown.map((r) => (
        <div key={r.label}>
          <dt>{r.label}</dt>
          <dd>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Excerpt({ e }: { e?: SourceEvidence }) {
  if (!e) return <p className="faint small">No source excerpt provided by the backend.</p>;
  return (
    <figure className="excerpt">
      <blockquote>
        <Marker>{e.excerpt}</Marker>
      </blockquote>
      <figcaption className="small">
        <span className="mono">{e.filename}</span>
        {e.page != null && <> · p. {e.page}</>}
        {e.section && <> · clause {e.section}</>}{' '}
        {e.verified ? <Badge tone="green">Verbatim · verified</Badge> : <Badge tone="warn">Not verified</Badge>}
      </figcaption>
    </figure>
  );
}

function Ledger({ d }: { d: Discrepancy }) {
  const diff = computeDifferenceMinor(d);
  return (
    <>
      <table className="ledger">
        <tbody>
          <tr>
            <th scope="row">Billed on invoice</th>
            <td>
              <Money minor={d.billedAmountMinor} currency={d.currency} />
            </td>
          </tr>
          <tr>
            <th scope="row">Contractual amount</th>
            <td className="ledger__minus">
              − <Money minor={d.expectedAmountMinor} currency={d.currency} />
            </td>
          </tr>
          <tr className="ledger__total">
            <th scope="row">Overcharge</th>
            <td>
              <Money minor={diff} currency={d.currency} tone="recover" />
            </td>
          </tr>
        </tbody>
      </table>
      <p className="faint small sheet__foot mono">{d.calculation}</p>
    </>
  );
}

export function Investigation() {
  const { id = '' } = useParams();
  const { state, reload } = useAsync(() => api.getDiscrepancy(id), [id]);

  if (state.status === 'loading') return <Loading label="Loading anomaly" />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={reload} />;

  const d = state.data;
  const duplicate = d.type === 'DUPLICATE_BILLING';
  const criteria = d.matchCriteria ?? d.evidence.matchCriteria ?? [];
  const cr = d.contractRate;
  const line = d.invoiceLine;
  const inv = d.invoice;

  const invoiceRows: LabeledRow[] = [
    { label: 'Invoice', value: d.invoiceNumber },
    { label: 'Shipment', value: d.shipmentId ?? '' },
    { label: 'Route', value: inv?.route ?? '' },
    { label: 'Container', value: inv?.containerType ?? '' },
    { label: 'Charge', value: line?.chargeLabel ?? '' },
    { label: 'Quantity', value: line?.quantity != null ? String(line.quantity) : '' },
    { label: 'Billed amount', value: moneyMinor(d.billedAmountMinor, d.currency) },
  ];
  const contractRows: LabeledRow[] = [
    { label: 'Contract', value: cr?.contractNumber ?? '' },
    { label: 'Clause', value: cr?.source?.section ?? '' },
    { label: 'Route', value: cr?.route ?? '' },
    { label: 'Container', value: cr?.containerType ?? '' },
    { label: 'Valid', value: cr?.validFrom && cr.validTo ? `${cr.validFrom} to ${cr.validTo}` : '' },
    { label: 'Rate basis', value: cr?.rateBasis?.replace(/_/g, ' ').toLowerCase() ?? '' },
    { label: 'Contract rate', value: cr?.unitRateMinor != null ? moneyMinor(cr.unitRateMinor, d.currency) : '' },
  ];
  const prev = d.evidence.previousInvoice;
  const prevRows: LabeledRow[] = [
    { label: 'Invoice', value: prev?.invoiceNumber ?? '' },
    { label: 'Received as', value: prev?.filename ?? '' },
    { label: 'Invoice date', value: prev?.invoiceDate ?? '' },
  ];

  return (
    <>
      <Link to={`/analyses/${encodeURIComponent(d.analysisId)}/results`} className="back">
        <IconArrowLeft /> Audit results
      </Link>
      <PageHeader
        eyebrow="Anomaly investigation"
        title={TYPE_LABEL[d.type]}
        lead={
          <>
            Invoice <span className="mono">{d.invoiceNumber}</span>
            {d.carrier ? ` · ${d.carrier}` : ''}
            {d.shipmentId ? ` · ${d.shipmentId}` : ''}
          </>
        }
        actions={
          <>
            <ExtractionBadge method={d.extractionMethod ?? null} />
            {d.status === 'VERIFIED' ? <Badge tone="green">Verified</Badge> : <Badge tone="warn">Needs review</Badge>}
          </>
        }
      />

      {differenceMismatch(d) && (
        <div className="notice notice--warn" role="status">
          <IconAlert />
          <div>
            The backend reported a difference of <Money minor={d.differenceMinor} currency={d.currency} />, but billed −
            expected is <Money minor={computeDifferenceMinor(d)} currency={d.currency} />. Verify before claiming.
          </div>
        </div>
      )}

      {duplicate && (
        <div className="notice notice--warn" role="status">
          <IconAlert />
          <div>
            <strong>Potential duplicate — to review, not claimable yet.</strong> {d.explanation}
          </div>
        </div>
      )}

      <div className="split split--sides">
        <Sheet title={duplicate ? 'This invoice' : 'Invoice'} aside={<span className="eyebrow">Billed</span>}>
          <Rows rows={invoiceRows} />
          <Excerpt e={d.evidence.invoiceEvidence ?? line?.source} />
        </Sheet>
        {duplicate ? (
          <Sheet title="Already received" aside={<span className="eyebrow">Earlier</span>}>
            <Rows rows={prevRows} />
            <Excerpt e={d.evidence.previousInvoiceEvidence} />
          </Sheet>
        ) : (
          <Sheet title="Contract" aside={<span className="eyebrow">Agreed</span>}>
            <Rows rows={contractRows} />
            <Excerpt e={d.evidence.contractEvidence ?? cr?.source} />
          </Sheet>
        )}
      </div>

      {criteria.length > 0 && (
        <Sheet title="How the charge was matched to the contract">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Criterion</th>
                  <th scope="col">Invoice</th>
                  <th scope="col">Contract</th>
                </tr>
              </thead>
              <tbody>
                {criteria.map((c) => (
                  <tr key={c.criterion}>
                    <td>{CRITERION_LABEL[c.criterion] ?? c.criterion}</td>
                    <td>{c.invoiceValue}</td>
                    <td>{c.contractValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Sheet>
      )}

      <div className="split split--calc">
        <Sheet title="The calculation">
          {duplicate ? (
            <p className="mono">{d.calculation}</p>
          ) : (
            <Ledger d={d} />
          )}
        </Sheet>
        <Sheet title="Why this was flagged">
          <p className="prose">{d.explanation}</p>
          <p className="faint small sheet__foot">
            Computed from the extracted values. Check it against the source excerpts above before claiming.
          </p>
        </Sheet>
      </div>

      {d.claimable ? (
        <div className="cta-bar">
          <div>
            <strong>
              <Money minor={d.differenceMinor} currency={d.currency} tone="recover" /> can be claimed back
            </strong>
            <div className="faint small">
              refand drafts the claim from the evidence above. You review and approve it before it goes out.
            </div>
          </div>
          <ButtonLink to={`/discrepancies/${encodeURIComponent(d.id)}/claim`} variant="primary">
            {d.claimCount > 0 ? 'View recovery claim' : 'Generate recovery claim'} <IconArrowRight />
          </ButtonLink>
        </div>
      ) : (
        <div className="cta-bar">
          <div>
            <strong>No claim can be drafted for this anomaly yet</strong>
            <div className="faint small">
              Only verified contract-rate overcharges become claims. Potential duplicates must be confirmed against
              payments first.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
