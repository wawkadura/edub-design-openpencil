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
- **Limite connue upstream** : en online, les vignettes d'images embarquées ne sont pas publiées (registre global, `allows_image_thumb_registry`) → un nœud image s'affiche en placeholder dans l'éditeur. À traiter quand on importera les écrans PNG (voir §9).

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

## 4. Modèle de droits

Tables (`edub/portal/lib/db/schema.ts`, migrations `edub/portal/drizzle/`) :

- `user` : miroir upserté de l'identité Authelia (`username` unique, nom, email, groupes, `last_seen_at`). Aucune donnée d'authentification.
- `project` : une app (slug, nom). `project_member(project_id, user_id, role)` avec `role ∈ owner | editor | viewer`.
- `design_file` : `project_id`, `name`, `tenant_id` (`f_<32 hex>`, unique), `archived`.

Règles :

- Entrer sur le site : groupe Authelia `design` ou `admin` (règle Authelia + recontrôle portail).
- `admin` (Walid) : rôle `owner` sur tous les projets.
- Sinon : le rôle de `project_member` sur le projet du fichier ; aucun membre → aucun accès (gate 403, fichier invisible dans le portail).
- `viewer` : lecture seule dans l'éditeur (le gate refuse toute écriture ; l'éditeur peut encore dessiner localement mais rien n'est enregistré). `editor`/`owner` : lecture + écriture. `owner` gérera les membres (ticket suivant).

## 5. API du portail

| Route | Accès | Rôle |
|---|---|---|
| `GET /` | Authelia | Accueil : projets/fichiers visibles, lien « Ouvrir l'éditeur » (`/editor?tenant=f_…`) |
| `GET /api/health` | Authelia (et loopback pour deploy.sh) | `{ok, db, editor}` ; 503 si l'un est KO |
| `GET /api/edub/editor-gate` | interne nginx uniquement | décision gate (§3), `X-Edub-Editor-Token` |
| `POST /api/v1/tokens/introspect` | loopback + `X-OP-Internal-Auth` | contrat hub pour l'hôte Rust |
| `GET /api/v1/session` | loopback | contrat hub, toujours 401 (pas de cookie de session éditeur) |
| `GET/POST /mcp` | public, Bearer | **réservé** : 401 tant que le MCP agents n'est pas livré |

Les routes métier futures du portail vivent sous `/api/edub/*` (`/api/*` hors exceptions part à l'éditeur).

## 6. MCP (cible, ticket suivant)

- Jetons agents émis par le portail (table dédiée, haché, scopes `read`/`write`, projets autorisés), présentés en `Authorization: Bearer` sur `https://design.edub.fr/mcp` (déjà exempté d'Authelia dans nginx).
- Outils portail : lister projets/fichiers, créer un fichier, lire l'aperçu/écran. Outils de design : relais vers le MCP de l'hôte `POST 127.0.0.1:3100/mcp?tenant=f_…` avec un Bearer fichier minté (même `mintEditorToken`), profil complet ou `lean`.
- Vérifié pendant ED_1728 : `tools/list` (159 outils) et `tools/call get_document_info` répondent sur un tenant fichier.

## 7. Stockage

- Documents : `data/editor/<sha256(tenant)[..16]>/current.op` (+ `acl.json` upstream, inutilisé), propriété de l'hôte. Écrit à l'**éviction** (tenant sans connexion depuis `OPENPENCIL_ONLINE_IDLE_EVICT_SECS`, 1800 s par défaut) et à l'**arrêt propre** (SIGINT/SIGTERM, `kill_timeout` PM2 15 s). Un crash dur perd les modifications depuis la dernière écriture : à surveiller, piste = flush périodique (patch isolé) si besoin.
- Le portail ne doit écrire `current.op` **que pour un fichier neuf** (tenant jamais chargé) ; sinon passer par l'hôte (`POST /api/mcp/document?tenant=`) pour ne pas être écrasé au flush suivant.
- `data/` est gitignoré et sauvegardé par edub-backup (voir INFRA.md, seuil 30 Mo). Postgres `edub_design` sauvegardé par pg_dump global.
- Démo : projet `demo` / fichier « Lumina landing » = `lumina-landing.op` de l'upstream, seedé par `npm run seed:demo` (idempotent).

## 8. Ce qui est désactivé de l'upstream (par configuration, pas par patch)

- Fermé par l'hôte en `--online` : `/api/file/*`, `/api/auth/*` (login device op-hub), persistance des réglages/identifiants serveur, import de site, variantes de design, relai de collaboration, collab LAN, modèles hébergés, agents CLI hôtes, alias `POST /`, shutdown générique.
- Fermé par nginx/gate : `/api/share/*`, `/api/auth/*`, `/api/file/*`, `/api/v1/*`, le `/mcp` de l'hôte, tout appel sans `?tenant=f_…` autorisé.
- IA du chat : utilisable seulement avec une clé personnelle saisie dans le navigateur (jamais stockée côté serveur).

## 9. Patches du cœur Rust

**Aucun** à ce jour. Règle : tout patch futur doit être minimal, isolé (idéalement derrière un flag ou dans un fichier `*_edub.rs`), listé ici avec sa raison, et accompagné d'un test. Candidats connus : registre de vignettes par tenant (images des écrans), flush périodique des tenants.

## 10. Stratégie de merge upstream

- Tout le spécifique Edub vit dans `edub/` et `docs/edub/` (+ la section « Edub » en tête de `CLAUDE.md` et 6 lignes de `.gitignore`) : les conflits de merge se limitent à ces deux fichiers.
- Procédure : `git fetch upstream && git merge upstream/main` sur une branche, `cargo test -p op-host-services` (online/tenant/hub), puis déploiement (`deploy.sh` détecte le changement de crates et reconstruit). Revérifier §2 : contrat hub (`hub_auth_client.rs`), politique online (`online_policy.rs`), chemins `/api/*` du shell (`op-host-web/src/daemon_base.rs`), format du store (`tenant_store.rs`).
- Ne pas reprendre l'upstream à l'aveugle : un nouveau chemin d'API éditeur hors `/api/` ou une nouvelle route sensible en online doit être reflété dans nginx et `edub/portal/lib/gate.ts`.
