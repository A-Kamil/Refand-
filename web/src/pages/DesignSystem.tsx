import { Badge, Button, Money, PageHeader, Sheet } from '../components/ui';
import { Circled, FlowArrow, MarginNote, Marker, Stamp, Underlined } from '../components/Pen';

const greens = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const inks = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

function Swatch({ token, label }: { token: string; label: string }) {
  return (
    <div className="swatch">
      <span className="swatch__chip" style={{ background: `var(${token})` }} />
      <span className="mono small">{label}</span>
    </div>
  );
}

/** Page vivante : tout ce qui est affiché ici consomme les tokens de src/styles/tokens.css. */
export function DesignSystem() {
  return (
    <>
      <PageHeader
        eyebrow="Design system"
        title="ref& — tokens & components"
        lead="Reference specimen. The written rules are in docs/DESIGN_SYSTEM.md."
      />

      <Sheet title="Brand">
        <div className="ds-brand">
          <img src="/brand/refand-logo.png" alt="ref& wordmark" width={220} />
          <img src="/brand/refand-mark.png" alt="& mark" width={72} />
          <div className="ds-brand__swatches">
            <Swatch token="--brand-mint" label="mint #82F6AD" />
            <Swatch token="--brand-gray" label="gray #707070" />
          </div>
        </div>
      </Sheet>

      <Sheet title="Colour">
        <h3 className="sheet__subhead">Green — derived from the mint</h3>
        <div className="swatches">
          {greens.map((n) => (
            <Swatch key={n} token={`--green-${n}`} label={`${n}`} />
          ))}
        </div>
        <h3 className="sheet__subhead">Ink — derived from the grey</h3>
        <div className="swatches">
          {inks.map((n) => (
            <Swatch key={n} token={`--ink-${n}`} label={`${n}`} />
          ))}
        </div>
        <h3 className="sheet__subhead">Semantic</h3>
        <div className="swatches">
          <Swatch token="--paper" label="paper" />
          <Swatch token="--sheet" label="sheet" />
          <Swatch token="--accent" label="accent" />
          <Swatch token="--recover" label="recover" />
          <Swatch token="--danger" label="danger" />
          <Swatch token="--warn" label="warn" />
        </div>
      </Sheet>

      <Sheet title="Typography">
        <div className="ds-type">
          <div>
            <div className="eyebrow">Display — Montserrat 700</div>
            <div style={{ font: '600 var(--fs-2xl)/1.2 var(--font-display)' }}>Overcharge detected</div>
          </div>
          <div>
            <div className="eyebrow">Interface — Geist</div>
            <p>Every charge on the invoice is matched to its contractual rate before a claim is drafted.</p>
          </div>
          <div>
            <div className="eyebrow">References &amp; excerpts — Geist Mono</div>
            <p className="mono">INV-2026-04817 · Schedule B, §3.1</p>
          </div>
        </div>
      </Sheet>

      <Sheet title="The route layer">
        <div className="ds-pen">
          <span>
            Ring: <Circled>
              <Money minor={1850000} currency="EUR" tone="recover" />
            </Circled>
          </span>
          <span>
            Highlight: <Underlined>Recover.</Underlined>
          </span>
          <span>
            Marker: <Marker>clause 3.1</Marker>
          </span>
          <span>
            Flow: Upload
            <FlowArrow />
            Audit
          </span>
          <span>
            <MarginNote>77% above contract</MarginNote>
          </span>
          <span>
            <Stamp>Draft</Stamp> <Stamp tone="warn">Simulated</Stamp>
          </span>
        </div>
      </Sheet>

      <Sheet title="Components">
        <div className="ds-row">
          <Button variant="primary">Primary</Button>
          <Button>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="primary" busy>
            Busy
          </Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="ds-row">
          <Badge>Neutral</Badge>
          <Badge tone="green">Detected</Badge>
          <Badge tone="warn">Needs review</Badge>
          <Badge tone="danger">Failed</Badge>
        </div>
        <table className="ledger" style={{ maxWidth: 360 }}>
          <tbody>
            <tr>
              <th scope="row">Billed</th>
              <td>
                <Money minor={4250000} currency="EUR" />
              </td>
            </tr>
            <tr>
              <th scope="row">Contract</th>
              <td className="ledger__minus">
                − <Money minor={2400000} currency="EUR" />
              </td>
            </tr>
            <tr className="ledger__total">
              <th scope="row">Overcharge</th>
              <td>
                <Money minor={1850000} currency="EUR" tone="recover" />
              </td>
            </tr>
          </tbody>
        </table>
      </Sheet>
    </>
  );
}
