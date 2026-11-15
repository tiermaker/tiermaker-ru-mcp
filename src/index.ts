#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { resolveBaseUrl, resolveShortLinks } from "./config.js"
import { createServer } from "./tools.js"

async function main() {
  const server = createServer({ baseUrl: resolveBaseUrl(), shortLinks: resolveShortLinks() })
  await server.connect(new StdioServerTransport())
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
