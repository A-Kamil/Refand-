# FreightRecover AI — Backend : lancement et déploiement Aiven

Backend TypeScript / Fastify (`api/`) qui branche le moteur (`src/`, Dev 2) sur Aiven for PostgreSQL.
Contrat d'API pour le frontend : voir [API.md](API.md).

## Services sponsors utilisés

| Service | Statut | Usage |
|---|---|---|
| **Aiven for PostgreSQL** | Utilisé | Documents (fichier original en `bytea` + texte par page), analyses, contrats, tarifs, factures, lignes, anomalies, réclamations. Le contrôle des doublons interroge l'historique stocké. |
| **Aiven Runtime** | Prêt (`Dockerfile` + `compose.aiven.yaml`) | Build depuis GitHub, `DATABASE_URL` injectée par l'intégration PostgreSQL. |
| **Anthropic (Claude)** | Utilisé si `ANTHROPIC_API_KEY` est définie | Extraction documentaire et rédaction des réclamations. Calculs et matching déterministes. |
| Aiven OpenSearch | Non utilisé | P2, non implémenté. |
| Iterate | Non utilisé | Pas d'intégration. |

## Lancement local

```bash
npm install
docker compose up --build        # API (:8080) + PostgreSQL (:55432), lit ANTHROPIC_API_KEY depuis .env
# ou, sans Docker pour l'API :
cp .env.example .env              # renseigner DATABASE_URL (Aiven ou local) et ANTHROPIC_API_KEY
npm run db:check                  # SELECT 1 + version + TLS
npm run db:seed                   # migrations + documents de démo + historique de factures (idempotent)
npm run dev                       # http://localhost:8080/health
```

Tests : `npm test` (moteur). Les tests d'intégration de l'API tournent sur un vrai PostgreSQL, dans un schéma jetable :
`TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/freightrecover npm test`.

Au démarrage, le serveur : vérifie la DB (`SELECT 1`), applique les migrations (`MIGRATE_ON_START`), passe en `FAILED` les analyses interrompues par un redémarrage, puis insère les données de démo (`SEED_ON_START`).

## Variables d'environnement

| Variable | Obligatoire | Description |
|---|---|---|
| `DATABASE_URL` | oui | URI du service Aiven PostgreSQL (`...?sslmode=require`). Injectée automatiquement sur Aiven Runtime. |
| `ANTHROPIC_API_KEY` | pour le mode IA | **Secret**, côté serveur uniquement. Sans elle : `extractionMode: "FIXTURE"` sur les documents de démo, réclamations en `TEMPLATE`. |
| `DATABASE_CA_CERT` | non | CA du projet Aiven (PEM). Si elle est définie, le certificat serveur est vérifié. Sinon la connexion est chiffrée (TLS) sans vérification du certificat, comme `sslmode=require` avec libpq. |
| `CORS_ORIGINS` | non | Origines en plus, séparées par des virgules, wildcards `*` acceptés. Autorisées par défaut : `localhost`, `*.lovable.app`, `*.lovableproject.com`, `*.lovable.dev`. |
| `PORT` | non | 8080 par défaut. |
| `FREIGHTRECOVER_AI_MODEL`, `FREIGHTRECOVER_AI_EFFORT` | non | Voir INTEGRATION.md. |

## Déploiement sur Aiven Runtime

Prérequis : être admin de l'organisation Aiven et avoir accès au repo GitHub (`A-Kamil/Refand-`), qui doit être poussé avec ce code.

1. Aiven Console → projet → **Runtime** → **Deploy application** → connecter GitHub.
2. Choisir le repo, la branche (`dev1/api` ou la branche fusionnée), puis le manifeste **`compose.aiven.yaml`** → **Scan**.
   Runtime détecte l'app `api` (build du `Dockerfile`, port 8080) et un service PostgreSQL `freightrecover-pg` intégré.
   Pour réutiliser un service PostgreSQL existant, connecte-le à l'app avec **Connect service** (variable `DATABASE_URL`).
3. **Deploy**.
4. App → **Overview** → **Environment variables** → **Edit** → ajouter `ANTHROPIC_API_KEY`, cocher **Secret** → **Save** (redéploie).
   Si besoin : `CORS_ORIGINS=https://<ton-app>.lovable.app`.
5. Vérifier : `curl https://<url-publique>/health` doit répondre `"status":"ok"` et `"db":{"ok":true,...,"tls":true}`.
6. Un push ne redéploie pas tout seul : **Actions** → **Deploy latest commit**.

Plan B si Runtime n'est pas accessible : créer seulement **Aiven for PostgreSQL** (Console → Create service → PostgreSQL), copier la *Service URI* dans `DATABASE_URL`, puis lancer l'image Docker de ce repo sur n'importe quel hébergeur.

## Vérification du parcours (backend déployé)

```bash
API=https://<url-publique>
curl -s $API/health
curl -s "$API/api/documents?demo=true"                       # documents de démo pré-chargés
# Mode IA (clé requise) sur les PDF de démo :
curl -s -XPOST $API/api/analyses -H 'content-type: application/json' \
  -d '{"invoiceDocumentId":"00000000-0000-4000-8000-000000000001","contractDocumentId":"00000000-0000-4000-8000-000000000002","wait":true}'
# Hors ligne, explicitement étiqueté FIXTURE : ajouter "extractionMode":"FIXTURE"
curl -s "$API/api/discrepancies?type=RATE_MISMATCH"
curl -s -XPOST $API/api/discrepancies/<id>/claim
curl -s $API/api/dashboard
```

Résultat attendu : `RATE_MISMATCH` `VERIFIED`, `differenceMinor: 1850000` (`EUR 42,500.00 − (EUR 24,000.00 × 1) = EUR 18,500.00`), clause 4.2.1 page 2.

## Sécurité

- Aucun secret dans le repo : `.env*` est ignoré (sauf `.env.example`, sans valeurs réelles). La clé IA ne quitte jamais le serveur et n'apparaît dans aucune réponse.
- `/health` indique seulement si l'IA est configurée (`ai.configured`), jamais la clé.
- Uploads limités à 10 Mo et 4 fichiers. Formats PDF, CSV et TXT. Les PDF scannés sont refusés.
