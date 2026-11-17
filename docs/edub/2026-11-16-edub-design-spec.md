# Edub Design — spec d'architecture (ED_1728)

> À lire en premier par tout ticket Edub Design. Infra (chemins, ports, Authelia, build) : `edub/deploy/INFRA.md`.
> Exploitation (déployer, tester, impersonation) : `edub/README.md`.

## 1. Vision

`https://design.edub.fr` est le « Figma perso » de Walid, fork d'OpenPencil (`wawkadura/edub-design`, remote `upstream` = `ZSeven-W/openpencil`). Trois besoins :

1. **Lieu commun** de design pour toutes les apps (TamaFit, GolfN, Edub Games, Edub Dev…) : des projets, beaucoup d'écrans par projet. Remplacera `tamafit-app/docs/designs` (41 dossiers, 300 maquettes HTML, 621 PNG).
2. **MCP pour tous les agents** : lire et écrire les designs et les écrans.
3. **Personnes extérieures** (Patrick, équipe TamaFit) : accès **uniquement** aux projets que Walid leur ouvre.

## 2. Ce que l'exploration a montré (upstream, état au fork)

- **L'hôte web sait déjà être multi-tenant** : `op-host-web-server --serve-web <port> --online` (`crates/op-host-services/src/web_canvas_server/online_*.rs`, `tenant*.rs`). Chaque requête porte une identité **vérifiée** ; l'hôte garde **un document par tenant** (mémoire + `OPENPENCIL_ONLINE_DATA_DIR/<sha256(tenant)[..16]>/current.op`, écrit à l'éviction et à l'arrêt), un flux SSE par tenant, un MCP par tenant (`POST /mcp?tenant=…`, 159 outils). Les routes dangereuses en multi-comptes (fichiers locaux `/api/file/*`, login device `/api/auth/*`, persistance des réglages, import de site, relai de collab, alias JSON-RPC sur `/`, shutdown générique) sont **refusées par l'hôte lui-même** en mode online (`online_policy.rs`).
- **L'identité est déléguée à un « hub »** (`hub_auth_client.rs`, `hub_verifier.rs`) : `OPENPENCIL_HUB_BASE_URL` + secret interne. Contrat : `POST /api/v1/tokens/introspect` (`X-OP-Internal-Auth`, corps `{"token"}` → `{active,user_id,username,scopes,expires_at_unix}`), `GET /api/v1/session` (cookie `op_hub_session`). `user_id` **est la clé du tenant**.
- **Partage upstream** : `?tenant=<owner>` + ACL par propriétaire (`/api/share/*`). Un tenant = le document unique d'un compte : pas de notion de projets ni de fichiers multiples, pas de rôle lecteur. Insuffisant pour le besoin 1 et 3 tel quel.
- **Ce qui sort vers l'extérieur** : en online, aucun appel sortant n'est fait au nom du serveur hors IA. L'IA du chat est en « apporte ta clé » : la clé reste dans le navigateur, l'hôte relaie la requête vers le fournisseur choisi (filtre d'endpoints publics) ; les modèles hébergés (op-hub), les agents CLI (Claude Code, Codex…) et le relai de collaboration public sont **indisponibles en online**. Pas de télémétrie trouvée dans l'hôte web ni le bundle. Le login cloud (device login) est refusé en online.
- **Limite connue upstream** : en online, le registre global des vignettes d'images embarquées n'est pas alimenté (`allows_image_thumb_registry`). Les images de la démo (remplissages par URL) s'affichent bien ; à revérifier quand on importera les écrans PNG (voir §9).

## 3. Architecture retenue

**Zéro patch du cœur Rust.** On utilise l'hôte en mode `--online` tel quel, et le portail Edub joue le rôle du hub. L'astuce : **le tenant de l'éditeur est un fichier de design, pas un utilisateur.**

```
navigateur ──https──▶ nginx design.edub.fr
   │  /, /_next, /api/health, /api/edub/*   ── Authelia ──▶ portail Next 127.0.0.1:3038
   │  /editor, /pkg/*, /canvaskit/*         ── Authelia ──▶ éditeur Rust 127.0.0.1:3100 (statique)
   │  /api/* (le reste)  ── auth_request ─▶ portail /api/edub/editor-gate
   │                        (session Authelia + groupe + droit sur ?tenant=)
   │                        200 + X-Edub-Editor-Token ─▶ nginx injecte Authorization: Bearer
   │                     ─────────────────────────────▶ éditeur Rust (--online)
   │                                                        │ introspection du Bearer
   │                                                        ▼
   │                                          portail /api/v1/tokens/introspect (loopback)
   │                                          → user_id = f_<fichier>, username = humain
   │  /mcp               ── sans Authelia ──▶ portail (Bearer agent ; ticket MCP)
```

Pourquoi c'est le plus simple qui tienne les 3 besoins :

- **Besoin 1** : un fichier = un tenant `f_<32 hex>`. Autant de fichiers que voulu, rangés en projets dans Postgres (portail). Le stockage, la sérialisation `.op`, le SSE et la synchro sont ceux de l'upstream.
- **Besoin 2** : l'hôte expose déjà un MCP complet **par tenant**. Le portail (`/mcp` public) authentifiera l'agent puis relaiera vers `POST http://127.0.0.1:3100/mcp?tenant=f_…` avec un Bearer fichier : les écritures d'un agent apparaissent **en direct** dans les onglets ouverts (même document en mémoire, même SSE). Rien à réécrire.
- **Besoin 3** : le droit est vérifié **par le portail à chaque appel** de l'éditeur (gate nginx). Retirer un droit coupe l'accès immédiatement, sans synchroniser d'ACL dans l'hôte ; les ACL upstream (`/api/share/*`) sont fermées.
- Alternative écartée : proxy de toute l'API éditeur à travers Next (charge Node, SSE, corps de 50 Mo) ; une instance d'éditeur par fichier (mémoire) ; patcher l'hôte pour lire les droits (diverge de l'upstream).

