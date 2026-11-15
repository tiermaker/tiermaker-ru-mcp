import type { TierListImport } from "../src/schema.js"

export type Lang = "en" | "ru"

export type Expect = {
  /** The agent should ask what the topic is instead of building a board. */
  clarify?: boolean
  tiers?: {
    /** Exact labels in order (case-insensitive). */
    labels?: string[]
    /** Labels that must be present, in any order. */
    include?: string[]
    min?: number
    max?: number
    /** Color per tier in order (name or hex, compared after normalizing). */
    colors?: string[]
  }
  items?: { exact?: number; min?: number; max?: number }
  /** A slug, "any" (some template) or "none" (no template). */
  template?: string
  /** Allow items to stay in the pool. */
  pool_ok?: boolean
  /** Final-board assertions, matched by case-insensitive substring of the label. */
  final?: {
    placed?: Array<{ item: string; tier: string }>
    present?: string[]
    absent?: string[]
    tier_labels?: string[]
  }
  /** Regexes (case-insensitive) the final answer must match. */
  answer_matches?: string[]
  /**
   * The user asked for pictures: `search_images` must have been used, at least `min_share` of the items
   * (default 0.5) carry an image_url, and every such url came from a tool result (none invented).
   */
  images?: { min_share?: number }
}

export type EvalCase = {
  id: string
  category: string
  lang: Lang
  prompt: string
  /** Second user turn, sent after the first answer in the same session. */
  followup?: string
  expect: Expect
}

export type ToolCall = {
  turn: number
  name: string
  input: Record<string, unknown>
  result: string
  isError: boolean
}

export type RunRecord = {
  turns: Array<{ prompt: string; answer: string }>
  toolCalls: ToolCall[]
  durationMs: number
  costUsd: number
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number }
  error?: string
  timedOut?: boolean
}

export type CheckStatus = "pass" | "fail" | "skip"
export type CheckResult = { name: string; status: CheckStatus; reason: string }

export type JudgeScores = {
  relevance: number | null
  arrangement: number | null
  completeness: number | null
  answer: number | null
  notes: { relevance: string; arrangement: string; completeness: string; answer: string }
}

export type CaseResult = {
  case: EvalCase
  run: RunRecord
  checks: CheckResult[]
  judge?: JudgeScores
  judgeError?: string
  board?: TierListImport
  pass: boolean
}

export type RunMeta = {
  runId: string
  startedAt: string
  agentModel: string
  judgeModel: string | null
  skill: string
  baseUrl: string
  mcpVersion: string
}
