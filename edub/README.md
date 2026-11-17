# edub/ — spécifique Edub Design

Tout ce qui n'est pas OpenPencil upstream vit ici (et dans `docs/edub/`). Lire d'abord la spec :
`docs/edub/2026-11-16-edub-design-spec.md`. Infra (chemins, ports, Authelia, build Rust) : `deploy/INFRA.md`.

```
edub/
├── portal/      Portail Next 16 / React 19 / drizzle — identité Authelia, projets, droits,
│                gate de l'éditeur, contrat « hub » pour l'hôte Rust, MCP (à venir). Port 3038.
├── deploy/      build.sh (Rust sous plafonds), ecosystem.config.cjs (PM2), conf nginx, INFRA.md
└── scripts/     deploy.sh (déploiement), init-secrets.sh (secrets manquants, idempotent)
```

## Déployer

Toujours via le script, en user `edub`, sur le clone live (après merge sur `main` + push) :

```sh
sudo -u edub bash /home/edub/apps/edub-design/edub/scripts/deploy.sh          # pull + tout
sudo -u edub bash /home/edub/apps/edub-design/edub/scripts/deploy.sh --rust   # force le build Rust
sudo -u edub bash /home/edub/apps/edub-design/edub/scripts/deploy.sh --no-pull
```

Ce qu'il fait, sous verrou `/tmp/edub-design-deploy.lock` : pull ff-only + submodules → build Rust
**seulement** si `crates/`, `vendor/`, `Cargo.*`, `rust-toolchain.toml` ou `build.sh` ont changé
(~45 min à froid, sous `flock /tmp/edub-design-build.lock` + nice + 4 jobs ; swap atomique de `dist/`)
→ portail : secrets manquants, `npm ci` si besoin, typecheck, tests, build Next dans le dossier
inactif (`.next-a`/`.next-b`), migrations, seed démo → swap (`.next-active`) + `pm2 reload`
(éditeur redémarré seulement si binaire ou ecosystem changés) → check `/api/health`, rollback du
portail si KO.

**nginx n'est pas déployé par le script** (root) : après un changement de
`deploy/nginx-design.edub.fr.conf`, en ubuntu :
`sudo cp edub/deploy/nginx-design.edub.fr.conf /etc/nginx/sites-available/design.edub.fr && sudo nginx -t && sudo systemctl reload nginx`.

## Développer le portail

```sh
cd edub/portal
npm ci
cp .env.example .env.local   # puis remplir (jamais commité ; le dépôt est public)
npm test                     # tests unitaires (droits, gate, jetons, identité, historique git)
npm run e2e                  # E2E droits + historique contre un `next dev` (voir ci-dessous)
npm run typecheck
EDUB_DESIGN_DEV_USER=patrick:design npm run dev   # impersonation, DEV UNIQUEMENT
```

`EDUB_DESIGN_DEV_USER=username[:groupe1,groupe2]` remplace les en-têtes Authelia pour tester
plusieurs comptes (bandeau jaune « DEV » sur la page). Ignoré quand `NODE_ENV=production`.
Exemples : `edub:design,admin` (Walid, voit tout), `patrick:design` (ne voit que ses projets),
`intrus:tamagofit-team` (refusé).

Migrations : modifier `lib/db/schema.ts`, puis `npm run db:generate -- --name <nom>` et committer
`drizzle/`. Elles sont appliquées par `deploy.sh` (`npm run db:migrate`).

## Tests E2E des droits (impersonation)

En dev (`NODE_ENV!=production`) l'en-tête `x-edub-dev-user: user:groupe1,groupe2` impersonne par requête
(portail **et** gate). Base jetable + faux hôte éditeur :

```sh
# .env.local de dev : base dédiée, EDUB_DESIGN_PUBLIC_ORIGIN=http://127.0.0.1:3938,
# EDUB_DESIGN_EDITOR_URL=http://127.0.0.1:3199, EDUB_DESIGN_EDITOR_DATA_DIR / _PROJECTS_DIR sous /tmp
npm run db:migrate && npx next dev -p 3938 -H 127.0.0.1 &
npm run e2e          # A owner, B viewer, C 404, groupe tamagofit-team, admin, 3 saves + restauration v1
```

## Ouvrir l'éditeur sur un fichier

`https://design.edub.fr/editor?tenant=f_<32 hex>` (lien depuis l'accueil). Le `tenant` est la colonne
`design_file.tenant_id` ; chaque appel API de l'éditeur est revérifié par le gate du portail.

## Secrets (jamais dans le dépôt)

- `edub/portal/.env.local` (600, edub) : `EDUB_DESIGN_DATABASE_URL`, `EDUB_DESIGN_TOKEN_SECRET`, chemins.
- `/home/edub/.config/edub-design/hub-internal-auth` (600) : secret partagé portail ↔ hôte Rust.
`scripts/init-secrets.sh` crée ce qui manque, ne fait jamais tourner ni n'affiche un secret existant.
