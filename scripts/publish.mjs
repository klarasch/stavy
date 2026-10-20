#!/usr/bin/env node
// Stavy publish — make a static build that carries its own snapshots.
//
// Snapshots are a cache and stay out of git, so a deployable build has to make
// them: build the app, serve the build on a local port, capture every state
// against it (the same scan the dev viewer uses, `--all`), and write the
// snapshots into the build output. The result is plain static files — the
// prototype, the viewer, stavy.json, stavy-content/ and snapshots/ — that any
// static host serves. The published viewer is read-only: editing needs the dev
// server; reviewers' comments stay in their browser and travel as a link or a
// .md file the designer imports locally.
//
//   node scripts/stavy/publish.mjs [--build "npm run build"] [--dist dist] [--base /] [--port 4179] [--skip-build]
//
//   --build       the app's build command (default: npm run build)
//   --dist        the build output folder (default: dist)
//   --base        path the app is served under, as in the build's base (default: /)
//   --port        local port for the capture (default: 4179)
//   --skip-build  capture against an existing build
// Any other flags go to scan (e.g. --workers 6, --strict).
import { createServer } from "node:http"
import { createReadStream, existsSync, statSync } from "node:fs"
import { extname, join, resolve, sep, dirname } from "node:path"
import { spawnSync, spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const argv = process.argv.slice(2)
const OWN = new Set(["--build", "--dist", "--base", "--port"])
const opt = (name, def) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : def
}
const buildCmd = opt("--build", "npm run build")
const dist = resolve(opt("--dist", "dist"))
const base = ("/" + opt("--base", "/").replace(/^\/+|\/+$/g, "")).replace(/\/$/, "") // "" or "/x"
const port = Number(opt("--port", 4179))
const skipBuild = argv.includes("--skip-build")
const passThrough = argv.filter((a, i) => !OWN.has(a) && !OWN.has(argv[i - 1]) && a !== "--skip-build")

const say = (s) => console.log(`publish: ${s}`)

if (!skipBuild) {
  say(`building — ${buildCmd}`)
  const r = spawnSync(buildCmd, { shell: true, stdio: "inherit" })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
const manifest = join(dist, "stavy.json")
if (!existsSync(manifest)) {
  console.error(`publish: ${manifest} not found — is --dist right, and does the build copy public/ (stavy.json, stavy/, stavy-content/)?`)
  process.exit(1)
}

/* ---------------- a minimal static server for the build ---------------- */
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".md": "text/markdown; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
}
const server = createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)
  if (base && path.startsWith(base)) path = path.slice(base.length) || "/"
  let file = resolve(dist, "." + path)
  if (file !== dist && !file.startsWith(dist + sep)) return res.writeHead(403).end()
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html")
  // Client-side routes fall back to the app's index, as a static host's SPA rewrite would.
  if (!existsSync(file)) file = extname(path) ? "" : join(dist, "index.html")
  if (!file || !existsSync(file)) return res.writeHead(404).end()
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" })
  createReadStream(file).pipe(res)
})
await new Promise((ok) => server.listen(port, ok))
say(`serving ${dist} at http://localhost:${port}${base || "/"}`)

/* ---------------- capture every state into the build ---------------- */
const here = dirname(fileURLToPath(import.meta.url))
const scan = existsSync(join(here, "scan.mjs")) ? join(here, "scan.mjs") : resolve("scripts/stavy/scan.mjs")
const args = [scan, manifest, "--url", `http://localhost:${port}`, ...(base ? ["--app", base] : []), "--out", join(dist, "snapshots"), "--all", ...passThrough]
const code = await new Promise((ok) => spawn(process.execPath, args, { stdio: "inherit" }).on("close", ok))
server.close()
if (code !== 0) {
  console.error("publish: the capture failed — the build is not ready to deploy")
  process.exit(code ?? 1)
}
say(`done — deploy ${dist} to any static host. The viewer is at ${base || ""}/stavy/ (read-only there).`)
