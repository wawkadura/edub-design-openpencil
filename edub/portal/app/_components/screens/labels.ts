export const PLATFORM_LABEL: Record<string, string> = { ios: "iOS", android: "Android", web: "Web", watch: "Montre", desktop: "Desktop", email: "E-mail", autre: "Autre" };
export const STATUS_LABEL: Record<string, string> = { "proposé": "Proposé", "validé": "Validé", "en prod": "En prod", "obsolète": "Obsolète" };
export const TYPE_LABEL: Record<string, string> = { capture: "Capture", "maquette-html": "Maquette HTML", design: "Design (.op)" };
export type ScreenCardData = {
  id: string; title: string; platform: string; type: string; status: string; tags: string[]; currentVersion: number;
  thumbUrl: string | null; fileUrl: string | null; pageUrl: string; width: number | null; height: number | null; sectionName?: string | null; designUrl?: string | null;
};
