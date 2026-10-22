import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAsync } from '../lib/useAsync';
import { FileSlot, type SlotState } from '../components/FileSlot';
import { Button, PageHeader, Sheet } from '../components/ui';
import { IconAlert, IconArrowRight } from '../components/Icons';

const empty: SlotState = { status: 'empty' };

export function NewAudit() {
  const nav = useNavigate();
  const [invoice, setInvoice] = useState<SlotState>(empty);
  const [contract, setContract] = useState<SlotState>(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // La configuration réelle du serveur décide de ce qui est possible (extraction IA en direct ou non).
  const health = useAsync(() => api.getHealth(), []);
  const aiOff = health.state.status === 'ready' && !health.state.data.ai.configured;

  const filesReady = invoice.file && invoice.status !== 'error' && contract.file && contract.status !== 'error';

  async function start(run: () => Promise<{ id: string }>) {
    setBusy(true);
    setError(null);
    try {
      const a = await run();
      nav(`/analyses/${encodeURIComponent(a.id)}`);
    } catch (e) {
      setInvoice((s) => (s.status === 'uploading' ? { ...s, status: 'ready' } : s));
      setContract((s) => (s.status === 'uploading' ? { ...s, status: 'ready' } : s));
      setError(e as Error);
      setBusy(false);
    }
  }

  /** Vos documents : envoi au backend puis analyse par extraction IA en direct. */
  const analyzeUploads = () =>
    start(async () => {
      setInvoice((s) => ({ ...s, status: 'uploading' }));
      setContract((s) => ({ ...s, status: 'uploading' }));
      const up = await api.uploadDocuments({ invoice: invoice.file!, contract: contract.file! });
      setInvoice((s) => ({ ...s, status: 'uploaded' }));
      setContract((s) => ({ ...s, status: 'uploaded' }));
      return api.createAnalysis({
        invoiceDocumentId: up.invoiceDocumentId,
        contractDocumentId: up.contractDocumentId,
        extractionMode: 'AI',
      });
    });

  const network = error instanceof ApiError && error.kind === 'network';
  const aiUnavailable = error instanceof ApiError && error.code === 'AI_UNAVAILABLE';

  return (
    <>
      <PageHeader
        eyebrow="New audit"
        title="Let’s see what you’re owed"
        lead="Add a freight invoice and the contract it should follow. refand finds where you were billed above what you agreed."
      />

      <Sheet title="Your documents">
        {aiOff && (
          <div className="notice notice--warn" role="status">
            <IconAlert />
            <div>
              <strong>Document analysis is not available yet.</strong> The server has no AI extraction key configured,
              so uploaded documents can’t be analysed until one is set.
            </div>
          </div>
        )}

        <div className="slots">
          <FileSlot
            label="1 · Freight invoice"
            hint="PDF, CSV or TXT · up to 10 MB"
            accept={['.pdf', '.csv', '.txt']}
            maxMb={10}
            value={invoice}
            onChange={setInvoice}
          />
          <FileSlot
            label="2 · Pricing contract"
            hint="PDF or TXT · up to 10 MB"
            accept={['.pdf', '.txt']}
            maxMb={10}
            value={contract}
            onChange={setContract}
          />
        </div>

        {error && (
          <div className="notice notice--danger" role="alert">
            <IconAlert />
            <div>
              <strong>
                {network
                  ? 'Backend unreachable'
                  : aiUnavailable
                    ? 'Live AI extraction unavailable'
                    : 'The analysis could not start'}
              </strong>
              <div>{error.message}</div>
            </div>
          </div>
        )}

        <div className="sheet__actions">
          <Button variant="primary" disabled={!filesReady || aiOff} busy={busy} onClick={analyzeUploads}>
            {busy ? 'Starting…' : 'Analyze documents'} {!busy && <IconArrowRight />}
          </Button>
          {!filesReady && !aiOff && <span className="faint small">Add both documents to continue.</span>}
        </div>
      </Sheet>
    </>
  );
}
