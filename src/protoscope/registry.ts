import { lazy, type ComponentType, type LazyExoticComponent } from "react"
import { pageModules } from "virtual:proto-pages"
import type { PageProps } from "./types"

// Pages come through the virtual module so that sliced builds (PROTO=<id>)
// only ever import — and bundle — the pages in the active slice.
export const pageComponents: Record<string, LazyExoticComponent<ComponentType<PageProps>>> =
  Object.fromEntries(Object.entries(pageModules).map(([id, loader]) => [id, lazy(loader)]))
