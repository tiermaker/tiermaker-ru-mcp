import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

/** Starts the MCP entry the way the agent will and lists its tools; throws a readable error if it does not come up. */
export async function preflightMcp(entry: string, baseUrl: string, timeoutMs = 20_000): Promise<string[]> {
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { ...(process.env as Record<string, string>), TIERMAKER_BASE_URL: baseUrl }, stderr: "pipe" })
  const client = new Client({ name: "evals-preflight", version: "0" })
  let stderr = ""
  transport.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")))
  try {
    await Promise.race([
      client.connect(transport),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`no answer in ${timeoutMs / 1000} s`)), timeoutMs)),
    ])
    const { tools } = await client.listTools()
    const names = tools.map((tool) => tool.name)
    if (!names.includes("create_tierlist")) throw new Error(`unexpected tools: ${names.join(", ")}`)
    return names
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `The MCP server (${entry}) does not start: ${reason}${stderr.trim() ? `\n${stderr.trim().slice(-400)}` : ""}\n` +
        "Build it (`npm run build`) and run the evals with node_modules installed for THIS OS: the native @resvg/resvg-js binary " +
        "differs between Linux (Docker) and macOS. On a Mac use a copy installed with `npm ci` on the host and point EVAL_MCP_ENTRY at its dist/index.js.",
    )
  } finally {
    await client.close().catch(() => undefined)
  }
}

/** Reason the tiermaker MCP server is unusable according to the session init event, if it is. */
export function mcpInitError(event: Record<string, unknown>): string | undefined {
  if (event.type !== "system" || event.subtype !== "init") return undefined
  const servers = (event.mcp_servers ?? []) as Array<{ name?: string; status?: string }>
  const server = servers.find((entry) => entry.name === "tiermaker")
  if (!server) return "MCP server tiermaker is missing from the session"
  if (server.status && ["failed", "needs-auth", "disabled"].includes(server.status)) return `MCP server tiermaker is ${server.status ?? "not connected"} (infrastructure error, not an agent result)`
  return undefined
}
