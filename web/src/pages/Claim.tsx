import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type RecoveryClaim } from '../api';
import { Badge, Button, ErrorState, Loading, Money, PageHeader, Sheet } from '../components/ui';
import { Stamp } from '../components/Pen';
import { IconAlert, IconArrowLeft, IconCheck, IconCopy, IconDownload, IconRefresh } from '../components/Icons';
import { dateTime } from '../lib/format';

export function Claim() {
  const { id = '' } = useParams();
  const [claim, setClaim] = useState<RecoveryClaim | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(true);
  const [copied, setCopied] = useState(false);
  const started = useRef<string | null>(null);

  const generate = useCallback(
    (regenerate = false) => {
      setBusy(true);
      setError(null);
      api.createClaim(id, { regenerate }).then(
        (c) => {
          setClaim(c);
          setBusy(false);
        },
        (e) => {
          setError(e);
          setBusy(false);
        },
      );
    },
    [id],
  );

  // Une seule génération par arrivée sur la page (le backend renvoie la réclamation existante s'il y en a une).
  useEffect(() => {
    if (started.current === id) return;
    started.current = id;
    generate();
  }, [id, generate]);

  async function copy() {
    if (!claim) return;
    try {
      await navigator.clipboard.writeText(claim.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(new Error('Copy was blocked by the browser. Use Download instead.'));
    }
  }

  const downloadHref = claim ? api.claimDownloadUrl(claim) : null;

  return (
    <>
      <Link to={`/discrepancies/${encodeURIComponent(id)}`} className="back">
        <IconArrowLeft /> Investigation
      </Link>
      <PageHeader
        eyebrow="Recovery claim"
        title="Your claim, ready to review"
        lead="Drafted from the evidence in your documents. Review it, then send it to the carrier."
        actions={
          <>
            <Button onClick={copy} disabled={!claim}>
              {copied ? <IconCheck /> : <IconCopy />} {copied ? 'Copied' : 'Copy claim'}
            </Button>
            {downloadHref && (
              <a className="btn btn--primary" href={downloadHref} download>
                <IconDownload /> Download
              </a>
            )}
          </>
        }
      />

      {busy && (
        <Sheet>
          <Loading label="Generating an evidence-backed claim" />
        </Sheet>
      )}

      {!busy && error && !claim && (
        <Sheet>
          <ErrorState error={error} onRetry={() => generate()} />
        </Sheet>
      )}

      {claim && (
        <>
          <div className="notice notice--warn" role="note">
            <IconAlert />
            <div>
              <strong>Draft — human approval required.</strong> Review the amounts and evidence before sending this to
              the carrier.
            </div>
          </div>

          {claim.generatedBy === 'TEMPLATE' && (
            <p className="faint small" style={{ marginBottom: 'var(--sp-4)' }}>
              This draft was built from the verified facts using the standard template
              {claim.warnings.length ? ` — ${claim.warnings.join(' ')}` : '.'}
            </p>
          )}
          {error && (
            <div className="notice notice--danger" role="alert">
              <IconAlert />
              <div>{error.message}</div>
            </div>
          )}

          <article className="letter">
            <div className="letter__stamp">
              <Stamp>Draft</Stamp>
            </div>
            <dl className="letter__meta">
              <div>
                <dt>Subject</dt>
                <dd>{claim.subject}</dd>
              </div>
              <div>
                <dt>Invoice</dt>
                <dd className="mono">
                  {claim.invoiceNumber}
                  {claim.shipmentId ? ` · ${claim.shipmentId}` : ''}
                </dd>
              </div>
              <div>
                <dt>Disputed amount</dt>
                <dd>
                  <Money minor={claim.disputedAmountMinor} currency={claim.currency} tone="recover" />
                </dd>
              </div>
              <div>
                <dt>Drafted by</dt>
                <dd>
                  {claim.generatedBy === 'AI' ? <Badge tone="green">AI</Badge> : <Badge>Template</Badge>}{' '}
                  <span className="faint small">{dateTime(claim.createdAt)}</span>
                </dd>
              </div>
            </dl>

            <div className="letter__body">{claim.body}</div>

            <h3 className="letter__h">Supporting evidence</h3>
            {claim.evidence.length === 0 ? (
              <p className="faint small">The backend attached no evidence to this claim. Do not send it as is.</p>
            ) : (
              <ul className="evidence">
                {claim.evidence.map((e, i) => (
                  <li key={i}>
                    <div className="small">
                      <span className="mono">{e.filename}</span>
                      {e.page != null && <> · p. {e.page}</>}
                      {e.section && <> · clause {e.section}</>}{' '}
                      {e.verified ? <Badge tone="green">Verified</Badge> : <Badge tone="warn">Not verified</Badge>}
                    </div>
                    <blockquote>{e.excerpt}</blockquote>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <p>
            <Button variant="ghost" onClick={() => generate(true)}>
              <IconRefresh /> Regenerate
            </Button>
          </p>
        </>
      )}
    </>
  );
}
