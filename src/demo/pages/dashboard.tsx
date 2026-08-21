import type { PageProps } from "@/protoscope/types"
import { DashboardTemplate } from "../templates/DashboardTemplate"

export default function DashboardPage(props: PageProps) {
  return <DashboardTemplate {...props} />
}
