// Stavy dev plugin — makes the viewer editable while the prototype's dev
// server runs. Dev only: it has no effect on `vite build`, and the viewer is
// read-only without it (static hosting, a published prototype).
//
//   // vite.config.ts
//   import stavy from "./scripts/stavy/vite-plugin.mjs"
//   export default defineConfig({ plugins: [react(), stavy()] })
//
// What it adds, all under /__stavy/:
//   GET    /__stavy/health          { ok, writable, rev, scan }   rev bumps on any content/manifest/snapshot change
//   PUT    /__stavy/content/<path>  write a file under stavy-content/ (boards, docs, notes, comments, assets)
//   DELETE /__stavy/content/<path>  remove one
//   POST   /__stavy/scan            { keys?: string[], all?: boolean } → re-capture those states in the background
//   GET    /__stavy/scan            the running / last scan
//   PATCH  /__stavy/manifest        { path, value } → set ONE text field of stavy.json (titles, labels, notes;
//                                   see scripts/lib/patch.mjs for the allowed paths). Read fresh, set, write back.
//   GET    /__stavy/git-log         ?limit=20[&path=…] → [{ hash, date, author, subject }], [] outside a repo
// and, when stavy.json is not inside public/, serves /stavy.json and
// /stavy-content/** from where they are.
//
// It never rewrites stavy.json wholesale or touches app code: the only change
// it makes to the screen registry is the single text field PATCH names, read
// fresh from disk, so hand edits and agent edits can't collide.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, watch, writeFileSync, createReadStream } from "node:fs"
import { dirname, extname, join, relative, resolve, sep } from "node:path"
import { execFile, spawn } from "node:child_process"
import { applyPatch } from "./lib/patch.mjs"
import { FRAME_HOOK } from "./lib/gate.mjs"

const MAX_BODY = 15 * 1024 * 1024
const TYPES = {
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
}

/**
 * @param {{ root?: string, manifest?: string, snapshots?: string, scanScript?: string, url?: string }} [opts]
 *   root       folder holding stavy.json (default: public/ if public/stavy.json exists, else the project root)
 *   manifest   path to stavy.json (default: <root>/stavy.json)
 *   snapshots  folder scan writes snapshots to (default: <root>/snapshots)
 *   scanScript path to scan.mjs (default: scripts/stavy/scan.mjs, else scripts/scan.mjs)
 *   url        the dev server's own URL for scans (default: derived from the server)
 */