### Garanties de sécurité

- L'éditeur écoute en **loopback seulement** ; ni `/mcp` ni `/api/share/*` ni `/api/v1/*` de l'éditeur ne sont joignables de l'extérieur.
- Le Bearer est **minté par le gate**, jamais présenté par le navigateur : nginx écrase `Authorization` et supprime `Cookie` vers l'éditeur. Jeton `edt1.<claims>.<hmac>` (secret `EDUB_DESIGN_TOKEN_SECRET`), claims `{t: tenant, u: username, e: exp}`, TTL 10 min (l'hôte met l'introspection en cache ≤ 5 min).
- Le tenant servi est `?tenant=` (premier paramètre, sans décodage, même règle des deux côtés) ; l'identité introspectée vaut ce même tenant. Si les deux divergeaient, l'hôte retomberait sur son ACL (vide) → refus.
- **CSRF** : le Bearer étant injecté par nginx, le contrôle d'origine cookie de l'hôte ne joue plus ; le gate exige donc `Origin: https://design.edub.fr` pour toute méthode autre que GET/HEAD.
- Le gate revérifie la session Authelia lui-même (appel loopback à `127.0.0.1:9091/api/authz/auth-request` avec le cookie), cache positif 15 s : nginx ne peut pas enchaîner deux `auth_request` sur une même location.

### Ouverture de l'éditeur

