export const STORY_BIBLE_SECTIONS = [
  { id: "overview", icon: "📕", label: "Overview", center: "legacy" },
  { id: "characters", icon: "👤", label: "Characters", center: "legacy" },
  { id: "world-locations", icon: "🏔️", label: "Locations", center: "legacy" },
  { id: "style", icon: "🎨", label: "Style", center: "legacy" },
  { id: "lore", icon: "📜", label: "Lore", center: "codex" },
  { id: "factions", icon: "⚑", label: "Factions", center: "codex" },
  { id: "objects", icon: "🗡️", label: "Objects", center: "codex" },
  { id: "systems", icon: "✦", label: "Systems", center: "codex" },
  { id: "timeline", icon: "🕰️", label: "Timeline", center: "codex" },
  { id: "threads", icon: "🧵", label: "Threads", center: "codex" },
  { id: "themes", icon: "💭", label: "Themes", center: "codex" },
  { id: "glossary", icon: "📖", label: "Glossary", center: "codex" },
  { id: "relationships", icon: "🔗", label: "Relationships", center: "codex" },
  { id: "facts", icon: "▪️", label: "Facts", center: "codex" },
  { id: "review-queue", icon: "📥", label: "Review Queue", center: "codex" },
] as const;

export type StoryBibleSectionId = (typeof STORY_BIBLE_SECTIONS)[number]["id"];
export type LegacyStoryBibleSectionId = Extract<StoryBibleSectionId, "overview" | "characters" | "world-locations" | "style">;
export type CodexStoryBibleSectionId = Exclude<StoryBibleSectionId, LegacyStoryBibleSectionId>;

export const STORY_BIBLE_SECTION_BY_ID = new Map(
  STORY_BIBLE_SECTIONS.map((section) => [section.id, section] as const),
);

export function isStoryBibleSectionId(value: string): value is StoryBibleSectionId {
  return STORY_BIBLE_SECTION_BY_ID.has(value as StoryBibleSectionId);
}

export function isLegacyStoryBibleSection(value: StoryBibleSectionId): value is LegacyStoryBibleSectionId {
  return STORY_BIBLE_SECTION_BY_ID.get(value)?.center === "legacy";
}
