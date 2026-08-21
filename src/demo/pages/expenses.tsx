import type { PageProps } from "@/protoscope/types"
import { ListTemplate } from "../templates/ListTemplate"

export default function ExpensesPage(props: PageProps) {
  return <ListTemplate {...props} />
}
