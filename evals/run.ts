import { spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"
import { runAgent } from "./agent.js"
import { casePassed, runChecks, type CheckContext } from "./checks.js"
import { buildJudgePrompt, runJudge } from "./judge.js"
import { checkImageUrl } from "./images.js"
import { preflightMcp } from "./preflight.js"
import { writeSummary } from "./report.js"
import type { CaseResult, EvalCase, RunMeta } from "./types.js"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "../..")
const evalsDir = join(repoRoot, "evals")
const resultsDir = join(evalsDir, "results")

type Config = { agentModel: string; judgeModel: string; timeoutMs: number; concurrency: number; baseUrl: string }

function loadConfig(): Config {
  const file = JSON.parse(readFileSync(join(evalsDir, "config.json"), "utf8")) as Config
  return {
    agentModel: process.env.EVAL_AGENT_MODEL ?? file.agentModel,
    judgeModel: process.env.EVAL_JUDGE_MODEL ?? file.judgeModel,
    timeoutMs: Number(process.env.EVAL_TIMEOUT_MS ?? file.timeoutMs),
    concurrency: Number(process.env.EVAL_CONCURRENCY ?? file.concurrency),
    baseUrl: (process.env.TIERMAKER_BASE_URL ?? file.baseUrl).replace(/\/+$/, ""),
  }
}

function parseArgs(argv: string[]) {
  const args = { cases: [] as string[], judge: true, skill: join(repoRoot, "skills/tiermaker"), label: "" }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--case") args.cases.push(argv[++i] ?? "")
    else if (arg === "--no-judge") args.judge = false
    else if (arg === "--skill") args.skill = argv[++i] ?? ""
    else if (arg === "--label") args.label = argv[++i] ?? ""
    else throw new Error(`Unknown argument ${arg}`)
  }
  return args
}

const imageCache = new Map<string, Promise<{ ok: boolean; reason?: string }>>()

function checkImage(url: string): Promise<{ ok: boolean; reason?: string }> {
  let cached = imageCache.get(url)
  if (!cached) {
    cached = checkImageUrl(url)
    imageCache.set(url, cached)
  }
  return cached
}

const templateCache = new Map<string, Promise<Set<string> | undefined>>()

