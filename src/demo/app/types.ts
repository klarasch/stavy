// Local mirror of the old viewer-supplied PageProps contract (used to live at
// @/stavy/types). Orbit is now a standalone app: templates/organisms keep this
// shape, but `dims` comes from the URL (see ./dims) and `nav` pushes a route
// instead of the old page-swap viewer glue.
export interface PageProps {
  dims: Record<string, string>
  nav: (pageId: string, dims?: Record<string, string>) => void
}
