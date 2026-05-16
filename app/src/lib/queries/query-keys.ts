export interface UsageQueryFilters {
  hideCancelled: boolean;
  startDate: string | null;
  skillFilter: string | null;
  modelFamilyFilter: string | null;
}

export const queryKeys = {
  skills: {
    all: ["skills"] as const,
    builder: (sourceUrl: string | null = null) =>
      ["skills", "builder", sourceUrl] as const,
    imported: (sourceUrl: string | null = null) =>
      ["skills", "imported", sourceUrl] as const,
  },
  usage: {
    all: ["usage"] as const,
    summary: (filters: UsageQueryFilters) => ["usage", "summary", filters] as const,
    sessions: (filters: UsageQueryFilters) => ["usage", "sessions", filters] as const,
    agentRuns: (filters: UsageQueryFilters) => ["usage", "agent-runs", filters] as const,
    byStep: (filters: UsageQueryFilters) => ["usage", "by-step", filters] as const,
    byModel: (filters: UsageQueryFilters) => ["usage", "by-model", filters] as const,
    byDay: (filters: UsageQueryFilters) => ["usage", "by-day", filters] as const,
    skillNames: ["usage", "skill-names"] as const,
  },
  documents: {
    all: ["documents"] as const,
    list: ["documents", "list"] as const,
    skills: ["documents", "skills"] as const,
  },
  plugins: {
    all: ["plugins"] as const,
    list: ["plugins", "list"] as const,
  },
  auth: {
    all: ["auth"] as const,
    githubUser: ["auth", "github-user"] as const,
  },
  clarifications: {
    all: ["clarifications"] as const,
    bySkill: (skillId: string) => ["clarifications", skillId] as const,
  },
  decisions: {
    all: ["decisions"] as const,
    bySkill: (skillId: string) => ["decisions", skillId] as const,
  },
  refinements: {
    all: ["refinements"] as const,
    bySkill: (skillId: string) => ["refinements", skillId] as const,
  },
};
