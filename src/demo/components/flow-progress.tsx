import type { PageProps } from "@/stavy/types"
import { FlowProgress } from "../organisms/FlowProgress"

export default function FlowProgressComponent({ dims }: PageProps) {
  return (
    <div className="min-h-full bg-muted/40 p-6">
      <div className="max-w-xl bg-background rounded-xl border p-5">
        <FlowProgress step={dims.step} locale={dims.locale} />
      </div>
    </div>
  )
}
