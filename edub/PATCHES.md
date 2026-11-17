# Edub Design — patches du cœur et points de contact avec l'upstream

Fork de `ZSeven-W/openpencil` (remote `upstream`). Ce fichier est **la** liste de tout ce qui,
dans le fork, touche un fichier de l'upstream. Il est lu par `edub/portal/lib/patches.test.ts`
(échoue si un fichier listé disparaît) et par `edub/scripts/sync-upstream.sh` (distingue les
fichiers Edub / patchés dans la liste des conflits). Tenir à jour à chaque patch (spec §9).

Règle : pas de patch du cœur Rust sauf nécessité ; minimal, isolé, listé ici avec sa raison.

## Patches du cœur Rust

Aucun à ce jour (ED_1728, ED_1730 : spec §8 / §8 bis / §9).

| Fichier | Raison | Réappliquer |
|---|---|---|
<!-- Ajouter une ligne par patch : `chemin` | raison | commande ou commit (ex. `git cherry-pick <sha>`). -->

## Fichiers de l'upstream modifiés (hors cœur Rust)

| Fichier | Raison | Réappliquer |
|---|---|---|
| `CLAUDE.md` | section « Edub » en tête (lue par chaque agent) | en conflit : garder la section Edub, prendre le reste de l'upstream |
| `.gitignore` | `!/docs/edub/`, `/data/`, `/dist.new/`, `/dist.old/`, `/edub/portal/.next*`, `next-env.d.ts`, `*.tsbuildinfo` | en conflit : union des deux côtés |

## Fichiers du cœur à revérifier à chaque sync (contrats, non modifiés)

Edub s'appuie sur eux sans les patcher ; un changement upstream peut casser le portail (spec §2, §10).

| Fichier | Contrat |
|---|---|
| `crates/op-host-services/src/hub_auth_client.rs` | contrat hub d'identité |
| `crates/op-host-services/src/web_canvas_server/online_policy.rs` | politique du mode `--online` |
| `crates/op-host-web/src/daemon_base.rs` | chemins `/api/*` du shell (gate nginx + `edub/portal/lib/gate.ts`) |
| `crates/op-host-services/src/web_canvas_server/tenant_store.rs` | format du store (1 tenant = 1 fichier) |

## Après un sync

1. `cargo test -p op-host-services` (online / tenant / hub).
2. Un nouveau chemin d'API éditeur hors `/api/` ou une nouvelle route sensible en online : refléter dans `edub/deploy/nginx-design.edub.fr.conf` et `edub/portal/lib/gate.ts`.
3. Mettre à jour ce fichier si un patch a été ajouté / retiré.
