import type { PageProps } from "@/protoscope/types"
import { DetailTemplate } from "../templates/DetailTemplate"

export default function ExpenseDetailPage(props: PageProps) {
  return <DetailTemplate {...props} />
}
