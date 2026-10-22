import type { AnalysisStep, StepStatus } from '../api';
import { IconCheck, IconX } from './Icons';

/** Les 3 étapes sont celles du moteur ; ce texte ne fait que préciser ce que chacune fait. */
const HINTS: Record<string, string> = {
  EXTRACTION: 'Reading the invoice and the contract, extracting charges, rates and clauses',
  RATE_LOOKUP_AND_COMPARISON: 'Matching each charge to its contractual rate and comparing the amounts',
  DETECTION: 'Checking for anomalies and for duplicate billing against invoices already received',
};

const STATUS_LABEL: Record<StepStatus, string> = {
  pending: 'Waiting',
  running: 'In progress',
  done: 'Done',
  failed: 'Failed',
};

/** Affiche exactement les étapes renvoyées par le backend : aucune progression inventée. */
export function Stepper({ steps }: { steps: AnalysisStep[] }) {
  return (
    <ol className="stepper">
      {steps.map((step, i) => (
        <li key={step.key} className={`step step--${step.status}`}>
          <span className="step__marker" aria-hidden>
            {step.status === 'done' ? <IconCheck width={14} height={14} strokeWidth={2.4} /> : null}
            {step.status === 'failed' ? <IconX width={14} height={14} strokeWidth={2.4} /> : null}
            {step.status === 'running' ? <span className="spinner spinner--sm" /> : null}
            {step.status === 'pending' ? i + 1 : null}
          </span>
          <div>
            <div className="step__title">{step.label}</div>
            <div className="step__hint muted">{HINTS[step.key] ?? ''}</div>
          </div>
          <span className="step__status">{STATUS_LABEL[step.status]}</span>
        </li>
      ))}
    </ol>
  );
}
