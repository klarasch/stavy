import { memo, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { InstanceCard } from "../canvas/InstanceCard"
import { frameOf, pageUrl, snapshotIndex } from "../manifest"
import { useScan } from "../snapshots"
import { cn } from "../cn"
import { snapshotHref, type ResolvedShot } from "./resolve"
import { useSnapshotsRev } from "./store"

/**
 * One state as a card on a board. A plain state is the map's own
 * `InstanceCard` (snapshot, opens the player, live frame on demand). A
 * *variant* — cropped to a target, acted on (`do`), or at another viewport —
 * has its own capture keyed by `variantKey`, so it gets a lighter card that
 * only knows that capture: the image, or a clean placeholder with the label
 * and, when the dev endpoint can scan, a Capture button.
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

  return (
    <div className="ps flex flex-col gap-1.5" style={{ width }} data-instance={shot.key}>
      <div
        className={cn("ps-card-frame relative rounded-lg overflow-hidden cursor-zoom-in", missing ? "ps-shot-missing" : "bg-white")}
        style={{ width, height: h }}
        onClick={() => navigate(href)}
      >
        {missing ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 text-center">
            <span className="text-[11.5px] font-medium" style={{ color: "var(--ps-muted)" }}>
              {shot.page.label} · {shot.label}
            </span>
            <span className="text-[10.5px] ps-mono" style={{ color: "var(--ps-faint)" }}>
              {[shot.variant?.crop && `crop ${shot.variant.crop}`, shot.variant?.do?.length && `${shot.variant.do.length} action${shot.variant.do.length > 1 ? "s" : ""}`, shot.variant?.viewport && `${shot.variant.viewport.width}×${shot.variant.viewport.height}`]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {scan.writable && (
              <button
                type="button"
                className="ps-btn ps-capture"
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
          </div>
        ) : (
          <img className="ps-card-img" src={url!} alt={`${shot.page.label} · ${shot.label}`} draggable={false} loading="lazy" onError={() => setErr(true)} />
        )}
      </div>
    </div>
  )
}
