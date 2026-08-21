import type { PageProps } from "@/stavy/types"
import { ListTemplate } from "../templates/ListTemplate"

export default function ExpensesPage(props: PageProps) {
  return <ListTemplate {...props} />
}
