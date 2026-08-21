import { Suspense } from "react"
import { PsSkeleton } from "./chrome"
import { pageComponents } from "./registry"
import type { PageProps } from "./types"

export function PageRenderer({ pageId, dims, nav }: { pageId: string } & PageProps) {
  const Comp = pageComponents[pageId]
  if (!Comp) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Page <code className="font-mono">{pageId}</code> is not part of this build slice.
      </div>
    )
  }
  return (
    <Suspense fallback={<div className="p-8"><PsSkeleton style={{ height: 256, width: "100%" }} /></div>}>
      <Comp dims={dims} nav={nav} />
    </Suspense>
  )
}
