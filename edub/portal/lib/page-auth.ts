import { upsertUser } from "./access.ts";
import { currentIdentity } from "./current-user.ts";
import { canUseDesign, type Identity } from "./identity.ts";

export type PageAuth = { identity: Identity } | { message: string };

/** Identity for a server-rendered page, or the message to show instead. */
export async function pageAuth(): Promise<PageAuth> {
  const identity = await currentIdentity();
  if (!identity) return { message: "Identité absente : cette page doit être servie derrière Authelia." };
  if (!canUseDesign(identity)) return { message: `Ton compte (${identity.username}) n'a pas accès à Edub Design. Demande à Walid.` };
  await upsertUser(identity);
  return { identity };
}

export const ROLE_LABEL = { owner: "Propriétaire", editor: "Éditeur", viewer: "Lecteur" } as const;

export const ACTION_LABEL: Record<string, string> = {
  "project.created": "a créé le projet",
  "project.updated": "a modifié le projet",
  "project.archived": "a archivé le projet",
  "project.unarchived": "a désarchivé le projet",
  "member.set": "a partagé avec",
  "member.removed": "a retiré l'accès de",
  "folder.created": "a créé le dossier",
  "folder.renamed": "a renommé le dossier",
  "folder.deleted": "a supprimé le dossier",
  "file.created": "a créé le fichier",
  "file.opened": "a ouvert",
  "file.saved": "a modifié",
  "file.renamed": "a renommé",
  "file.moved": "a déplacé",
  "file.trashed": "a mis à la corbeille",
  "file.restored": "a restauré",
  "file.version-restored": "a restauré une version de",
};
