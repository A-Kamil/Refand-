import { useEffect, useRef } from 'react';

const STEPS = [
  { title: 'Upload', text: 'Add your ocean freight invoice and the carrier contract it should follow. That is all refand needs to start.', detail: 'Invoice: PDF or CSV · Contract: PDF' },
  { title: 'Audit', text: 'refand reads both documents, pulls out every charge, and matches each one to the rate your contract actually states.', detail: 'Every line checked against its contractual rate' },
  { title: 'Detect', text: 'Where a charge is higher than the contract allows, you see the exact difference, with the invoice line and the contract clause side by side.', detail: 'Billed amount, contract amount, difference, evidence' },
  { title: 'Recover', text: 'refand drafts a claim backed by that evidence. You review it and approve it, then send it to the carrier to ask for the difference back.', detail: 'Nothing leaves without your approval' },
];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function HowItWorks() {
  const section = useRef<HTMLElement>(null);
  const track = useRef<HTMLOListElement>(null);
  const bar = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const sec = section.current;
    const trk = track.current;
    if (!sec || !trk) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return; // mise en page verticale statique (CSS)

    const panels = Array.from(trk.querySelectorAll<HTMLElement>('.how__panel'));
    const labels = Array.from(sec.querySelectorAll<HTMLElement>('.how__tick'));
    const last = panels.length - 1;
    let target = 0, smooth = 0, lastY = scrollY, speed = 1, speedTarget = 1, raf = 0;

    const measure = () => {
      const total = sec.offsetHeight - innerHeight;
      target = total > 0 ? clamp(-sec.getBoundingClientRect().top / total, 0, 1) : 0;
    };

    const frame = () => {
      smooth += (target - smooth) * 0.12; // inertie
      trk.style.transform = `translate3d(${(-smooth * last * 100).toFixed(3)}vw,0,0)`;
      panels.forEach((p, i) => {
        const d = smooth * last - i;
        p.style.setProperty('--d', d.toFixed(3));
        p.style.setProperty('--a', (1 - Math.min(Math.abs(d), 1)).toFixed(3));
      });
      labels.forEach((l, i) => l.classList.toggle('is-on', Math.abs(smooth * last - i) < 0.5));
      if (bar.current) bar.current.style.transform = `scaleX(${smooth.toFixed(4)})`;

      // les flèches accélèrent avec la vitesse de défilement
      speedTarget += (1 - speedTarget) * 0.05;
      speed += (speedTarget - speed) * 0.18;
      const rate = Math.max(1, speed);
      document.getAnimations().forEach((a) => {
        const el = (a.effect as KeyframeEffect | null)?.target as Element | null;
        if (el?.classList?.contains('how__line') || el?.classList?.contains('route')) a.updatePlaybackRate(rate);
      });

      const settled = Math.abs(target - smooth) < 0.0005 && rate < 1.01;
      raf = settled ? 0 : requestAnimationFrame(frame);
    };

    const wake = () => {
      measure();
      speedTarget = Math.min(1 + Math.abs(scrollY - lastY) / 5, 9);
      lastY = scrollY;
      if (!raf) raf = requestAnimationFrame(frame);
    };

    wake();
    addEventListener('scroll', wake, { passive: true });
    addEventListener('resize', wake);
    return () => {
      removeEventListener('scroll', wake);
      removeEventListener('resize', wake);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section className="how" id="how" ref={section} aria-labelledby="how-title" style={{ ['--n' as string]: STEPS.length }}>
      <div className="how__stage">
        <header className="how__head">
          <div className="eyebrow">How it works</div>
          <h2 id="how-title">From a freight invoice to a claim you can send.</h2>
        </header>

        <ol className="how__track" ref={track}>
          <span className="how__rail how__line" aria-hidden />
          {STEPS.map((s, i) => (
            <li key={s.title} className="how__panel">
              <span className="how__num" aria-hidden>{i + 1}</span>
              <div className="how__text">
                <h3><span className="sr-only">Step {i + 1}: </span>{s.title}</h3>
                <p>{s.text}</p>
                <span className="how__detail">{s.detail}</span>
              </div>
            </li>
          ))}
        </ol>

        <div className="how__progress" aria-hidden>
          <div className="how__bar"><span ref={bar} /></div>
          <div className="how__ticks">
            {STEPS.map((s) => <span key={s.title} className="how__tick">{s.title}</span>)}
          </div>
        </div>
      </div>
    </section>
  );
}
