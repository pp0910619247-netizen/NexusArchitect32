/**
 * The user's Core identity profile — the anchor for Core Memory (AGENTS.md §5).
 * Stored on-device only; never synced to any server.
 */
export interface UserProfile {
  /** Stable unique identifier of the profile. */
  id: string;
  /** The user's real-world display name. */
  displayName: string;
  /** Name the user gave their AI agent (digital twin). */
  aiName: string;
  /** Things the user loves / is passionate about. */
  interests: string[];
  /** People who matter to the user (family, partners, mentors…). */
  lovedOnes: string[];
  /** The user's occupation, or `null` if unspecified. */
  occupation: string | null;
  /** Life / career goals the user wants the agent to help pursue. */
  goals: string[];
  /** Health constraints the agent must respect (diet, activity, conditions…). */
  healthConstraints: string[];
  /** Belief constraints the agent must respect. */
  beliefs: string[];
  /** Unix timestamp (seconds) at which the profile was created. */
  createdAt: number;
  /** Unix timestamp (seconds) of the last profile update. */
  updatedAt: number;
}
