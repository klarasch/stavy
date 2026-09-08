// Stavy manifest types — the TypeScript mirror of SPEC.md (v0.2).
// The manifest itself (stavy.json) is framework-agnostic JSON. The viewer is
// an overlay: it never imports the prototype, it loads the prototype's URLs.

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
  /**
   * Who owns the choice (SPEC §1.1).
   * "page" (default) — a local axis of one screen: flip it per page, it resets
   * when you open another one (flow step, data state, overlay).
   * "workspace" — one value for the whole workspace, chosen once in the viewer
   * chrome and carried across every navigation (release phase, role, locale).
   * A page that does not declare a workspace axis is unaffected by it; a page
   * that declares it is hidden from the canvas when the active value is not in
   * its list. The dimension's FIRST value is the workspace default.
   */
  scope?: "page" | "workspace"
  values: DimensionValue[]
}

/** An optional grouping of pages by shape ("list", "detail", "dashboard"). Informational. */
export interface TemplateDef {
  id: string
  label: string
  description?: string
  /** Path to the implementation in the prototype repo — the inspector links to it in dev */
  source?: string
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
  /** Target the pin attaches to (bare id or CSS selector, see `targetSelector`) */
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
   * Free-text section ("Onboarding", "Approvals"). The canvas clusters page
   * areas by it in first-appearance order, under a quiet heading; the table of
   * contents groups by it too. Ungrouped pages come last, under no heading.
   */
  group?: string
  /**
   * "page" (default) — a full screen rendered at the workspace viewport.
   * "component" — an organism rendered by a harness route in its own `frame`;
   * same contract, same dimensions/instances/annotations, smaller canvas cards.
   */
  kind?: "page" | "component"
  /** Render size for components (defaults to the page viewport) */
  frame?: { width: number; height: number }
  /**
   * THE binding contract: where the prototype renders this page, as a path
   * with `{dim}` placeholders — "/expenses/exp-1?role={role}&state={state}".
   * Every declared dimension must appear; the prototype reads them however it
   * likes (search params, path segments) and renders that state.
   */
  url: string
  /** Optional shape/grouping label (a registered template id) */
  template?: string
  /**
   * How much behaviour this page carries (see SKILL.md "Fidelity ladder"):
   * static = screens only · navigable = links between states only ·
   * interactive = real local behaviour (only when a scenario needs it)
   */
  fidelity?: Fidelity
  /**
   * Dimension id -> value ids this page supports.
   *
   * Optional in the manifest JSON: a page with no axes is normal — it shows a
   * single card at its defaults (SPEC §1.3). `setManifest()` fills in `{}` for
   * a page that omits the key, so everything downstream can read it as an
   * object; declare an axis only when a reviewer must compare its values.
   */
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
  /** Target to highlight; omit for an "observe" step */
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
  /** Optional target inside that instance to point at precisely */
  target?: string
  placement?: "top" | "right" | "bottom" | "left"
  /** Manual nudge in canvas pixels */
  offset?: { x?: number; y?: number }
}

/** A named subset of the workspace — informational grouping for handoff docs. */
export interface PrototypeSlice {
  id: string
  label: string
  description?: string
  pages: string[]
  scenarios: string[]
}

/**
 * A numbered callout on an `image` board, in the same visual language as a
 * page's anatomy. Coordinates are fractions (0..1) of the image, like
 * `TargetBox` — the image is the frame of reference, so a figure keeps its
 * numbering at any rendered width. Omit `w`/`h` for a point pin.
 */
export interface BoardCallout {
  x: number
  y: number
  w?: number
  h?: number
  title: string
  note?: string
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
  /** Rendered width on the canvas (px); default 720, or 360 for a figure anchored to a page */
  width?: number
  /**
   * A page id (SPEC §1.7). An anchored board is a *figure*: it renders inside
   * that page's canvas area, after the cards and the anatomy, so a crop of a
   * menu or a hover state sits next to the screen it explains. Unanchored
   * boards live in the Boards area.
   */
  page?: string
  /** Numbered callouts over the image, with a legend. `kind: "image"` only. */
  callouts?: BoardCallout[]
}

/**
 * A requirement the prototype must demonstrate (PRD section, ticket, acceptance
 * criterion). Scenarios cite them in `refs`; the coverage board shows which are
 * demonstrated and which are gaps. Usually generated from the PRD by the skill.
 */
export interface RequirementDef {
  id: string
  title: string
  /** Where it comes from: document + section, ticket URL… */
  source?: string
  /** Free-form: "must" | "should" | "later" — viewers group by it */
  priority?: string
}

