import { Check } from "lucide-react"
import { Card, CardContent } from "@/ui/card"
import { proto } from "@/demo/lib/proto"
import type { PageProps } from "@/demo/app/types"
import { AppFrame } from "./AppFrame"
import { makeT } from "../strings"

/**
 * A reference screen: same content for every role, in every lifecycle, at
 * every step. It reads no dimension of its own, so it is registered with none
 * — one URL, one card on the canvas.
 */
export function PolicyTemplate({ dims, nav }: PageProps) {
  const t = makeT(dims.locale)
  const rules = ["policy.rule.limit", "policy.rule.receipt", "policy.rule.deadline"] as const

  return (
    <AppFrame dims={dims} nav={nav} active="policy">
      <div className="max-w-2xl" {...proto("PolicyPage", { component: "PolicyTemplate" })}>
        <h1 className="text-2xl font-semibold tracking-tight">{t("policy.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1.5">{t("policy.intro")}</p>
        <Card className="mt-6" {...proto("PolicyRules", { component: "Card", rules: rules.length })}>
          <CardContent className="flex flex-col gap-4">
            {rules.map((key) => (
              <div key={key} className="flex items-start gap-3 text-sm">
                <Check className="size-4 mt-0.5 shrink-0 text-emerald-600" />
                <span>{t(key)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground mt-4">{t("policy.updated")}</p>
      </div>
    </AppFrame>
  )
}