export default function stavy(opts = {}) {
  const cwd = process.cwd()
  const root = resolve(opts.root ?? (existsSync(join(cwd, "public/stavy.json")) ? "public" : "."))
  const manifestPath = resolve(opts.manifest ?? join(root, "stavy.json"))
  const contentDir = join(dirname(manifestPath), "stavy-content")
  const snapshotsDir = resolve(opts.snapshots ?? join(dirname(manifestPath), "snapshots"))
  const snapshotsServedByPublic = snapshotsDir.startsWith(resolve(cwd, "public") + sep)
  const scanScript = resolve(opts.scanScript ?? (existsSync(join(cwd, "scripts/stavy/scan.mjs")) ? "scripts/stavy/scan.mjs" : "scripts/scan.mjs"))
  const servedByPublic = dirname(manifestPath).startsWith(resolve(cwd, "public"))

  let rev = Date.now()
  const bump = () => (rev = Date.now())
  /** @type {{ running: boolean, keys?: string[] | "all", startedAt?: string, finishedAt?: string, ok?: boolean, log: string }} */
  let scan = { running: false, log: "" }
  let queued = null
  let serverUrl = opts.url ?? null

  const json = (res, code, body) => {
    res.statusCode = code
    res.setHeader("content-type", "application/json")
    res.setHeader("cache-control", "no-store")
    res.end(JSON.stringify(body))
  }
  const readBody = (req) =>
    new Promise((ok, fail) => {
      const chunks = []
      let size = 0
      req.on("data", (c) => {
        size += c.length
        if (size > MAX_BODY) {
          fail(new Error("payload too large"))
          req.destroy()
        } else chunks.push(c)
      })
      req.on("end", () => ok(Buffer.concat(chunks)))
      req.on("error", fail)
    })
  /** A path inside stavy-content, or null if it escapes it. */
  const contentPath = (rel) => {
    const p = resolve(contentDir, decodeURIComponent(rel).replace(/^\/+/, ""))
    return p === contentDir || p.startsWith(contentDir + sep) ? p : null
  }

  const runScan = (keys) => {
    if (scan.running) {
      queued = keys === "all" || queued === "all" ? "all" : [...new Set([...(queued ?? []), ...keys])]
      return
    }
    const args = [scanScript, manifestPath, "--url", serverUrl ?? "http://localhost:5173", "--out", snapshotsDir]
    if (keys === "all") args.push("--all")
    else args.push("--keys", keys.join(","))
    scan = { running: true, keys, startedAt: new Date().toISOString(), log: "" }
    const child = spawn(process.execPath, args, { cwd, env: process.env })
    const take = (d) => (scan.log = (scan.log + d.toString()).slice(-8000))
    child.stdout.on("data", take)
    child.stderr.on("data", take)
    child.on("close", (code) => {
      scan = { ...scan, running: false, ok: code === 0, finishedAt: new Date().toISOString() }
      bump()
      if (queued) {
        const next = queued
        queued = null
        runScan(next)
      }
    })
  }

  return {
    name: "stavy",
    apply: "serve",
    // A one-line hook at the top of the app's <head>: inside a Stavy frame it
    // lets the viewer hold a tour step's spinner or toast from the first timer
    // (see lib/gate.mjs). Outside a frame it does nothing.
    transformIndexHtml: {
      order: "pre",
      handler: () => [{ tag: "script", children: FRAME_HOOK.replace(/^<script>|<\/script>$/g, ""), injectTo: "head-prepend" }],
    },
    configureServer(server) {
      for (const dir of [contentDir, snapshotsDir, dirname(manifestPath)]) {
        try {
          if (existsSync(dir)) watch(dir, { recursive: dir !== dirname(manifestPath) }, (_e, f) => {
            if (dir !== dirname(manifestPath) || String(f).endsWith("stavy.json")) bump()
          })
        } catch {
          /* recursive watch unsupported: health rev only bumps on our own writes */
        }
      }
      server.httpServer?.once("listening", () => {
        if (serverUrl) return
        const a = server.httpServer.address()
        const base = (server.config.base ?? "/").replace(/\/$/, "")
        if (a && typeof a === "object") serverUrl = `http://localhost:${a.port}${base}`
      })

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://x")
        const path = url.pathname
        const at = path.indexOf("/__stavy/")
        if (at === -1) {
          // The viewer is a folder in public/ (public/stavy/index.html). Vite serves
          // folder indexes only for the app's own index, so /stavy and /stavy/ (and
          // any /stavy/?p=… deep link reloaded) would fall through to the app's
          // router. Serve the viewer's index for its folder; redirect the slashless form.
          if (req.method === "GET" && !extname(path)) {
            const base = (server.config.base ?? "/").replace(/\/$/, "")
            const rel = path.startsWith(base) ? path.slice(base.length) : path
            const dir = join(resolve(cwd, "public"), decodeURIComponent(rel))
            const index = join(dir, "index.html")
            if (dir.startsWith(resolve(cwd, "public") + sep) && existsSync(join(dir, "VERSION")) && existsSync(index)) {
              if (!path.endsWith("/")) {
                res.statusCode = 302
                res.setHeader("location", `${path}/${url.search}`)
                return res.end()
              }
              res.setHeader("content-type", "text/html; charset=utf-8")
              res.setHeader("cache-control", "no-store")
              return res.end(readFileSync(index))
            }
          }
          // Snapshots kept outside public/ (the default, .stavy/snapshots) are served from here.
          if (!snapshotsServedByPublic) {
            const si = path.indexOf("/snapshots/")
            const file = si !== -1 ? join(snapshotsDir, decodeURIComponent(path.slice(si + "/snapshots/".length))) : null
            if (file && file.startsWith(snapshotsDir + sep) && existsSync(file) && statSync(file).isFile()) {
              res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream")
              res.setHeader("cache-control", "no-store")
              return createReadStream(file).pipe(res)
            }
          }
          if (!servedByPublic) {
            if (path.endsWith("/stavy.json") && existsSync(manifestPath)) {
              res.setHeader("content-type", "application/json")
              res.setHeader("cache-control", "no-store")
              return res.end(readFileSync(manifestPath))
            }
            const ci = path.indexOf("/stavy-content/")
            const file = ci !== -1 ? contentPath(path.slice(ci + "/stavy-content/".length)) : null
            if (file && file.startsWith(contentDir) && existsSync(file) && statSync(file).isFile()) {
              res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream")
              res.setHeader("cache-control", "no-store")
              return createReadStream(file).pipe(res)
            }
          }
          return next()
        }
        const route = path.slice(at + "/__stavy/".length)
        try {
          if (route === "health") return json(res, 200, { ok: true, writable: true, rev, scan: { running: scan.running, ok: scan.ok, finishedAt: scan.finishedAt } })
          if (route === "scan") {
            if (req.method === "GET") return json(res, 200, scan)
            if (req.method !== "POST") return json(res, 405, { ok: false })
            const body = JSON.parse((await readBody(req)).toString() || "{}")
            const keys = body.all ? "all" : Array.isArray(body.keys) ? body.keys.filter((k) => typeof k === "string") : []
            if (keys !== "all" && keys.length === 0) return json(res, 400, { ok: false, error: "keys or all required" })
            runScan(keys)
            return json(res, 202, { ok: true, queued: scan.running })
          }
          if (route === "manifest") {
            if (req.method !== "PATCH") return json(res, 405, { ok: false })
            const body = JSON.parse((await readBody(req)).toString() || "{}")
            const raw = readFileSync(manifestPath, "utf8")
            const m = JSON.parse(raw)
            applyPatch(m, body.path, body.value) // throws (→ 400) for anything but the allowed text fields
            writeFileSync(manifestPath, JSON.stringify(m, null, 2) + (raw.endsWith("\n") ? "\n" : ""))
            bump()
            return json(res, 200, { ok: true, rev })
          }
          if (route === "git-log") {
            if (req.method !== "GET") return json(res, 405, { ok: false })
            const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20))
            const sub = url.searchParams.get("path")
            const args = ["log", `-n${limit}`, "--pretty=format:%H%x1f%aI%x1f%an%x1f%s"]
            if (sub) args.push("--", sub)
            const out = await new Promise((ok) =>
              execFile("git", args, { cwd: dirname(manifestPath), maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => ok(err ? "" : stdout)),
            )
            const rows = out
              .split("\n")
              .filter(Boolean)
              .map((l) => {
                const [hash, date, author, subject] = l.split("\x1f")
                return { hash, date, author, subject }
              })
            return json(res, 200, rows)
          }
          if (route.startsWith("content/")) {
            const file = contentPath(route.slice("content/".length))
            if (!file || file === contentDir) return json(res, 400, { ok: false, error: "path must be inside stavy-content/" })
            if (req.method === "DELETE") {
              if (existsSync(file)) rmSync(file)
              bump()
              return json(res, 200, { ok: true })
            }
            if (req.method !== "PUT" && req.method !== "POST") return json(res, 405, { ok: false })
            const body = await readBody(req)
            if (extname(file) === ".json") JSON.parse(body.toString()) // refuse malformed JSON
            mkdirSync(dirname(file), { recursive: true })
            writeFileSync(file, body)
            bump()
            return json(res, 200, { ok: true, path: relative(dirname(manifestPath), file) })
          }
          return json(res, 404, { ok: false })
        } catch (e) {
          return json(res, 400, { ok: false, error: String(e?.message ?? e) })
        }
      })
    },
  }
}
