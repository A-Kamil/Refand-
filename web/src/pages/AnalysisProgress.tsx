import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, type Analysis } from '../api';
import { Stepper } from '../components/Stepper';
import { Badge, Button, ButtonLink, ErrorState, PageHeader, Sheet } from '../components/ui';
import { IconAlert } from '../components/Icons';

const POLL_MS = 1000; // le backend recommande ~1 s
const MAX_POLL_ERRORS = 4;

export function ExtractionBadge({ method }: { method: Analysis['extractionMethod'] }) {
  if (method === 'FIXTURE') return <Badge tone="warn">Demo documents · pre-built extraction</Badge>;
  if (method === 'AI') return <Badge tone="green">Live AI extraction</Badge>;
  return null;
}

export function AnalysisProgress() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [fatal, setFatal] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);
  const errors = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    errors.current = 0;
    setFatal(null);

    async function tick() {
      try {
        const a = await api.getAnalysis(id);
        if (cancelled) return;
        errors.current = 0;
        setAnalysis(a);
        if (a.status === 'COMPLETED' || a.status === 'NEEDS_REVIEW') {
          // Courte pause pour laisser voir la dernière étape validée.
          timer = setTimeout(
            () => !cancelled && nav(`/analyses/${encodeURIComponent(id)}/results`, { replace: true }),
            700,
          );
          return;
        }
        if (a.status === 'FAILED') return;
        timer = setTimeout(tick, POLL_MS);
      } catch (e) {
        if (cancelled) return;
        // Une coupure ponctuelle ne fait pas échouer l'analyse : on réessaie quelques fois.
        if (++errors.current >= MAX_POLL_ERRORS) setFatal(e as Error);
        else timer = setTimeout(tick, POLL_MS);
      }
    }
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, nav, attempt]);

  const inv = analysis?.documents.invoice;
  const con = analysis?.documents.contract;

  return (
    <>
      <PageHeader
        eyebrow="Analysis"
        title="Auditing your documents"
        lead={
          inv && con ? (
            <>
              <span className="mono">{inv.filename}</span> against <span className="mono">{con.filename}</span>
            </>
          ) : (
            'Each stage below is reported by the analysis service as it happens.'
          )
        }
        actions={analysis ? <ExtractionBadge method={analysis.extractionMethod} /> : null}
      />

      {fatal ? (
        <Sheet>
          <ErrorState
            error={fatal}
            onRetry={() => setAttempt((n) => n + 1)}
            extra={
              <ButtonLink to="/audit/new" variant="ghost">
                Back to upload
              </ButtonLink>
            }
          />
        </Sheet>
      ) : (
        <Sheet title="Processing stages">
          {analysis ? (
            <Stepper steps={analysis.steps} />
          ) : (
            <p className="faint small">Contacting the analysis service…</p>
          )}

          {analysis?.status === 'FAILED' && (
            <div className="notice notice--danger" role="alert">
              <IconAlert />
              <div>
                <strong>The analysis failed</strong>
                <div>{analysis.error?.message ?? 'The service did not provide a reason.'}</div>
                <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
                  <ButtonLink to="/audit/new" variant="secondary">
                    Try other documents
                  </ButtonLink>
                  <Button variant="ghost" onClick={() => setAttempt((n) => n + 1)}>
                    Refresh status
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Sheet>
      )}
    </>
  );
}
