// Protoscope manifest types — the TypeScript mirror of SPEC.md (v0.1).
// The manifest itself (protoscope.json) is framework-agnostic JSON.

export interface DimensionValue {
  id: string
  label: string
  description?: string
}

export interface Dimension {
  id: string
  label: string
  /** Free-form classification: "state" | "role" | "lifecycle" | "process" | anything */
  kind?: string
  values: DimensionValue[]
}

export interface TemplateDef {
  id: string
  label: string
  description?: string
  /** Path to the template implementation in this workspace */
  source: string
  /** UI-kit components the template is composed from */
  uiKit?: string[]
  /** Registered components (kind: "component") this template is composed from — its anatomy */
  organisms?: string[]
}

export interface InstanceDef {
  /** Dimension values pinned for this canvas instance (partial; defaults fill the rest) */
  dims: Record<string, string>
  note?: string
}

export interface AnnotationDef {
  /** data-proto target id the pin attaches to */
  target: string
  title: string
  note: string
}

export type Fidelity = "static" | "navigable" | "interactive"

export interface PageDef {
  id: string
  label: string
  description?: string
  /**
   * "page" (default) — a full screen rendered at the workspace viewport.
   * "component" — a bespoke organism (panel, widget) rendered in its own `frame`;
   * same contract, same dimensions/instances/annotations, smaller canvas cards.
   */
  kind?: "page" | "component"
  /** Render size for components (defaults to the page viewport) */
  frame?: { width: number; height: number }
  /** Module path relative to the workspace root (default: src/demo/pages/<id>.tsx) */
  module?: string
  template: string
  /**
   * How much behaviour this page carries (see SKILL.md "Fidelity ladder"):
   * static = screens only · navigable = nav() between pages/dims only ·
   * interactive = local state beyond navigation (only when a scenario needs it)
   */
  fidelity?: Fidelity
  /** Dimension id -> value ids this page supports */
  dimensions: Record<string, string[]>
  /** Default value per dimension */
  defaults?: Record<string, string>
  /** Variants pinned to the canvas */
  instances?: InstanceDef[]
  annotations?: AnnotationDef[]
}

export interface ScenarioStep {
  page: string
  /** Dimension overrides for this step (defaults fill the rest) */
  dims?: Record<string, string>
  /** data-proto id of the element to highlight; omit for an "observe" step */
  target?: string
  title: string
  note?: string
}

export interface Scenario {
  id: string
  label: string
  persona?: string
  description?: string
  /** External references this scenario realises, e.g. PRD sections or tickets */
  refs?: string[]
  steps: ScenarioStep[]
}

/** A free-standing "pointing note" on the canvas, attached to a page instance (and optionally a part of it). */
export interface CanvasNote {
  id: string
  text: string
  page: string
  /** Which pinned instance to point at (defaults fill the rest); falls back to the page's first instance */
  dims?: Record<string, string>
  /** Optional data-proto id inside that instance to point at precisely */
  target?: string
  placement?: "top" | "right" | "bottom" | "left"
  /** Manual nudge in canvas pixels */
  offset?: { x?: number; y?: number }
}

export interface PrototypeSlice {
  id: string
  label: string
  description?: string
  pages: string[]
  scenarios: string[]
}

/**
 * A board is supporting material on the canvas that is NOT part of the
 * coverage contract: information architecture, flow diagrams, a moodboard
 * image, a note. The viewer renders it without caring what it means.
 */
export interface BoardDef {
  id: string
  title: string
  description?: string
  kind: "mermaid" | "image" | "text"
  /** Mermaid source, image URL, or plain text */
  source: string
  /** Rendered width on the canvas (px); default 720 */
  width?: number
}

/** Floating anchors, or a full-width bar that shrinks the prototype viewport instead of covering it. */
export type ToolbarAnchor = "bottom" | "top" | "bottom-left" | "bottom-right" | "top-left" | "top-right" | "bar-bottom" | "bar-top"

/** Workspace-level viewer defaults (a product/design system picks these once; viewers may override per link). */
export interface ViewerDefaults {
  /** Where the prototype-mode toolbar docks by default */
  toolbar?: ToolbarAnchor
}

export interface Manifest {
  $schema?: string
  version: string
  product: { name: string; description?: string }
  viewer?: ViewerDefaults
  dimensions: Dimension[]
  templates: TemplateDef[]
  pages: PageDef[]
  scenarios: Scenario[]
  prototypes: PrototypeSlice[]
  notes?: CanvasNote[]
  boards?: BoardDef[]
}

/** Props every page module receives from the viewer */
export interface PageProps {
  dims: Record<string, string>
  nav: (pageId: string, dims?: Record<string, string>) => void
}
