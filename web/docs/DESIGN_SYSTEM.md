# refand — Design system (v3 « Sky & Route »)

> Un ciel clair traversé de routes maritimes. Le contenu est posé directement dessus, sans cartes. Les flèches vont toujours vers l'avant : le produit vous aide à avancer, jusqu'au remboursement.

Règle écrite (le design system vit dans la doc, pas dans l'app). Les valeurs vivent à un seul endroit : [`src/styles/tokens.css`](../src/styles/tokens.css).

---

## 0. Nommage

| Où | Écriture |
|---|---|
| **Textes** (phrases, descriptions, boutons, e-mails) | **refand** |
| **Logo et slogans** | **ref&** |

Exemples : « *refand* checks every freight invoice… » (texte) ; « *ref&* helps you get what's yours » (slogan en pied de page) ; le « & » dans la barre de navigation (logo). Le nom du backend (« FreightRecover AI ») n'apparaît pas dans l'interface, sauf quand il est cité tel quel par l'API (`live.label`).

---

## 1. Principe directeur

| Idée | Traduction UI |
|---|---|
| **Cloudy** — aérien, clair | Fond « ciel » : dégradé menthe/blanc, deux nuages doux qui dérivent |
| **Shipment** — trajet, direction | Routes pointillées animées dans le fond, flèches de fret, rail de chevrons qui avance |
| **Productif** | Aucune carte, aucune sidebar : filets, titres, tableaux et chiffres posés sur le fond |

### Toujours vers l'avant
- Toute flèche va vers l'avant (→). Jamais de flèche arrière, sauf le lien « retour » d'une page de détail.
- Le message : **refand vous aide à récupérer ce qui vous revient**. On vérifie vos factures contre votre contrat, on repère ce qui a été facturé au-dessus, on prépare la réclamation. **Vous la validez.**

### Vérité d'abord (wording)
- Autorisé : « money you may not know you've lost », « can be claimed back », « Verified recoverable », « Potential to review ».
- **Interdit** : « guaranteed », « you will receive », « get your money back » comme promesse.
- Vocabulaire repris du backend : **anomalies**, **verified**, **needs review**, **contract rate overcharge**, **duplicate billing**, **potential duplicate**. Si le backend signale une extraction `FIXTURE` (pré-construite), elle n'est **jamais** présentée comme une extraction IA en direct : un badge l'indique.

### À éviter
- cartes, panneaux en verre, ombres de boîte, glow, halos ;
- sidebar, barre de navigation avec fond ;
- animation qui cache une donnée : un chiffre clé n'est jamais invisible, même un instant.

---

## 2. Couleur

Deux couleurs de marque, extraites de `logo1.png` / `logo2.png` : `--brand-mint #82F6AD` (le « & »), `--brand-gray #707070` (le wordmark).
**Échelle verte** `--green-50 … 950` (menthe = palier 300) et **neutres** `--ink-50 … 900` (palier 500 = `#707070`).

| Usage | Token |
|---|---|
| Aplat de marque (CTA, barre d'accent) | `--green-300` |
| Flèches, routes, bordures | `--green-400/500` |
| **Texte vert** sur clair (5,5:1) : montants récupérables | `--green-700` |
| Fond léger (puces) | `--green-100` |

> La menthe seule ne se lit pas en texte sur fond clair : elle sert d'aplat, avec du texte sombre dessus.

Sémantique : `--recover` (argent récupéré), `--warn` (à vérifier / attention), `--danger` (erreur).

---

## 3. Typographie

Auto-hébergée (`@fontsource`). **Montserrat** (titres, chiffres clés, proche du wordmark, tracking −0,03 à −0,045 em) · **Geist** (interface) · **Geist Mono** (références, extraits). Chiffres tabulaires sur `.money`, `.table`, `.ledger`, `.kpi__value`.
Hero : `clamp(2.6rem, 7vw, 5.4rem)`.

---

## 4. Mise en page : tout est posé sur le fond

- **Sheet** = une section, pas une carte : un filet noir 1,5 px en haut, un titre, le contenu.
- **Tableaux** : en-têtes en petites capitales, filets fins, montants alignés à droite.
- **Document** : seule la lettre de réclamation est une « feuille » (c'est un vrai document à relire), avec une marge verte et le tampon DRAFT.
- Contenu ≤ 1120 px, centré. Rayons : `--radius-sm 8`, `--radius 12`, pilule pour boutons et badges.

### Bouton d'appel à l'action (« route »)
Le CTA principal du dashboard (`.cta-route`) n'est pas un bouton plein : c'est le **texte**, une **route pointillée qui avance** vers la droite, et une **pointe de flèche ronde** menthe. Au survol, la route s'allonge, accélère, et la pointe glisse vers l'avant. Les boutons de formulaire (`Analyze documents`, `Copy claim`…) restent des pilules plates (`.btn`).

### Barre de navigation
Aucun fond, aucune bordure, pas collante. De gauche à droite : le « & » (logo 1), deux liens en texte simple (Dashboard, New audit), un lien « Start an audit → ». Le lien actif a un trait menthe qui se déploie de gauche à droite ; au survol il se déploie à 35 %. Le logo pivote légèrement au survol.

---

## 5. Le fond vivant (`<Sky />`)

[`Sky.tsx`](../src/components/Sky.tsx) · [`sky.css`](../src/styles/sky.css). Volontairement simple :
1. dégradé de ciel menthe → blanc ;
2. deux nuages doux (dégradés radiaux, `transform` seul) ;
3. trois routes SVG pointillées qui avancent (`dasharray 3 11` + `dashoffset −14`) ;
4. des ports qui émettent une onde ;
5. des pointes de flèche qui suivent chaque route (`<animateMotion>`).

Pas de halo, pas de grain, pas de suivi du curseur. Tout est `aria-hidden`, `pointer-events: none`, et coupé sous `prefers-reduced-motion`.

---

## 6. Le flow « How it works » (widget à défilement horizontal)

Sous le hero du dashboard : une scène épinglée où le défilement **vertical** fait avancer les quatre étapes (Upload → Audit → Detect → Recover) **horizontalement**, de gauche à droite. Le rail de chevrons accélère avec la vitesse de scroll. Contenu, spec, pièges et code complet : [`HOW_IT_WORKS.md`](HOW_IT_WORKS.md).

## 7. Mouvement

1. **Direction** : chaque écran entre de gauche à droite (36 px), décélération longue (`--ease-out`), cascade de 70 ms.
2. **Ressort** léger (`--spring`) pour ce qui répond au pointeur.
3. **Jamais caché** : une animation d'entrée démarre à 35 % d'opacité, pas à 0.
4. Tout est coupé sous `prefers-reduced-motion`.

---

## 8. Couche « route » (repères)

[`Pen.tsx`](../src/components/Pen.tsx) : `<FlowArrow>`, `<Circled>` (anneau pulsé : **un seul** par écran, le montant récupérable vérifié), `<Underlined>`, `<Marker>` (preuve surlignée), `<MarginNote>` (puce fléchée, texte **calculé**), `<Stamp>` (`DRAFT`).
Ces éléments n'apportent jamais d'information absente des données.

---

## 9. Intégrité des données

- **Aucune donnée fictive dans l'interface** : le dashboard n'affiche que les chiffres réels du backend (`live`). Tant qu'aucun audit n'a été lancé, il affiche un état vide qui invite à en lancer un.
- **Récupérable vérifié** (`RATE_MISMATCH`, `VERIFIED`) et **doublons à vérifier** (`DUPLICATE_BILLING`, `NEEDS_REVIEW`) ne sont **jamais additionnés**.
- **Montants** : entiers en centimes (`1850000` = 18 500,00 €), formatés par `moneyMinor`. L'écart est **recalculé** (`facturé − attendu`) ; toute incohérence avec le backend s'affiche.
- **Pas de mode démo** : le front ne parle qu'au backend et n'embarque aucune donnée d'exemple.
- Aucune preuve ni clause inventée ; chaque extrait indique s'il est **verbatim · verified**.

---

## 10. Ajouter / modifier

1. Couleur, espace, rayon → `tokens.css` uniquement.
2. Pas de carte : une nouvelle zone est une `Sheet` (filet + titre).
3. Nouvelle animation → transform/opacity seulement, couper sous `prefers-reduced-motion`, ne jamais masquer une donnée.
4. Vérifier : focus visible, contraste ≥ 4,5:1, rendu à 420 px, mouvement réduit.
