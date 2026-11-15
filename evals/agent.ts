import { spawn } from "node:child_process"
import { mcpInitError } from "./preflight.js"
import type { RunRecord, ToolCall } from "./types.js"

export type AgentOptions = {
  prompts: string[]
  cwd: string
  mcpConfig: string
  model: string
  timeoutMs: number
  env?: NodeJS.ProcessEnv
}

type Block = { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: unknown; is_error?: boolean }
type Usage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }

const MCP_PREFIX = "mcp__tiermaker__"

function resultText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  // Image blocks (the rendered PNG) are dropped: the file is checked on disk.
  return (content as Block[]).filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n")
}

/** Runs `claude -p` with all prompts as consecutive turns of one session (the MCP process, and so the board, survives). */
export function runAgent(options: AgentOptions): Promise<RunRecord> {
  const started = Date.now()
  const record: RunRecord = {
    turns: options.prompts.map((prompt) => ({ prompt, answer: "" })),
    toolCalls: [],
    durationMs: 0,
    costUsd: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }
  const args = [
    "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
    "--strict-mcp-config", "--mcp-config", options.mcpConfig,
    "--setting-sources", "project", "--tools", "Skill", "--permission-mode", "bypassPermissions",
    "--model", options.model, "--no-session-persistence",
  ]
  return new Promise((resolve) => {
    const child = spawn("claude", args, { cwd: options.cwd, env: { ...process.env, ...options.env }, stdio: ["pipe", "pipe", "pipe"] })
    let turn = 0
    let buffer = ""
    let stderr = ""
    let finished = false
    let lastEvent = "none"
    const pending = new Map<string, ToolCall>()
    const send = (text: string) => child.stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`)

    const finish = (error?: string, timedOut = false) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      if (error && !record.error) record.error = error
      if (timedOut) record.timedOut = true
      record.durationMs = Date.now() - started
      resolve(record)
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      finish(`no result after ${Math.round(options.timeoutMs / 1000)} s (last event: ${lastEvent}; stderr: ${stderr.slice(-200) || "-"})`, true)
    }, options.timeoutMs)

    function handle(event: Record<string, unknown>) {
      lastEvent = `${String(event.type)}${event.subtype ? `/${String(event.subtype)}` : ""}@${new Date().toISOString().slice(11, 19)}`
      const initError = mcpInitError(event)
      if (initError) {
        record.error = initError
        child.kill("SIGKILL")
        return finish()
      }
      if (event.type === "assistant" || event.type === "user") {
        const blocks = ((event.message as { content?: unknown } | undefined)?.content ?? []) as Block[] | string
        if (!Array.isArray(blocks)) return
        for (const block of blocks) {
          if (event.type === "assistant" && block.type === "tool_use" && block.id && block.name) {
            const call: ToolCall = { turn, name: block.name.replace(MCP_PREFIX, ""), input: block.input ?? {}, result: "", isError: false }
            pending.set(block.id, call)
            record.toolCalls.push(call)
          } else if (event.type === "user" && block.type === "tool_result" && block.tool_use_id) {
            const call = pending.get(block.tool_use_id)
            if (call) {
              call.result = resultText(block.content)
              call.isError = Boolean(block.is_error)
            }
          }
        }
      } else if (event.type === "rate_limit_event") {
        const info = event.rate_limit_info as { status?: string } | undefined
        if (info?.status === "rejected") record.error = "rate limited"
      } else if (event.type === "result") {
        const text = typeof event.result === "string" ? event.result : ""
        record.turns[turn]!.answer = text
        if (event.is_error) record.error = `agent error: ${text.slice(0, 200)}`
        // Cost and usage are cumulative over the session; the last result wins.
        record.costUsd = Number(event.total_cost_usd ?? record.costUsd)
        const usage = (event.usage ?? {}) as Usage
        record.usage = {
          input: usage.input_tokens ?? 0,
          output: usage.output_tokens ?? 0,
          cacheRead: usage.cache_read_input_tokens ?? 0,
          cacheWrite: usage.cache_creation_input_tokens ?? 0,
        }
        turn += 1
        if (record.error || turn >= options.prompts.length) child.stdin.end()
        else send(options.prompts[turn]!)
      }
    }

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8")
      let newline: number
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        try {
          handle(JSON.parse(line) as Record<string, unknown>)
        } catch {
          /* not JSON: ignore */
        }
      }
    })
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")))
    child.on("error", (error) => finish(`cannot start claude: ${error.message}`))
    child.on("close", (code) => {
      const complete = turn >= options.prompts.length
      finish(complete || record.error ? undefined : `claude exited with ${code} before finishing: ${stderr.slice(-200)}`)
    })
    send(options.prompts[0]!)
  })
}