- Lien du portail : `/editor?tenant=f_…`. Le shell wasm ajoute ce `tenant` à chacun de ses appels `/api/*` (`op-host-web/src/daemon_base.rs`).
- L'accueil du portail pré-remplit, **si absents**, les réglages locaux de l'éditeur (`localStorage['openpencil-rust-web-settings::anon']`, `app/editor-defaults.tsx`) : interface en français, ouverture directe sur le canevas (sinon : Studio Home en chinois). Un choix fait ensuite dans l'éditeur n'est jamais écrasé.
- Bruit attendu dans la console : `GET /api/auth/status` → 403 (login device fermé ; l'éditeur reste en compte anonyme local, sans effet).

## 4. Modèle de droits (ED_1729)

Tables (`edub/portal/lib/db/schema.ts`, migrations `edub/portal/drizzle/`) :

- `user` : miroir upserté de l'identité Authelia. Aucune donnée d'authentification.
- `project` : slug (immuable), nom, emoji, couleur, description, `archived`, `created_by`.
- `project_member(project_id, principal_kind 'user'|'group', principal, role)` : `principal` = `Remote-User` ou un groupe de `Remote-Groups` (ex. `tamagofit-team`), `role ∈ owner | editor | viewer`. Un utilisateur n'a pas besoin d'exister dans `user` pour être invité.
- `folder` (arbre par projet), `design_file` (`project_id`, `folder_id`, `name`, `tenant_id` `f_<32 hex>`, `trashed_at`, `screen_count`), `activity` (journal).

Règles (fonction pure `lib/rights.ts`, testée) :

- Entrer sur le site : groupe Authelia `design` ou `admin`.
- `admin` (Walid) : `owner` de tout. Sinon rôle effectif = **le plus fort** entre la ligne de l'utilisateur et les lignes de ses groupes ; aucune ligne → **aucun droit**.
- **Aucun droit ⇒ 404**, identique à un projet inexistant (API portail, pages, API éditeur, page `/editor`). Le gate répond 403 + `X-Edub-Gate-Reason` (nginx `auth_request` ne connaît que 401/403) et `@edub_editor_403` traduit `no-access-to-file` / `missing-or-invalid-tenant` en 404 ; lecture seule / CSRF / route fermée restent des 403.
- `viewer` : lit (liste, historique, ouverture de l'éditeur), n'écrit rien (gate : toute écriture refusée ; API portail 403). `editor` : fichiers, dossiers, versions, corbeille. `owner` : + partage, renommer/archiver le projet. **Créer un projet : admin seulement** (le créateur en devient owner). Le dernier owner d'un projet ne peut pas être retiré.
- La page `/editor` passe par le même gate (nginx) : un fichier sans droit répond 404, sans session → login Authelia.

### Historique (git par projet)

`data/projects/<slug>/` est un dépôt git ; un fichier = `<id>.op`, **un commit par enregistrement**, auteur = l'utilisateur Authelia (`user <user@design.edub.fr>`). Le portail tire le document de l'hôte (`GET /api/mcp/document?tenant=`, Bearer fichier) et le commit : (1) ~20 s après la dernière écriture de l'éditeur (le gate programme un snapshot débouncé sur toute écriture `/api/mcp/*`), (2) « Enregistrer une version maintenant », (3) avant restauration / duplication / mise à la corbeille. Pas de commit si rien n'a changé. **Restaurer** = pousser l'ancienne version dans l'hôte (`POST /api/mcp/document`, les onglets ouverts suivent par SSE) + nouveau commit : l'historique n'est jamais réécrit. Vignettes : PNG de la page active via `POST /api/export/raster` de l'hôte, cache `data/projects/.thumbs/`. Corbeille : 30 jours (purge paresseuse à l'ouverture du projet ; l'historique git est conservé).

## 5. API du portail

| Route | Accès | Rôle |
|---|---|---|
| `GET /` , `/p/<slug>`, `/p/<slug>/activity` | Authelia | « Mes projets », page projet (dossiers, fichiers, corbeille `?trash=1`), journal |
| `GET/POST /api/edub/projects` | Authelia | projets visibles / création (admin) |
| `GET/PATCH/DELETE /api/edub/projects/<slug>` | membre / owner | détail ; modifier, archiver |
| `GET/POST/DELETE /api/edub/projects/<slug>/members` | owner | partage `{kind,principal,role}` |
| `GET /…/activity`, `POST /…/files` (JSON ou multipart `.op/.pen/.fig`), `POST/PATCH/DELETE /…/folders` | membre / editor | journal, nouveau fichier / import, dossiers |
| `GET/PATCH/DELETE /api/edub/files/<id>`, `POST …/duplicate` | membre / editor | métadonnées, renommer/déplacer/restaurer, corbeille |
| `GET/POST /api/edub/files/<id>/versions`, `POST …/restore`, `GET …/thumbnail` | membre / editor | historique git, version manuelle, restauration, PNG |
| `GET /api/health` | Authelia (et loopback pour deploy.sh) | `{ok, db, editor}` ; 503 si l'un est KO |
| `GET /api/edub/editor-gate` | interne nginx uniquement | décision gate (§3), `X-Edub-Editor-Token` |
| `POST /api/v1/tokens/introspect` | loopback + `X-OP-Internal-Auth` | contrat hub pour l'hôte Rust |
| `GET /api/v1/session` | loopback | contrat hub, toujours 401 |
| `GET/POST /mcp` | public, Bearer | **réservé** : 401 tant que le MCP agents n'est pas livré |

Les routes métier futures du portail vivent sous `/api/edub/*` (`/api/*` hors exceptions part à l'éditeur).

## 5 bis. Galerie d'écrans (ED_1731)

Par projet, onglet **Écrans** (`/p/<slug>/screens`). Mêmes rôles que le projet : viewer lit (et commente), editor/owner écrit, non-membre = 404 partout (images comprises).

- **Modèle** (migration `0002_screens_gallery`) : `screen_section` (arbre à 1 niveau, `position`), `screen` (titre, section, `platform` ios|android|web|watch|desktop|email|autre, `type` capture|maquette-html|design, tags, description markdown, `status` proposé|validé|en prod|obsolète, `links` typés, `tickets` = `ED_xxxx` indexés, auteur user/agent), `screen_version` (chaque upload = une version, historique conservé), `screen_comment` (markdown, mentions, épingle x/y 0..1). Les enums sont du `text` validé par `lib/screens-model.ts` (ajouter une valeur = pas de migration).
- **Disque** : `data/projects/<slug>/screens/<screenId>/v<n>.<ext>` + `v<n>.thumb.webp` (480 px, sharp). Le type est détecté sur le **contenu** (sharp), jamais sur le mime annoncé ; SVG refusé (script). Vignettes HTML : Chrome headless (`playwright-core`, `/usr/bin/google-chrome`, surcharge `EDUB_DESIGN_CHROME`), **JavaScript coupé et réseau bloqué**, 2 rendus max en parallèle, régénérées à la demande si absentes.
- **Maquettes HTML = non fiables.** Servies par la route de fichier avec `Content-Security-Policy: sandbox allow-scripts; default-src 'none'; connect-src 'none'; …` (sans `allow-same-origin` : origine opaque, ni cookie, ni accès au portail, même ouverte directement) et affichées dans `<iframe sandbox="allow-scripts">`. Testé : `npm run e2e:sandbox`.
- **API** (préfixe réel `/api/edub/projects/:slug/…`, comme le reste du portail) :
  `GET/POST screens` (filtres `q platform status tag ticket section(id|none) type sort page pageSize`), `GET/PATCH/DELETE screens/:id`, `POST screens/:id/versions`, `GET screens/:id/versions/:n|current/file|thumb`, `GET/POST screens/:id/comments`, `DELETE …/comments/:cid`, `GET/POST sections`, `PATCH/DELETE sections/:id` (`move: up|down`).
  Écriture en **multipart** (`file` + champs) **ou JSON base64** (`filename`, `contentBase64`, `mime?`, `agent?`). Écran `design` : JSON `{type:"design", designFileId, frameId?}` (sans fichier ni version).
- **UI** : grille paginée (60/page, vignettes lazy, `content-visibility`), filtres dans l'URL, lightbox (←/→, swipe, Esc, geste retour), upload glisser-déposer / coller / galerie mobile, détail (versions, commentaires épinglés, liens tickets → `https://dev.edub.fr/?todo=ED_xxxx`), partage = lien `/p/<slug>/screens/<id>` (membres seulement), comparaison côte à côte / curseur / différences (`mix-blend-mode: difference`).
- **Pas fait ici** : import TamaFit (ticket suivant), outils MCP (ticket MCP), notification des @mentions (journal d'activité seulement), rendu d'un frame `.op` pour les écrans `design` (lien seulement).

## 5 ter. Import de `tamafit-app/docs/designs` (ED_1733)

`bash edub/scripts/import-tamafit-designs.sh` (relançable, clé d'idempotence = chemin source stocké dans `screen.source_key`) :
snapshot **en lecture seule** du dossier source (le user `edub` ne lit pas le dépôt TamaFit) + dates du dernier commit git de chaque fichier,
import par `edub/portal/scripts/import-tamafit-designs.ts`, snapshot supprimé. Les designs TamaFit ne sont **jamais** dans le dépôt (données dans `data/`).

- 1 dossier = 1 section, sous-dossier = sous-section (la galerie n'imbrique qu'un niveau : plus profond → tags) ; `archive*` → statut `obsolète` ; `assets` et `exercise-images` → section « Ressources ».
- PNG/WebP/JPG → `capture` ; SVG → rastérisé en PNG (`capture`) ; HTML → `maquette-html` rendue **autonome** : CSS, JS, images, polices relatifs sont inlinés (`data:`), car l'iframe sandbox n'a pas d'origine et ne reçoit pas le cookie Authelia pour ses sous-ressources. Au-delà de 8 Mo, les rasters sont ré-encodés en WebP.
- Un PNG « rendu » d'un HTML (`x.html` + `x.png` ou `x-overview.png`) n'est pas un écran à part : il sert de vignette à la maquette (tag `rendu-png`).
- `.md` : `README.md` / notes d'un dossier → `screen_section.description` (affichée dans la galerie), `x.md` à côté de `x.html|png` → description de l'écran. Une relance ne remplace jamais une description déjà éditée.
- Relance : mêmes octets → rien ; octets changés → nouvelle version (historique gardé). Droits jamais touchés (owner seul à la création).

## 6. MCP agents — livré (ED_1732)

- `https://design.edub.fr/mcp` : Streamable HTTP sans session (SDK `@modelcontextprotocol/sdk`, serveur bas niveau, schémas JSON), code dans `edub/portal/lib/mcp/`. Mode d'emploi et liste des outils : `edub/docs/mcp.md`.
- Jetons `edd_…` (table `mcp_token`, sha-256 seul stocké, scopes `{project|*, role viewer|editor}`, jamais owner), administrés par Walid sur `/admin/tokens`. Un projet hors scope = « not found ». Journal des appels `mcp_call`, rate-limit par jeton.
- Identité d'un agent : `agent:<label>` (journal d'activité, auteur des commits git). Les droits sont ceux du jeton, pas ceux d'un utilisateur Authelia.
- Outils de design (`batch_design`, `design_*`, `batch_get`, `export_*`) : relais vers `POST 127.0.0.1:3100/mcp?tenant=f_…` avec un Bearer fichier minté (`mintEditorToken`), liste blanche, `filePath` supprimé ; après une écriture le portail enregistre le document vivant dans git au nom de l'agent.
- Liens signés (`/mcp/dl`, HMAC, 10 min) pour images d'écran et exports.

## 7. Stockage

- Documents : `data/editor/<sha256(tenant)[..16]>/current.op` (+ `acl.json` upstream, inutilisé), propriété de l'hôte. Écrit à l'**éviction** (tenant sans connexion depuis `OPENPENCIL_ONLINE_IDLE_EVICT_SECS`, 1800 s par défaut) et à l'**arrêt propre** (SIGINT/SIGTERM, `kill_timeout` PM2 15 s). Un crash dur perd les modifications depuis la dernière écriture : à surveiller, piste = flush périodique (patch isolé) si besoin.
- Le portail ne doit écrire `current.op` **que pour un fichier neuf** (tenant jamais chargé) ; sinon passer par l'hôte (`POST /api/mcp/document?tenant=`) pour ne pas être écrasé au flush suivant.
- `data/` est gitignoré et sauvegardé par edub-backup (voir INFRA.md, seuil 30 Mo). Postgres `edub_design` sauvegardé par pg_dump global.
- Démo : projet `demo` / fichier « Lumina landing » = `lumina-landing.op` de l'upstream, seedé par `npm run seed:demo` (idempotent).

## 8. Ce qui est désactivé de l'upstream (par configuration, pas par patch) — ED_1730

| Sortie / risque | État | Comment c'est coupé |
|---|---|---|
| Relai de collaboration public, hubs régionaux, collab LAN | coupé | refusé par l'hôte en `--online` (`online_policy.rs`) ; gate : tout `/api/*` exige un `?tenant=` autorisé |
| Login cloud / device login (op-hub) | coupé | `/api/auth/*` refusé par l'hôte (online) **et** par le gate (`BLOCKED_PREFIXES`) ; `GET /api/auth/status` → 403 attendu |
| Télémétrie | absente | aucune télémétrie dans l'hôte web ni le bundle (audit du code, ED_1730) |
| Vérification de mises à jour | coupée | `auto_update_enabled=false` forcé dans les réglages locaux par `public/edub-shell.js` (et `app/editor-defaults.tsx`) ; CSP `connect-src 'self'` en filet |
| Openverse / Wikimedia (recherche d'images, outil `enrich_images`) | coupé | `/api/ai/image/search` fermé pour tous par le gate (`CLOSED_AI_PREFIXES`) ; `enrich_images` n'est joignable que par le MCP de l'hôte (loopback, jamais exposé) |
| Modèles hébergés op-hub | coupé | `/api/ai/hosted/*` fermé par le gate (et refusé par l'hôte en online) |
| Iconify, polices / images / avatars tiers, fetch d'URL par le navigateur | coupé | CSP de la page `/editor` : `connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data: blob:` (nginx, `location = /editor`). Effet : le sélecteur d'icônes en ligne et les images distantes ne se chargent plus ; le catalogue local (`/pkg/assets/`) reste actif |
| IA intégrée (relais vers le fournisseur, clé saisie dans le navigateur) | **Walid (admin) seulement** | le gate refuse `/api/ai/*` (403 `ai-admin-only`) à tout autre rôle, y compris owner de projet ; la clé reste dans le navigateur, jamais stockée côté serveur (persistance des identifiants refusée par l'hôte en online). Réglage contraire : retirer `ADMIN_ONLY_PREFIXES` dans `lib/gate.ts` |
| Origines | `OPENPENCIL_WEB_ALLOWED_ORIGINS=https://design.edub.fr` | `ecosystem.config.cjs` |
| Fichiers du serveur, import de site, variantes, agents CLI hôtes, alias `POST /`, shutdown | coupés | hôte en `--online` (+ nginx/gate : `/api/share/*`, `/api/file/*`, `/api/v1/*`, `/mcp` de l'hôte) |

Vérification « aucune requête sortante » : hôte → `ss -tnp | grep op-host-web-server` ne montre que du loopback ; navigateur → Playwright : 0 requête hors origine pendant une session d'édition (ouverture, dessin, enregistrement, menus), la CSP bloque le reste.

## 8 bis. Overlay de l'éditeur (ED_1730, aucun patch Rust)

nginx injecte dans la page `/editor` (`sub_filter`) : `lang="fr"`, titre « Edub Design », favicon, manifeste PWA, thème, et `<script src="/edub-shell.js">` (`edub/portal/public/edub-shell.js`, fichier public sans secret). Le script :

- **Réglages** : français et pas de mise à jour auto, posés avant que le wasm ne monte (un choix de langue ultérieur n'est jamais écrasé).
- **Contexte** : `GET /api/edub/editor-context?tenant=` (session + droit, 404 sinon) → rôle, projet, dossiers, fichier.
- **Barre** : « ← Bibliothèque », fil d'Ariane projet / dossier / fichier, état « Enregistré ✓ / Enregistrement… / Hors ligne / Conflit ». Les écritures de l'hôte partent en XHR (`live_sync.rs`) : le script enveloppe `XMLHttpRequest` et `fetch`.
- **Enregistrement** : autosave = celui de l'hôte (un document par tenant, SSE) + commit git ~20 s après la dernière écriture (gate). « Enregistrer » / Ctrl+S (qui visait `/api/file/save`, fermé) crée une **version git immédiate** (`POST /api/edub/files/<id>/versions`). « Enregistrer sous » (téléchargement `.op`) ouvre un dialogue **bibliothèque du portail** (projets où l'on est éditeur, dossier, nom) ; « Ouvrir un fichier » ouvre la bibliothèque (projets visibles seulement) puis navigue vers `/editor?tenant=`.
- **Conflit** : la sync live de l'hôte est versionnée (deux onglets sur un fichier convergent par SSE) ; si une écriture est refusée en 409/412 : dialogue « Recharger » / « Enregistrer une copie » (copie dans le même dossier).
- **Lecture seule (viewer)** : badge + garde d'entrée (clavier d'édition, glisser, double-clic, collage, dépôt bloqués ; molette / zoom / panoramique / sélection restent). Le **serveur refuse de toute façon** : le gate répond 403 `read-only-access` à toute écriture. Limite : l'éditeur Rust n'a pas de vrai mode lecture seule, les outils restent visibles mais inertes (candidat patch §9).
- **Geste retour** : une entrée d'historique est empilée ; sur `popstate` le script envoie `Escape` à l'éditeur (ferme panneaux / modales) et remet l'entrée ; seul « ← Bibliothèque » quitte l'éditeur.
- **PWA** : `/manifest.webmanifest` (route du portail), icônes `public/*.png` (générées par `scripts/make-icons.mts` depuis `public/icon.svg`), `public/sw.js` (installabilité, ne cache rien), tous publics dans nginx.
- **Harnais de QA** sans Authelia : `edub/portal/scripts/editor-harness.mts` (nginx + gate + hub simulés, vrai binaire ; lit `sub_filter` et CSP dans le fichier nginx).

## 9. Patches du cœur Rust

**Aucun** à ce jour. Règle : tout patch futur doit être minimal, isolé (idéalement derrière un flag ou dans un fichier `*_edub.rs`), listé ici avec sa raison, et accompagné d'un test. Candidats connus : registre de vignettes par tenant (images des écrans), flush périodique des tenants, vrai mode lecture seule de l'éditeur (outils masqués) pour le rôle viewer.

## 10. Stratégie de merge upstream

- Tout le spécifique Edub vit dans `edub/` et `docs/edub/` (+ la section « Edub » en tête de `CLAUDE.md` et 6 lignes de `.gitignore`) : les conflits de merge se limitent à ces deux fichiers.
- Procédure : `git fetch upstream && git merge upstream/main` sur une branche, `cargo test -p op-host-services` (online/tenant/hub), puis déploiement (`deploy.sh` détecte le changement de crates et reconstruit). Revérifier §2 : contrat hub (`hub_auth_client.rs`), politique online (`online_policy.rs`), chemins `/api/*` du shell (`op-host-web/src/daemon_base.rs`), format du store (`tenant_store.rs`).
- Ne pas reprendre l'upstream à l'aveugle : un nouveau chemin d'API éditeur hors `/api/` ou une nouvelle route sensible en online doit être reflété dans nginx et `edub/portal/lib/gate.ts`.