export type ToolbarAnchor = "bottom" | "top" | "bottom-left" | "bottom-right" | "top-left" | "top-right" | "bar-bottom" | "bar-top"

/**
 * What the inspector needs to know about the design system the prototype is
 * built from (SPEC §1.8). Every field is optional: with none of it the
 * inspector still reports computed values and the `var()` chain behind them.
 * With it, values get token names, components get their real names, and type
 * gets the name of its scale entry. Regex fields are strings compiled once by
 * the viewer; an invalid one is warned about and ignored.
 *
 * See `docs/INSPECT-ADAPTERS.md`.
 */
export interface InspectSettings {
  /** Component libraries the prototype is built from. */
  kits?: Array<{
    /** Shown in the panel, e.g. "Acme" */
    name: string
    /** A component whose own name starts with this belongs to the kit, e.g. "Ac" */
    componentPrefix?: string
    /**
     * Matches a class the kit stamps on a component's root node; capture group 1
     * must be the component's name, e.g. "^(Ac[A-Z]\\w*)-module_". This is what
     * gives a name to components written as anonymous `forwardRef` wrappers.
     */
    classPattern?: string
  }>
  /** A custom property matching this is a design token — where a `var()` chain stops, e.g. "^--acme-" */
  tokenPattern?: string
  /** A custom property matching this is a private primitive: shown as such, never as a token, e.g. "^--acme-_" */
  privateTokenPattern?: string
  /** Narrows which tokens are offered as spacing/radius names; defaults to `tokenPattern`. */
  spacingTokenPattern?: string
  /** The type scale, for naming what an element's computed type is. `lineHeight` is a ratio (1.5) or px (21). */
  typeScale?: Array<{ name: string; family: string; size: number; weight: number; lineHeight: number }>
  /** Attributes that mark UI-kit components in the DOM. Default ["data-slot", "data-component"]. */
  componentAttrs?: string[]
  /**
   * A same-origin ES module the viewer imports at startup, default-exporting
   * `{ framework?, designSystem? }` partials merged over the built-in adapter.
   * Only for what the data above cannot say.
   */
  module?: string
}

/** Workspace-level viewer defaults (a product/design system picks these once; viewers may override per link). */
export interface ViewerDefaults {
  /** Where the prototype-mode toolbar docks by default */
  toolbar?: ToolbarAnchor
  /** Path prefix the viewer is served under, e.g. "/stavy". Default: derived from the viewer's own location. */
  base?: string
  /**
   * Where the prototype app is served: an origin or a path prefix. Default: the
   * viewer's origin at the parent of `base`. Must be same-origin for inspect,
   * tours, pins and comments to reach into the frame.
   */
  app?: string
  /** Attributes a bare target id is looked up in, in order. Default ["data-proto", "data-testid"]. */
  targetAttrs?: string[]
  /** What the inspector should know about this workspace's design system. */
  inspect?: InspectSettings
}

export interface Manifest {
  $schema?: string
  version: string
  product: { name: string; description?: string }
  viewer?: ViewerDefaults
  /** URL of the copy catalog (JSON: locale → key → string), if the prototype exposes one. */
  strings?: string
  dimensions: Dimension[]
  templates?: TemplateDef[]
  pages: PageDef[]
  scenarios: Scenario[]
  prototypes?: PrototypeSlice[]
  notes?: CanvasNote[]
  boards?: BoardDef[]
  requirements?: RequirementDef[]
}

/* ------------------------------------------------------------------ */
/* Snapshot index — written by scripts/scan.mjs, read by the canvas     */
/* ------------------------------------------------------------------ */

/** A measured target box, as fractions (0..1) of the page frame. */
export interface TargetBox {
  x: number
  y: number
  w: number
  h: number
}

export interface SnapshotEntry {
  /** PNG file name inside the snapshots folder */
  file: string
  width: number
  height: number
  /** Every target referenced for this instance that was found, with its box */
  targets: Record<string, TargetBox>
  /** Required targets (scenario steps, notes) that were not found in the rendered page — the contract broke */
  missing?: string[]
  /** Optional targets (annotations) not present on this state — no pin is drawn; not a failure */
  absent?: string[]
  /** The scan scrolled the state's first required target into view before measuring/capturing (it was below the fold) */
  scrolled?: boolean
  /** ISO timestamp of the scan */
  at?: string
}

/** instanceKey(page, dims) → entry */
export type SnapshotIndex = Record<string, SnapshotEntry>
