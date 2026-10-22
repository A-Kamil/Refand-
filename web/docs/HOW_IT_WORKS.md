# « How it works » — section retirée de l'interface

Cette section a été retirée du dashboard. Tout son contenu, sa spec et son code sont conservés ici pour pouvoir la remettre (page d'accueil, landing, deck…).

## Contenu

**Eyebrow** : How it works
**Titre** : From a freight invoice to a claim you can send.

| # | Étape | Texte | Détail (puce) |
|---|---|---|---|
| 1 | **Upload** | Add your ocean freight invoice and the carrier contract it should follow. That is all refand needs to start. | Invoice: PDF or CSV · Contract: PDF |
| 2 | **Audit** | refand reads both documents, pulls out every charge, and matches each one to the rate your contract actually states. | Every line checked against its contractual rate |
| 3 | **Detect** | Where a charge is higher than the contract allows, you see the exact difference, with the invoice line and the contract clause side by side. | Billed amount, contract amount, difference, evidence |
| 4 | **Recover** | refand drafts a claim backed by that evidence. You review it and approve it, then send it to the carrier to ask for the difference back. | Nothing leaves without your approval |

Règles de wording : « refand » dans le texte (cf. [DESIGN_SYSTEM.md §0](DESIGN_SYSTEM.md)), aucune promesse de remboursement, la validation humaine est toujours dite.
Les formats de la puce 1 sont ceux de l'UI d'origine ; le backend accepte en réalité PDF, CSV ou TXT pour la facture et PDF ou TXT pour le contrat (10 Mo max).

## Comportement

Scène **épinglée** (`position: sticky`, 100 vh) : le défilement **vertical** de la page fait avancer les quatre étapes **horizontalement**, de gauche à droite.

| Élément | Comportement |
|---|---|
| Longueur de scroll | `calc(4 × 115vh)` (variable `--n` = nombre d'étapes) |
| Piste | `translate3d(-progress × 3 × 100vw)` ; la progression est lissée (inertie 0,12) |
| Étapes | Chaque étape reçoit `--d` (distance signée à l'écran) et `--a` (1 au centre, 0 loin) : le chiffre glisse à contre-courant du texte (`--d × 140px` / `−70px`), l'opacité suit `--a` |
| Chiffres | Montserrat 700, `clamp(9rem, 26vw, 23rem)`, menthe pleine (pas de contour : la police variable produit des traits parasites avec `-webkit-text-stroke`) |
| Rail | Une voie de chevrons `›` qui défile vers la droite (1 s, `background-position-x`), en bas de la scène |
| Vitesse | Pendant le scroll, la vitesse de défilement accélère les chevrons du rail et les routes du fond via `Animation.updatePlaybackRate` (jusqu'à ×9, retombée progressive) |
| Progression | Barre fine + libellés `UPLOAD · AUDIT · DETECT · RECOVER` ; le libellé de l'étape courante passe en vert |
| Mouvement réduit | Mise en page verticale statique, sans épinglage ni animation |
| Mobile (< 760 px) | Une colonne par étape (chiffre au-dessus du texte), chiffres `clamp(6rem, 34vw, 10rem)` |

### Pièges rencontrés
- Le rail est le **premier enfant** de la piste : il faut sélectionner les panneaux par classe (`.how__panel`), pas par `children`, sinon tous les indices sont décalés d'un cran.
- La grille de la scène doit déclarer `grid-template-columns: minmax(0, 1fr)`, sinon la colonne s'élargit avec la piste (400 vw) et étire barre et libellés.
- `.app` utilise `overflow-x: clip` (et non `hidden`) pour ne pas casser `position: sticky`.
- Le défilement est mesuré par `getBoundingClientRect()` sur la section ; la boucle `requestAnimationFrame` s'arrête dès que le mouvement est stabilisé.

## Remettre la section

Dashboard : ajouter `<HowItWorks />` après le hero, et un lien `<a href="#how">How it works ↓</a>` dans les actions du hero (animation `bob-down` sur la flèche).

### `src/components/HowItWorks.tsx`

```tsx
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
```

### CSS (à ajouter dans `src/styles/pages.css`)

```css
.how { position: relative; height: calc(var(--n) * 115vh); margin: var(--sp-6) calc(50% - 50vw); width: 100vw; }
.how__stage {
  position: sticky; top: 0; display: grid;
  grid-template-columns: minmax(0, 1fr); /* sans ça, la colonne s'élargit avec le rail (400vw) */
  grid-template-rows: auto 1fr auto; height: 100vh; padding: var(--sp-6) 0 var(--sp-5); overflow: hidden;
}
.how__head, .how__progress { padding: 0 max(var(--sp-5), calc(50vw - 560px)); }
.how__head h2 { margin-top: var(--sp-1); max-width: 24ch; font-size: clamp(1.4rem, 2.6vw, 2rem); letter-spacing: -0.03em; }
.how__track { position: relative; display: flex; align-items: center; width: calc(var(--n) * 100vw); margin: 0; padding: 0; list-style: none; will-change: transform; }
.how__rail {
  position: absolute; left: 0; right: 0; bottom: 4vh; height: 16px; opacity: 0.8;
  background: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='22' height='16' fill='none' stroke='%2326bd68' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M7 2l6 6-6 6'/></svg>") repeat-x left center;
  animation: flow-right 1s linear infinite;
}
@keyframes flow-right { to { background-position-x: 22px; } }
.how__panel {
  --d: 0; --a: 1;
  display: grid; grid-template-columns: minmax(0, 0.85fr) minmax(0, 1fr); align-items: center; gap: var(--sp-6);
  flex: none; width: 100vw; padding: 0 max(var(--sp-5), calc(50vw - 560px));
}
.how__num {
  font-family: var(--font-display); font-size: clamp(9rem, 26vw, 23rem); font-weight: 700; line-height: 0.9; letter-spacing: -0.06em;
  color: rgb(130 246 173 / calc(0.28 + 0.62 * var(--a)));
  transform: translateX(calc(var(--d) * 140px)) scale(calc(0.86 + 0.14 * var(--a))); transform-origin: left center;
}
.how__text { opacity: calc(0.2 + 0.8 * var(--a)); transform: translateX(calc(var(--d) * -70px)); }
.how__text h3 { font-size: clamp(2.2rem, 5vw, 4rem); letter-spacing: -0.04em; }
.how__text p { max-width: 40ch; margin-top: var(--sp-4); font-size: var(--fs-lg); color: var(--text-muted); }
.how__detail { display: inline-block; margin-top: var(--sp-5); padding: 6px 14px; border-radius: var(--radius-pill); background: var(--green-100); color: var(--green-900); font-size: var(--fs-sm); font-weight: 600; }
.how__bar { height: 3px; border-radius: var(--radius-pill); background: rgb(20 29 23 / 0.1); overflow: hidden; }
.how__bar span { display: block; height: 100%; background: var(--green-500); transform: scaleX(0); transform-origin: left; }
.how__ticks { display: flex; justify-content: space-between; margin-top: var(--sp-2); }
.how__tick { font-size: var(--fs-xs); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-faint); transition: color 400ms var(--ease-out); }
.how__tick.is-on { color: var(--green-800); }

@media (max-width: 760px) {
  .how__panel { grid-template-columns: 1fr; gap: var(--sp-3); align-content: center; }
  .how__num { font-size: clamp(6rem, 34vw, 10rem); }
  .how__text p { font-size: var(--fs-md); }
}
@media (prefers-reduced-motion: reduce) {
  .how__rail { animation: none; display: none; }
  .how { height: auto; }
  .how__stage { position: static; height: auto; overflow: visible; }
  .how__track { flex-direction: column; align-items: stretch; width: 100%; gap: var(--sp-7); padding: var(--sp-6) max(var(--sp-5), calc(50vw - 560px)); transform: none !important; }
  .how__panel { width: auto; padding: 0; }
  .how__progress { display: none; }
}
```

Le lien d'ancre du hero : `.hero__scroll { display: inline-flex; align-items: center; gap: var(--sp-2); font-size: var(--fs-sm); font-weight: 600; color: var(--text-muted); text-decoration: none; }` et `.hero__scroll svg { animation: bob-down 2s var(--ease) infinite; }` avec `@keyframes bob-down { 50% { transform: translateY(4px); } }` ; icône `IconArrowDown = make(['M12 5v14', 'M6 13l6 6 6-6'])`.
