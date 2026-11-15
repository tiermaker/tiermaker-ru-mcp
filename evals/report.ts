import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { CaseResult, RunMeta } from "./types.js"

export type Summary = { meta: RunMeta; results: CaseResult[] }

export const median = (values: number[]): number => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null)
const fmt = (value: number | null, digits = 1) => (value === null ? "–" : value.toFixed(digits))
const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ")
const MARK = { pass: "✓", fail: "✗", skip: "·" } as const

function judgeAvg(results: CaseResult[], key: "relevance" | "arrangement" | "completeness" | "answer"): number | null {
  return mean(results.map((r) => r.judge?.[key]).filter((v): v is number => typeof v === "number"))
}

export function renderSummary(summary: Summary, previous?: Summary): string {
  const { meta, results } = summary
  const names = [...new Set(results.flatMap((r) => r.checks.map((c) => c.name)))]
  const passed = results.filter((r) => r.pass).length
  const out: string[] = [
    `# Eval run ${meta.runId}`,
    "",
    `Agent \`${meta.agentModel}\`, judge ${meta.judgeModel ? `\`${meta.judgeModel}\`` : "off"}, skill \`${meta.skill}\`, MCP ${meta.mcpVersion}, site ${meta.baseUrl}, started ${meta.startedAt}.`,
    "",
    `**Pass rate: ${passed}/${results.length} (${Math.round((100 * passed) / Math.max(results.length, 1))}%)**. ` +
      `Median tool calls ${fmt(median(results.map((r) => r.run.toolCalls.length)), 0)}, median time ${fmt(median(results.map((r) => r.run.durationMs / 1000)), 0)} s, ` +
      `total cost $${results.reduce((a, r) => a + r.run.costUsd, 0).toFixed(2)}, ` +
      `tokens in/out/cache-read/cache-write ${["input", "output", "cacheRead", "cacheWrite"].map((k) => results.reduce((a, r) => a + r.run.usage[k as "input"], 0)).join(" / ")}.`,
    "",
    "## Cases × checks",
    "",
    `| case | ${names.join(" | ")} | calls | time s | judge R/A/C/Ans |`,
    `|---|${names.map(() => "---").join("|")}|---|---|---|`,
  ]
  for (const r of results) {
    const marks = names.map((name) => {
      const check = r.checks.find((c) => c.name === name)
      return check ? MARK[check.status] : ""
    })
    const j = r.judge ? [r.judge.relevance, r.judge.arrangement, r.judge.completeness, r.judge.answer].map((v) => v ?? "–").join("/") : "–"
    out.push(`| ${r.pass ? "" : "**"}${r.case.id}${r.pass ? "" : "**"} | ${marks.join(" | ")} | ${r.run.toolCalls.length} | ${Math.round(r.run.durationMs / 1000)} | ${j} |`)
  }
  out.push("", "## By category", "", "| category | pass | calls (median) | time s (median) | relevance | arrangement | completeness | answer |", "|---|---|---|---|---|---|---|---|")
  for (const category of [...new Set(results.map((r) => r.case.category))]) {
    const group = results.filter((r) => r.case.category === category)
    out.push(
      `| ${category} | ${group.filter((r) => r.pass).length}/${group.length} | ${fmt(median(group.map((r) => r.run.toolCalls.length)), 0)} | ${fmt(median(group.map((r) => r.run.durationMs / 1000)), 0)} | ` +
        `${(["relevance", "arrangement", "completeness", "answer"] as const).map((k) => fmt(judgeAvg(group, k))).join(" | ")} |`,
    )
  }
  out.push("", "Judge scores (1-5): ", "")
  out.push(`Overall averages — relevance ${fmt(judgeAvg(results, "relevance"))}, arrangement ${fmt(judgeAvg(results, "arrangement"))}, completeness ${fmt(judgeAvg(results, "completeness"))}, answer ${fmt(judgeAvg(results, "answer"))}.`)

  const failures = results.flatMap((r) => r.checks.filter((c) => c.status === "fail").map((c) => `- **${r.case.id}** / ${c.name}: ${cell(c.reason)}`))
  out.push("", "## Failed checks", "", ...(failures.length ? failures : ["None."]))

  const notes = results.filter((r) => r.judge).map((r) => {
    const j = r.judge!
    return `- **${r.case.id}**: ${[j.notes.relevance, j.notes.arrangement, j.notes.completeness, j.notes.answer].filter(Boolean).map(cell).join(" · ")}`
  })
  if (notes.length) out.push("", "## Judge notes", "", ...notes)
  const judgeErrors = results.filter((r) => r.judgeError).map((r) => `- ${r.case.id}: ${cell(r.judgeError!)}`)
  if (judgeErrors.length) out.push("", "## Judge errors", "", ...judgeErrors)

  if (previous) {
    const prevPassed = previous.results.filter((r) => r.pass).length
    const prevById = new Map(previous.results.map((r) => [r.case.id, r]))
    out.push("", `## Compared with ${previous.meta.runId}`, "", `Pass rate ${prevPassed}/${previous.results.length} → ${passed}/${results.length}; ` +
      `median calls ${fmt(median(previous.results.map((r) => r.run.toolCalls.length)), 0)} → ${fmt(median(results.map((r) => r.run.toolCalls.length)), 0)}; ` +
      `median time ${fmt(median(previous.results.map((r) => r.run.durationMs / 1000)), 0)} → ${fmt(median(results.map((r) => r.run.durationMs / 1000)), 0)} s.`, "")
    const changes = results.flatMap((r) => {
      const before = prevById.get(r.case.id)
      if (!before || before.pass === r.pass) return []
      return [`- ${r.case.id}: ${before.pass ? "pass → FAIL" : "fail → pass"}`]
    })
    out.push(...(changes.length ? changes : ["No case changed status."]))
  }
  return `${out.join("\n")}\n`
}

export function loadSummary(runDir: string): Summary | undefined {
  const path = join(runDir, "summary.json")
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Summary) : undefined
}

/** The most recent earlier run in `resultsDir` that has a summary.json. */
export function findPrevious(resultsDir: string, runId: string): Summary | undefined {
  if (!existsSync(resultsDir)) return undefined
  const ids = readdirSync(resultsDir).filter((id) => id < runId && existsSync(join(resultsDir, id, "summary.json"))).sort()
  const last = ids.at(-1)
  return last ? loadSummary(join(resultsDir, last)) : undefined
}

export function writeSummary(resultsDir: string, summary: Summary): string {
  const runDir = join(resultsDir, summary.meta.runId)
  writeFileSync(join(runDir, "summary.json"), JSON.stringify(summary))
  const text = renderSummary(summary, findPrevious(resultsDir, summary.meta.runId))
  writeFileSync(join(runDir, "summary.md"), text)
  return text
}
