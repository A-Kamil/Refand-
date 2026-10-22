import { Link } from 'react-router-dom';
import type { Discrepancy } from '../api';
import { Badge, Money } from './ui';
import { IconArrowRight } from './Icons';
import { TYPE_LABEL, differenceMismatch } from '../lib/calc';

export function DiscrepancyTable({ items, caption }: { items: Discrepancy[]; caption: string }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Anomaly</th>
            <th scope="col">Invoice</th>
            <th scope="col" className="num">
              Billed
            </th>
            <th scope="col" className="num">
              Contract
            </th>
            <th scope="col" className="num">
              Difference
            </th>
            <th scope="col">Status</th>
            <th scope="col">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((d) => {
            const verified = d.status === 'VERIFIED';
            return (
              <tr key={d.id}>
                <td>
                  <Link className="table__link" to={`/discrepancies/${encodeURIComponent(d.id)}`}>
                    {TYPE_LABEL[d.type]}
                  </Link>
                  <div className="faint small">{[d.shipmentId, d.carrier].filter(Boolean).join(' · ')}</div>
                </td>
                <td className="mono">{d.invoiceNumber}</td>
                <td className="num">
                  <Money minor={d.billedAmountMinor} currency={d.currency} />
                </td>
                <td className="num">
                  {d.type === 'RATE_MISMATCH' ? <Money minor={d.expectedAmountMinor} currency={d.currency} /> : '—'}
                </td>
                <td className="num">
                  <Money minor={d.differenceMinor} currency={d.currency} tone={verified ? 'recover' : undefined} />
                  {!verified && <div className="faint small">potential — to review</div>}
                  {differenceMismatch(d) && (
                    <div className="small" style={{ color: 'var(--danger)' }}>
                      ≠ billed − expected
                    </div>
                  )}
                </td>
                <td>{verified ? <Badge tone="green">Verified</Badge> : <Badge tone="warn">Needs review</Badge>}</td>
                <td className="num">
                  <Link className="icon-link" to={`/discrepancies/${encodeURIComponent(d.id)}`} aria-label={`Investigate ${TYPE_LABEL[d.type]}`}>
                    <IconArrowRight />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
