import { memo, useContext, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { InstanceCard } from "../canvas/InstanceCard"
import { CanvasInspectContext, useLiveWhenVisible } from "../canvas/visibility"
import { settleFrame } from "../frame"
import { cropBox, replayActions, replaysLive } from "./liveVariant"
import { appUrl, frameOf, pageUrl, snapshotIndex } from "../manifest"
import { useScan, useUpdating } from "../snapshots"
import { cn } from "../cn"
import { snapshotHref, type ResolvedShot } from "./resolve"
import { useSnapshotsRev } from "./store"

/**
 * One state as a card on a board. A plain state is the map's own
 * `InstanceCard` (snapshot, opens the player, live frame on demand). A
 * *variant* — cropped to a target, acted on (`do`), or at another viewport —
 * has its own capture keyed by `variantKey`: the image, or a placeholder with
 * a Capture button. Inspecting it mounts the real app with the actions
 * replayed and the frame placed on the crop (see liveVariant.ts).
 */
export const ShotCard = memo(function ShotCard({
  shot,
  width,
  extra,
  wireframe = false,
}: {
  shot: ResolvedShot
  width: number
  /** Extra query params for the player link (tour, step…) */
  extra?: Record<string, string>
  wireframe?: boolean
}) {
  useSnapshotsRev()
  const linkExtra = { ...(extra ?? {}), ...(wireframe ? { w: "1" } : {}) }
  const href = pageUrl(shot.page.id, shot.dims, linkExtra)
  if (!shot.variant) {
    const fr = frameOf(shot.page)
    return <InstanceCard pageId={shot.page.id} dims={shot.dims} scale={width / fr.width} frame={shot.page.frame} href={href} wireframe={wireframe} />
  }
  return <VariantCard shot={shot} width={width} href={href} />
})

function VariantCard({ shot, width, href }: { shot: ResolvedShot; width: number; href: string }) {
  const navigate = useNavigate()
  const scan = useScan([shot.key])
  const entry = snapshotIndex[shot.key]
  const url = snapshotHref(entry)
  const [err, setErr] = useState(false)
  useEffect(() => setErr(false), [url])
  const fr = shot.variant?.viewport ?? frameOf(shot.page)
  const aspect = entry ? entry.height / entry.width : shot.variant?.crop ? 0.45 : fr.height / fr.width
  const h = Math.round(width * aspect)
  const missing = !url || err
  const updating = useUpdating(entry)

  // Live like the map's cards: while the inspector hovers this card (or holds
  // a selection in it), or in live mode near the viewport, the real app runs
  // underneath — the actions replayed, the frame placed on the crop — so the
  // inspector reads real DOM instead of a screenshot.
  const frameRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const inspect = useContext(CanvasInspectContext)
  const near = useLiveWhenVisible(frameRef)
  const [hover, setHover] = useState(false)
  const hoverT = useRef<ReturnType<typeof setTimeout> | null>(null)
  const enter = () => {
    if (hoverT.current) clearTimeout(hoverT.current)
    hoverT.current = setTimeout(() => setHover(true), 140)
  }
  const leave = () => {
    if (hoverT.current) clearTimeout(hoverT.current)
    hoverT.current = setTimeout(() => setHover(false), 600)
  }
  useEffect(() => () => { if (hoverT.current) clearTimeout(hoverT.current) }, [])
  const held = !!inspect.hold && inspect.hold === iframeRef.current
  // A variant that types or presses keys keeps its snapshot: replaying it on every hover could change data.
  const canLive = replaysLive(shot.variant?.do)
  const live = canLive && ((inspect.on && (hover || held)) || (inspect.live && near))
  const [place, setPlace] = useState<{ x: number; y: number; k: number; h: number } | null>(null)
  useEffect(() => {
    if (!live) setPlace(null)
  }, [live])
  const onLoad = async () => {
    const iframe = iframeRef.current
    if (!iframe) return
    await settleFrame(iframe)
    await replayActions(iframe, shot.variant?.do)
    const box = shot.variant?.crop ? cropBox(iframe, shot.variant.crop, fr) : null
    if (iframeRef.current !== iframe) return
    setPlace(box ? { x: box.x, y: box.y, k: width / box.width, h: Math.round((box.height * width) / box.width) } : { x: 0, y: 0, k: width / fr.width, h: Math.round((fr.height * width) / fr.width) })
  }

  return (
    <div
      className="ps flex flex-col gap-1.5"
      style={{ width }}
      data-instance={shot.key}
      onPointerEnter={inspect.on ? enter : undefined}
      onPointerLeave={inspect.on ? leave : undefined}
    >
      <div
        ref={frameRef}
        className={cn("ps-card-frame relative rounded-lg overflow-hidden cursor-zoom-in", missing ? "ps-shot-missing" : "bg-white")}
        style={{ width, height: !entry && place ? place.h : h }}
      >
        {live && (
          <iframe
            ref={iframeRef}
            className={cn("ps-frame ps-card-live", place && "is-ready")}
            title={`${shot.page.label} · ${shot.label}`}
            src={appUrl(shot.page, shot.dims)}
            tabIndex={-1}
            style={{
              width: fr.width,
              height: fr.height,
              transform: place ? `scale(${place.k}) translate(${-place.x}px, ${-place.y}px)` : `scale(${width / fr.width})`,
              opacity: place ? 1 : 0,
            }}
            onLoad={() => void onLoad()}
          />
        )}
        {missing ? (
          <div className="ps-card-placeholder absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 text-center">
            <span className="text-[11.5px] font-medium" style={{ color: "var(--ps-muted)" }}>
              {shot.page.label} · {shot.label}
            </span>
            <span className="text-[10.5px] ps-mono" style={{ color: "var(--ps-faint)" }}>
              {[shot.variant?.crop && `crop ${shot.variant.crop}`, shot.variant?.do?.length && `${shot.variant.do.length} action${shot.variant.do.length > 1 ? "s" : ""}`, shot.variant?.viewport && `${shot.variant.viewport.width}×${shot.variant.viewport.height}`]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        ) : (
          <img className="ps-card-img" src={url!} alt={`${shot.page.label} · ${shot.label}`} draggable={false} loading="lazy" onError={() => setErr(true)} />
        )}
        {/* The shield: cards are static previews — click opens the player; the inspector hit-tests through it. */}
        <div className="ps-card-shield" onClick={() => navigate(href)} />
        {missing && scan.writable && !place && (
          <button
            type="button"
            className="ps-btn ps-capture absolute left-1/2 bottom-3 -translate-x-1/2 z-[2]"
            data-ps-ui
            disabled={scan.busy}
            onClick={(e) => {
              e.stopPropagation()
              scan.start()
            }}
          >
            {scan.busy ? <span className="ps-spinner" /> : null}
            {scan.busy ? "Capturing" : "Capture"}
          </button>
        )}
        {updating && !missing && <span className="ps-card-updating" data-ps-ui title="Updating after a code change"><span className="ps-spinner" /></span>}
      </div>
    </div>
  )
}
