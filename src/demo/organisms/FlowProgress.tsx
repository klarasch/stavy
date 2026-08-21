import { Check } from "lucide-react"
import { Progress } from "@/ui/progress"
import { proto } from "@/protoscope/proto"
import { cn } from "@/lib/utils"

export const flowSteps = ["details", "receipt", "review", "done"] as const
const stepLabels: Record<string, string> = { details: "Details", receipt: "Receipt", review: "Review", done: "Done" }

/** Organism: the multi-step progress header, driven by the `step` process dimension. */
export function FlowProgress({ step }: { step: string }) {
  const idx = Math.max(0, flowSteps.indexOf(step as (typeof flowSteps)[number]))
  return (
    <div {...proto("FlowProgress", { component: "FlowProgress (organism)", organism: "flow-progress", drivenBy: "step dimension" })}>
      <Progress value={((idx + 1) / flowSteps.length) * 100} className="mb-3" />
      <div className="flex justify-between text-xs">
        {flowSteps.map((s, i) => (
          <span
            key={s}
            className={cn("flex items-center gap-1", i < idx ? "text-emerald-600" : i === idx ? "font-semibold" : "text-muted-foreground")}
          >
            {i < idx && <Check className="size-3" />}
            {stepLabels[s]}
          </span>
        ))}
      </div>
    </div>
  )
}
