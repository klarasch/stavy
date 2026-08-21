import { Check } from "lucide-react"
import { Progress } from "@/ui/progress"
import { proto } from "@/protopact/proto"
import { cn } from "@/lib/utils"
import { makeT } from "../strings"

export const flowSteps = ["details", "receipt", "review", "done"] as const
/** Organism: the multi-step progress header, driven by the `step` process dimension. */
export function FlowProgress({ step, locale }: { step: string; locale?: string }) {
  const t = makeT(locale)
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
            {t(`flow.step.${s}`)}
          </span>
        ))}
      </div>
    </div>
  )
}