/** The pictures the site lists for a template, as the MCP would put them on a board. */
function templateImages(baseUrl: string, slug: string): Promise<Set<string> | undefined> {
  let cached = templateCache.get(slug)
  if (!cached) {
    const absolute = (path: string | undefined) => (!path ? [] : /^https?:\/\//i.test(path) ? [path] : path.startsWith("/") ? [`${baseUrl}${path}`] : [])
    cached = fetch(`${baseUrl}/api/templates/slug/${encodeURIComponent(slug)}/`, { signal: AbortSignal.timeout(10_000) })
      .then(async (response) => {
        if (!response.ok) return undefined
        const data = (await response.json()) as { items?: Array<{ image?: { filePath?: string } | null }> }
        return new Set((data.items ?? []).flatMap((item) => absolute(item.image?.filePath)))
      })
      .catch(() => undefined)
    templateCache.set(slug, cached)
  }
  return cached
}

async function runCase(evalCase: EvalCase, runDir: string, config: Config, options: ReturnType<typeof parseArgs>): Promise<CaseResult> {
  const caseDir = join(runDir, evalCase.id)
  const work = join(caseDir, "work")
  mkdirSync(work, { recursive: true })
  if (options.skill !== "none") cpSync(options.skill, join(work, ".claude/skills/tiermaker"), { recursive: true })
  const entry = process.env.EVAL_MCP_ENTRY ?? join(repoRoot, "dist/index.js")
  const mcpConfig = join(caseDir, "mcp.json")
  writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { tiermaker: { command: "node", args: [entry], env: { TIERMAKER_BASE_URL: config.baseUrl } } } }, null, 2))

  const agentOptions = {
    prompts: [evalCase.prompt, ...(evalCase.followup ? [evalCase.followup] : [])],
    cwd: work,
    mcpConfig,
    model: config.agentModel,
    timeoutMs: config.timeoutMs,
    env: { NO_PROXY: "localhost,127.0.0.1", no_proxy: "localhost,127.0.0.1" },
  }
  let run = await runAgent(agentOptions)
  // A timeout is usually the machine sleeping or a stuck API call: one fresh attempt, not a verdict on the agent.
  if (run.timedOut) run = await runAgent(agentOptions)
  const ctx: CheckContext = {
    baseUrl: config.baseUrl,
    checkImage,
    templateImages: (slug) => templateImages(config.baseUrl, slug),
    fetchDraft: async (id) => {
      try {
        const response = await fetch(`${config.baseUrl}/api/drafts/${id}`, { signal: AbortSignal.timeout(10_000) })
        if (!response.ok) return undefined
        const body = (await response.json()) as { payload?: unknown }
        return typeof body.payload === "string" ? body.payload : undefined
      } catch {
        return undefined
      }
    },
    readFile: (path) => {
      for (const candidate of [path, join(work, basename(path))]) if (existsSync(candidate)) return readFileSync(candidate)
      return undefined
    },
  }
  const { checks, board } = await runChecks(evalCase, run, ctx)
  const result: CaseResult = { case: evalCase, run, checks, board, pass: casePassed(checks) }
  if (options.judge && !run.error) {
    try {
      result.judge = await runJudge(buildJudgePrompt(evalCase, board, run.turns.at(-1)?.answer ?? ""), config.judgeModel)
    } catch (error) {
      result.judgeError = error instanceof Error ? error.message : String(error)
    }
  }
  writeFileSync(join(caseDir, "result.json"), JSON.stringify(result, null, 2))
  writeFileSync(join(caseDir, "answer.md"), run.turns.map((turn, i) => `## Turn ${i + 1}\n\n> ${turn.prompt}\n\n${turn.answer}\n`).join("\n"))
  const link = run.toolCalls.filter((call) => call.name === "get_editor_link" && !call.isError).at(-1)?.result
  if (link) writeFileSync(join(caseDir, "link.json"), link)
  return result
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const config = loadConfig()
  const host = new URL(config.baseUrl).hostname
  if (!["localhost", "127.0.0.1"].includes(host) && process.env.EVAL_ALLOW_REMOTE !== "1") {
    throw new Error(`Evals run against the dev site only; ${config.baseUrl} is not local (set EVAL_ALLOW_REMOTE=1 to override).`)
  }
  const all = parse(readFileSync(join(evalsDir, "cases.yaml"), "utf8")) as EvalCase[]
  const cases = options.cases.length ? all.filter((c) => options.cases.includes(c.id)) : all
  const unknown = options.cases.filter((id) => !all.some((c) => c.id === id))
  if (unknown.length) throw new Error(`Unknown case id(s): ${unknown.join(", ")}`)
  const probe = await fetch(`${config.baseUrl}/api/templates/?limit=1`, { signal: AbortSignal.timeout(10_000) }).catch(() => undefined)
  if (!probe?.ok) throw new Error(`Site ${config.baseUrl} is not reachable (run \`make dev\`).`)
  const mcpEntry = process.env.EVAL_MCP_ENTRY ?? join(repoRoot, "dist/index.js")
  if (!existsSync(mcpEntry)) throw new Error(`MCP is not built (${mcpEntry} is missing): run \`npm run build\`.`)
  await preflightMcp(mcpEntry, config.baseUrl)

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-")
  const runId = options.label ? `${stamp}-${options.label}` : stamp
  const runDir = join(resultsDir, runId)
  mkdirSync(runDir, { recursive: true })
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string }
  const meta: RunMeta = {
    runId, startedAt: new Date().toISOString(), agentModel: config.agentModel, judgeModel: options.judge ? config.judgeModel : null,
    skill: options.skill === "none" ? "none" : basename(options.skill), baseUrl: config.baseUrl, mcpVersion: pkg.version,
  }
  // The timeouts are wall-clock: keep a Mac awake while the run lasts.
  if (process.platform === "darwin") spawn("caffeinate", ["-dims", "-w", String(process.pid)], { stdio: "ignore" }).unref()
  console.log(`Run ${runId}: ${cases.length} case(s), agent ${config.agentModel}, concurrency ${config.concurrency}`)

  const results: CaseResult[] = []
  const queue = [...cases]
  let stop = false
  await Promise.all(
    Array.from({ length: Math.min(config.concurrency, queue.length) }, async () => {
      for (let evalCase = queue.shift(); evalCase && !stop; evalCase = queue.shift()) {
        const result = await runCase(evalCase, runDir, config, options)
        if (result.run.error === "rate limited") stop = true
        results.push(result)
        console.log(`${result.pass ? "PASS" : "FAIL"} ${evalCase.id} (${result.run.toolCalls.length} calls, ${Math.round(result.run.durationMs / 1000)} s)${result.pass ? "" : ` — ${result.checks.filter((c) => c.status === "fail").map((c) => `${c.name}: ${c.reason}`).join("; ")}`}`)
      }
    }),
  )
  if (stop) console.error("Stopped early: the account is rate limited. Remaining cases were not run.")
  results.sort((a, b) => cases.indexOf(a.case) - cases.indexOf(b.case))
  const text = writeSummary(resultsDir, { meta, results })
  console.log(`\n${text}\nSummary: ${join(runDir, "summary.md")}`)
  process.exitCode = results.every((r) => r.pass) ? 0 : 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 2
})
