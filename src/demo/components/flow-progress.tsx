// Harness route for the "flow-progress" component page: renders the organism
// alone, reading its dims from the URL like every other Orbit route.
import { useDims } from "../app/dims"
import { FlowProgress } from "../organisms/FlowProgress"

const DEFAULTS = { step: "details" }

export default function FlowProgressComponent() {
  const dims = useDims(DEFAULTS)
  return (
    <div className="min-h-full bg-muted/40 p-6">
      <div className="max-w-xl bg-background rounded-xl border p-5">
        <FlowProgress step={dims.step} locale={dims.locale} />
      </div>
    </div>
  )
}
