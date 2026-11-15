import { readFileSync } from "node:fs"

type Pkg = { version: string; homepage: string; bugs: { url: string } }

// dist/config.js sits one level below package.json, the evals build (dist-evals/src/config.js) two.
function readPackage(): Pkg {
  for (const path of ["../package.json", "../../package.json"]) {
    try {
      return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as Pkg
    } catch {
      // try the next location
    }
  }
  throw new Error("package.json not found next to the build")
}

const pkg = readPackage()

export const VERSION: string = pkg.version

/** Wikimedia policy: tool name/version plus a URL and a contact. Both come from package.json. */
export const USER_AGENT = `tiermaker-ru-mcp/${VERSION} (+${pkg.homepage}; ${pkg.bugs.url})`
export const DEFAULT_BASE_URL = "https://tiermaker.ru"

export function resolveBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.TIERMAKER_BASE_URL?.trim() || DEFAULT_BASE_URL
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`TIERMAKER_BASE_URL "${raw}" is not a valid URL.`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("TIERMAKER_BASE_URL must be http(s).")
  return url.origin
}

/** Short links store the board on the site; `TIERMAKER_SHORT_LINKS=0` keeps boards local (long #tm= links only). */
export function resolveShortLinks(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.TIERMAKER_SHORT_LINKS?.trim().toLowerCase()
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "no")
}
