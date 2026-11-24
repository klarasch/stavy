// Stavy dev plugin — makes the viewer editable while the prototype's dev
// server runs. Dev only: it has no effect on `vite build`, and the viewer is
// read-only without it (static hosting, a published prototype).
//
//   // vite.config.ts
//   import stavy from "./scripts/stavy/vite-plugin.mjs"
//   export default defineConfig({ plugins: [react(), stavy()] })
//
// What it adds, all under /__stavy/:
//   GET    /__stavy/health          { ok, writable, rev, scan, refreshing, sourceChangedAt }
//                                   rev bumps on any content/manifest/snapshot change
//   PUT    /__stavy/content/<path>  write a file under stavy-content/ (boards, docs, notes, comments, assets)
//   DELETE /__stavy/content/<path>  remove one
//   POST   /__stavy/scan            { keys?: string[], all?: boolean } → re-capture those states in the background
//   GET    /__stavy/scan            the running / last scan
//   POST   /__stavy/visible         { keys: string[] } the cards the viewer has on screen (a heartbeat
//                                   too): out-of-date ones are re-captured; none for 10 s = nobody looking
//   PATCH  /__stavy/manifest        { path, value } → set ONE text field of stavy.json (titles, labels, notes;
//                                   see scripts/lib/patch.mjs for the allowed paths). Read fresh, set, write
//                                   back only the bytes of that value, so the diff is one line.
//   GET    /__stavy/rounds          { rounds } every review round (stavy-content/rounds/*.json); an old
//                                   comments.json is moved into rounds first
//   POST   /__stavy/rounds          { ops: [{ author, date, op }] } → apply comment / event / import operations
//                                   to the rounds on disk (scripts/lib/rounds.mjs). The only way comments are
//                                   written: content PUT/DELETE refuses rounds/ and comments.json.
//   GET    /__stavy/git-log         ?limit=20[&path=…] → [{ hash, date, author, subject }], [] outside a repo
// and, when stavy.json is not inside public/, serves /stavy.json and
// /stavy-content/** from where they are.
//
// Auto-refresh: when the app's source changes, it only notes when
// (sourceChangedAt). While a viewer is open it re-captures the cards on screen
// once the source has been quiet for a couple of seconds; other cards are
// out of date and get captured when they scroll into view (the viewer's
// visible report). No viewer open, nothing is captured. Captures run in one
// long-lived worker with its own Chromium (scripts/capture-worker.mjs), one job
// at a time, writing the index after each capture so cards update one by one.
// `stavy({ autoRefresh: { scope: "all" } })` also refreshes every other captured
// state in the background; `stavy({ autoRefresh: false })` turns it off.
//
// It never rewrites stavy.json wholesale or touches app code: the only change
// it makes to the screen registry is the single text field PATCH names, read
// fresh from disk, so hand edits and agent edits can't collide.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, watch, writeFileSync, createReadStream } from "node:fs"
import { dirname, extname, join, relative, resolve, sep } from "node:path"
import { execFile, execFileSync, spawn } from "node:child_process"
import { patchManifestText } from "./lib/patch.mjs"
import { createRefresher } from "./lib/refresh.mjs"
import { normalizeManifest, instanceKey, resolveDims, STATE_DIM } from "./lib/model.mjs"
import { FRAME_HOOK } from "./lib/gate.mjs"
import { ROUNDS_DIR, LEGACY_FILE } from "./lib/rounds.mjs"
import { applyOps, gitInfo, migrateLegacy, readRounds } from "./lib/rounds-fs.mjs"

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
 * @param {{ root?: string, manifest?: string, snapshots?: string, scanScript?: string, url?: string,
 *           autoRefresh?: boolean | { scope?: "visible" | "all", debounceMs?: number, ignore?: (string | RegExp)[] } }} [opts]
 *   root       folder holding stavy.json (default: public/ if public/stavy.json exists, else the project root)
 *   manifest   path to stavy.json (default: <root>/stavy.json)
 *   snapshots  folder scan writes snapshots to (default: <root>/snapshots)
 *   scanScript path to scan.mjs (default: scripts/stavy/scan.mjs, else scripts/scan.mjs); the
 *              capture worker is capture-worker.mjs beside it
 *   url        the dev server's own URL for scans (default: derived from the server)
 *   autoRefresh re-capture after the app's source changes (default: on, cards on screen only).
 *              `scope: "all"` also re-captures every other captured state; `debounceMs` (default 2000)
 *              is the quiet time after the last change; `ignore`: more paths (relative to the project,
 *              or RegExps) whose changes don't count as app changes
 */
