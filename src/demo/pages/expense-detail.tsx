import type { PageProps } from "@/protopact/types"
import { DetailTemplate } from "../templates/DetailTemplate"

export default function ExpenseDetailPage(props: PageProps) {
  return <DetailTemplate {...props} />
}
