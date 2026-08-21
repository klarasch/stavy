import type { PageProps } from "@/stavy/types"
import { DetailTemplate } from "../templates/DetailTemplate"

export default function ExpenseDetailPage(props: PageProps) {
  return <DetailTemplate {...props} />
}
