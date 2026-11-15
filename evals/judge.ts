import { spawn } from "node:child_process"
import type { TierListImport } from "../src/schema.js"
import type { EvalCase, JudgeScores } from "./types.js"

export const RUBRIC = `You grade how well an AI assistant built a tier list for a user. Score each dimension 1-5 (5 = excellent, 1 = unusable), or null if it cannot apply.
- relevance: do the items fit the requested topic (no off-topic, made-up or irrelevant items)?
- arrangement: is the placement into tiers sensible and consistent with a stated or obvious criterion (or exactly what the user dictated)?
- completeness: no obvious omissions for the topic and request (e.g. missing famous items, requested edits not done)?
- answer: is the final message to the user clear, brief, in the user's language, honest about limits or problems, with the link/image delivered?
If no board was built (the assistant asked a question instead), give null for relevance, arrangement and completeness, and grade "answer" on whether the question was useful and brief.
Reply with ONLY a JSON object: {"relevance":n,"arrangement":n,"completeness":n,"answer":n,"notes":{"relevance":"one line","arrangement":"one line","completeness":"one line","answer":"one line"}}`

export function boardForJudge(board: TierListImport): string {
  const label = new Map(board.items.map((item) => [item.id, item.label ?? "(image)"]))
  const lines = board.tiers.map((tier) => `${tier.label}: ${(board.placements[tier.id] ?? []).map((id) => label.get(id)).join(", ") || "-"}`)
  const placed = new Set(Object.values(board.placements).flat())
  const pool = board.items.filter((item) => !placed.has(item.id)).map((item) => item.label ?? "(image)")
  return `Title: ${board.title}\n${lines.join("\n")}${pool.length ? `\nUnplaced: ${pool.join(", ")}` : ""}`
}

export function buildJudgePrompt(evalCase: EvalCase, board: TierListImport | undefined, answer: string): string {
  const turns = [evalCase.prompt, ...(evalCase.followup ? [evalCase.followup] : [])].map((text, i) => `Request ${i + 1}: ${text}`)
  return `${RUBRIC}\n\n${turns.join("\n")}\n\nFinal board:\n${board ? boardForJudge(board) : "(none)"}\n\nAssistant's final message:\n${answer.slice(0, 3000)}`
}

const SCORE_KEYS = ["relevance", "arrangement", "completeness", "answer"] as const

export function parseJudge(text: string): JudgeScores {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end < start) throw new Error("judge returned no JSON")
  const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  const notes = (raw.notes ?? {}) as Record<string, unknown>
  const scores = {} as JudgeScores
  scores.notes = { relevance: "", arrangement: "", completeness: "", answer: "" }
  for (const key of SCORE_KEYS) {
    const value = raw[key]
    if (value !== null && (typeof value !== "number" || value < 1 || value > 5)) throw new Error(`judge score ${key} is invalid`)
    scores[key] = value as number | null
    scores.notes[key] = String(notes[key] ?? "")
  }
  return scores
}

export function runJudge(prompt: string, model: string, timeoutMs = 180_000): Promise<JudgeScores> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "--model", model, "--tools", "", "--setting-sources", "project", "--no-session-persistence", "--output-format", "json"], {
      stdio: ["pipe", "pipe", "pipe"],
    })
    let out = ""
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error("judge timed out"))
    }, timeoutMs)
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")))
    child.on("error", reject)
    child.on("close", () => {
      clearTimeout(timer)
      try {
        const wrapper = JSON.parse(out) as { result?: string; is_error?: boolean }
        if (wrapper.is_error) throw new Error(`judge error: ${String(wrapper.result).slice(0, 150)}`)
        resolve(parseJudge(String(wrapper.result ?? "")))
      } catch (error) {
        reject(error)
      }
    })
    child.stdin.end(prompt)
  })
}
