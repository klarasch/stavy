import type { PageProps } from "@/protopact/types"
import { ListTemplate } from "../templates/ListTemplate"

export default function ExpensesPage(props: PageProps) {
  return <ListTemplate {...props} />
}