export default function stavy(opts = {}) {
  const cwd = process.cwd()
  const root = resolve(opts.root ?? (existsSync(join(cwd, "public/stavy.json")) ? "public" : "."))
  const manifestPath = resolve(opts.manifest ?? join(root, "stavy.json"))
  const contentDir = join(dirname(manifestPath), "stavy-content")
  const snapshotsDir = resolve(opts.snapshots ?? join(dirname(manifestPath), "snapshots"))
  const snapshotsServedByPublic = snapshotsDir.startsWith(resolve(cwd, "public") + sep)
  const scanScript = resolve(opts.scanScript ?? (existsSync(join(cwd, "scripts/stavy/scan.mjs")) ? "scripts/stavy/scan.mjs" : "scripts/scan.mjs"))
  const workerScript = join(dirname(scanScript), "capture-worker.mjs")
  const servedByPublic = dirname(manifestPath).startsWith(resolve(cwd, "public"))

  let rev = Date.now()
  const bump = () => (rev = Date.now())
  /** @type {{ running: boolean, keys?: string[] | "all", startedAt?: string, finishedAt?: string, ok?: boolean, log: string }} */
  let scan = { running: false, log: "" }
  let serverUrl = opts.url ?? null
  const auto = opts.autoRefresh === false ? null : typeof opts.autoRefresh === "object" ? { ...opts.autoRefresh } : {}

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

  // One capture worker (a child process with its own Chromium) for the life of
  // the dev server; the refresher decides which job goes next. The worker quits
  // when idle or when we do, and starts again on demand. A crash of Chromium
  // takes down the worker, never the dev server.
  let logger = console
  let worker = null // { child, jobs: Map<id, (code) => void> }
  let jobId = 0
  const stopWorker = () => {
    const w = worker
    worker = null
    try {
      w?.child.stdin.end()
      w?.child.kill()
    } catch {
      /* already gone */
    }
  }
  const startWorker = () => {
    const child = spawn(process.execPath, [workerScript], { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] })
    const w = { child, jobs: new Map(), buf: "" }
    const line = (l) => {
      const done = l.match(/^@@done (\d+) (-?\d+)/)
      if (done) return w.jobs.get(Number(done[1]))?.(Number(done[2]))
      const gone = l.match(/^@@unavailable (.*)/)
      if (gone) {
        scan.log += l + "\n"
        // No browser to capture with: stop refreshing on every save, say so once.
        if (auto && !auto.off) {
          auto.off = true
          logger.warn("[stavy] auto-refresh off: capturing needs Playwright + Chromium (npx playwright install chromium)")
        }
        return
      }
      if (l.startsWith("@@")) return
      scan.log = (scan.log + l + "\n").slice(-8000)
    }
    child.stdout.on("data", (d) => {
      w.buf += d.toString()
      const parts = w.buf.split("\n")
      w.buf = parts.pop()
      parts.forEach(line)
      bump() // the scan writes its index after each capture: let the viewer look
    })
    child.stderr.on("data", (d) => (scan.log = (scan.log + d.toString()).slice(-8000)))
    child.on("error", () => {})
    child.stdin.on("error", () => {}) // the worker died: its close handler ends the job
    child.on("close", () => {
      if (worker === w) worker = null
      for (const finish of [...w.jobs.values()]) finish(1) // died mid-job
    })
    return w
  }
  const runJob = (keys, { background }) =>
    new Promise((done) => {
      scan = { running: true, keys, startedAt: new Date().toISOString(), log: "" }
      const w = (worker ??= startWorker())
      const id = ++jobId
      w.jobs.set(id, (code) => {
        w.jobs.delete(id)
        scan = { ...scan, running: false, ok: code === 0, finishedAt: new Date().toISOString() }
        bump()
        done(code)
      })
      const job = { id, manifestPath, url: serverUrl ?? "http://localhost:5173", out: snapshotsDir }
      if (keys === "all") job.all = true
      else job.keys = keys.join(",")
      if (background) job.workers = 2
      try {
        w.child.stdin.write(JSON.stringify(job) + "\n")
      } catch {
        w.jobs.get(id)?.(1)
      }
    })
  /** The snapshot index as it is on disk. */
  const readIndex = () => {
    try {
      return JSON.parse(readFileSync(join(snapshotsDir, "index.json"), "utf8"))
    } catch {
      return {}
    }
  }
  const refresher = createRefresher({
    run: runJob,
    capturedKeys: () => Object.keys(readIndex()),
    capturedAt: (k) => {
      const e = readIndex()[k]
      return e ? e.checkedAt ?? e.at : null
    },
    scope: auto?.scope === "all" ? "all" : "visible",
    debounceMs: auto?.debounceMs ?? 2000,
  })

  /**
   * What "ready" records: the date, who (git user.name), and each covered
   * state's snapshot hash right now, so the viewer can say when a screen
   * changed after it was marked ready.
   */
  let user
  const gitUser = () => {
    if (user === undefined) {
      try {
        user = execFileSync("git", ["config", "user.name"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null
      } catch {
        user = null // no git identity
      }
    }
    return user
  }
  const readyMeta = (m, path) => {
    const meta = { at: new Date().toISOString().slice(0, 10) }
    if (gitUser()) meta.by = gitUser()
    try {
      const index = JSON.parse(readFileSync(join(snapshotsDir, "index.json"), "utf8"))
      const norm = normalizeManifest(JSON.parse(JSON.stringify(m)))
      const page = norm.pages.find((p) => p.id === path[1])
      if (page) {
        const insts = path[2] === "states" ? [{ dims: { [STATE_DIM]: path[3] } }] : page.instances ?? [{ dims: {} }]
        const snapshots = {}
        for (const inst of insts) {
          const key = instanceKey(page.id, resolveDims(page, inst.dims))
          if (index[key]?.hash) snapshots[key] = index[key].hash
        }
        if (Object.keys(snapshots).length) meta.snapshots = snapshots
      }
    } catch {
      /* no scan yet: ready without a baseline */
    }
    return meta
  }

  // The commit and branch the dev server runs on (asked at most every few seconds).
  let git = { at: 0, info: {} }
  const gitNow = () => {
    if (Date.now() - git.at > 4000) git = { at: Date.now(), info: gitInfo(dirname(manifestPath)) }
    return git.info
  }
  /** An old comments.json becomes rounds the first time anything asks for them. */
  const migrateComments = () => {
    const r = migrateLegacy(contentDir)
    if (r?.ok) logger.info(`[stavy] moved ${r.comments} comment(s) from ${LEGACY_FILE} into ${r.rounds.length} round file(s) in stavy-content/${ROUNDS_DIR}/`)
    else if (r) logger.warn(`[stavy] ${r.error}`)
  }

  /**
   * Count a change as the app's when it isn't Stavy's own output or tooling:
   * content, snapshots, the manifest, build output, tests and docs don't.
   */
  const watchSource = (server) => {
    const publicDir = resolve(cwd, "public")
    // A built viewer in public/<dir>/ (it has a VERSION file) isn't the app either.
    let viewerDirs = []
    try {
      viewerDirs = readdirSync(publicDir).map((d) => join(publicDir, d)).filter((d) => existsSync(join(d, "VERSION")))
    } catch {
      /* no public/ */
    }
    const under = (file, dir) => file === dir || file.startsWith(dir + sep)
    const extra = (auto.ignore ?? []).map((x) => (x instanceof RegExp ? x : resolve(cwd, x)))
    const ignored = (file) => {
      const f = resolve(file)
      if (!under(f, cwd)) return true
      if (f === manifestPath || under(f, contentDir) || under(f, snapshotsDir) || viewerDirs.some((d) => under(f, d))) return true
      const rel = relative(cwd, f).split(sep).join("/")
      if (under(f, dirname(scanScript))) return true // Stavy's own scripts
      if (/(^|\/)(node_modules|\.git|\.stavy)\//.test(rel)) return true
      if (/^(dist[^/]*|test-results|playwright-report|coverage|tests?|e2e|docs)\//.test(rel)) return true
      if (/\.(md|log)$/i.test(rel) || /(^|\/)\.DS_Store$/.test(rel)) return true
      return extra.some((x) => (x instanceof RegExp ? x.test(rel) : under(f, x)))
    }
    const changed = (file) => {
      if (auto.off || ignored(file)) return
      refresher.sourceChanged()
    }
    server.watcher.on("change", changed)
    server.watcher.on("add", changed)
    server.watcher.on("unlink", changed)
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
      logger = server.config.logger ?? console
      server.httpServer?.once("close", stopWorker)
      process.once("exit", stopWorker)
      if (auto) watchSource(server)
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
          if (route === "health") {
            const r = refresher.status()
            return json(res, 200, {
              ok: true,
              writable: true,
              rev,
              user: gitUser(),
              ...gitNow(),
              scan: { running: scan.running, ok: scan.ok, finishedAt: scan.finishedAt },
              autoRefresh: !!auto && !auto.off,
              refreshing: r.refreshing,
              sourceChangedAt: r.sourceChangedAt,
            })
          }
          if (route === "visible") {
            if (req.method !== "POST") return json(res, 405, { ok: false })
            const body = JSON.parse((await readBody(req)).toString() || "{}")
            const keys = Array.isArray(body.keys) ? body.keys.filter((k) => typeof k === "string" && k.length < 2000) : []
            refresher.setVisible(keys)
            return json(res, 200, { ok: true })
          }
          if (route === "scan") {
            if (req.method === "GET") return json(res, 200, scan)
            if (req.method !== "POST") return json(res, 405, { ok: false })
            const body = JSON.parse((await readBody(req)).toString() || "{}")
            const keys = body.all ? "all" : Array.isArray(body.keys) ? body.keys.filter((k) => typeof k === "string") : []
            if (keys !== "all" && keys.length === 0) return json(res, 400, { ok: false, error: "keys or all required" })
            const queued = scan.running
            refresher.request(keys)
            return json(res, 202, { ok: true, queued })
          }
          if (route === "manifest") {
            if (req.method !== "PATCH") return json(res, 405, { ok: false })
            const body = JSON.parse((await readBody(req)).toString() || "{}")
            const raw = readFileSync(manifestPath, "utf8")
            const ready = body.path?.at?.(-1) === "status" && body.value === "ready" ? readyMeta(JSON.parse(raw), body.path) : undefined
            // Throws (→ 400) for anything but the allowed text fields.
            const r = patchManifestText(raw, body.path, body.value, { ready })
            // `text` changes only the edited value's bytes. When that edit can't be
            // made (it never should), fall back to rewriting the whole file.
            writeFileSync(manifestPath, r.text ?? JSON.stringify(r.manifest, null, 2) + (raw.endsWith("\n") ? "\n" : ""))
            bump()
            return json(res, 200, { ok: true, rev })
          }
          if (route === "rounds") {
            if (req.method === "POST") {
              const body = JSON.parse((await readBody(req)).toString() || "{}")
              const ops = (Array.isArray(body.ops) ? body.ops : []).filter((o) => o && typeof o === "object" && o.op)
              migrateComments()
              const r = applyOps(contentDir, ops, gitNow())
              bump()
              return json(res, 200, { ok: true, rounds: r.rounds, written: r.written })
            }
            if (req.method !== "GET") return json(res, 405, { ok: false })
            migrateComments()
            return json(res, 200, { ok: true, rounds: readRounds(contentDir).rounds, ...gitNow() })
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
            // Comments are only ever changed one operation at a time (POST /__stavy/rounds), never as a whole file.
            const relPath = relative(contentDir, file).split(sep).join("/")
            if (relPath === LEGACY_FILE || relPath === ROUNDS_DIR || relPath.startsWith(ROUNDS_DIR + "/"))
              return json(res, 400, { ok: false, error: "review rounds are written through /__stavy/rounds" })
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
