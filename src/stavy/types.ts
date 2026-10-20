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
  /** Shorthand for a named state: `{ "state": "loading" }` */
  state?: string
  note?: string
}

export interface AnnotationDef {
  /** Target the pin attaches to (bare id or CSS selector, see `targetSelector`) */
  target: string
  title: string
  note: string
}

export type Fidelity = "static" | "navigable" | "interactive"

/**
 * A named state of a screen (SPEC §1.3a): the loose alternative to
 * dimensions. Each is just a URL with a name — `url` as-is, or the page's
 * `url` template filled with `dims`. No axes, no matrix, no placeholders.
 */
export interface StateDef {
  id: string
  label?: string
  /** The prototype URL for this state (path or absolute). Wins over `dims`. */
  url?: string
  /** Values for the page's url template placeholders. */
  dims?: Record<string, string>
  note?: string
  /** Free tags for filtering and grouping, never for layout. */
  tags?: string[]
  /** Registered (linkable, scannable) but not shown on the map by default. */
  hidden?: boolean
}

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
  url?: string
  /**
   * Named states (SPEC §1.3a). When present, the page varies by these alone:
   * `normalizeManifest` turns them into one hidden `_state` axis and moves
   * `dimensions` to `urlDims` (template values only).
   */
  states?: StateDef[]
  /** Set by normalisation when `states` is used: the page's original dimensions, now only url-template values. */
  urlDims?: Record<string, string[]>
  urlDefaults?: Record<string, string>
  /** How the map lays out this page's states: a row (default) or, opt-in, a matrix over two axes. */
  layout?: "row" | "matrix"
  /** Handover status, shown as a chip. Free text; "draft" | "review" | "ready" are styled. */
  status?: string
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
  /** A named state of the page (shorthand for `dims: { _state: … }`) */
  state?: string
  /**
   * How the tour reaches this step. Default: by its URL — the player loads the
   * registered state fresh unless the app already navigated there. "click":
   * the step lives in component state (a menu opened by the previous click)
   * and its target appearing after that click is enough.
   */
  via?: "url" | "click"
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
   * Only for what the data above cannot say. The module should also export
   * `apiVersion: 1` (on the default export); the viewer warns on a mismatch.
   */
  module?: string
  /**
   * Which component frames are framework plumbing (dropped from the stack) and
   * which are headless primitives (collapsed as a kit's internals). Patterns are
   * regular expressions as strings, tested against the component name with any
   * bundler digit suffix removed. Added to the built-in lists unless
   * `keepDefaults` is false.
   */
  internals?: InspectInternals
  /** What the inspect panel shows, in which order, and which links and copy buttons it offers. */
  panel?: InspectPanelSettings
}

export interface InspectInternals {
  /** Component names never shown on the stack (framework and router plumbing). */
  exclude?: string[]
  /** Headless primitives a kit wraps: collapsed behind "+N internals" when a kit renders them. Only consulted when `kits` are declared. */
  primitives?: string[]
  /** Keep the built-in patterns and add these to them (default true). False replaces them. */
  keepDefaults?: boolean
}

/** Built-in panel sections, plus any section id a `viewer.inspect.module` exports under `panel`. */
export type InspectSectionId = "component" | "props" | "tokens" | "type" | "spacing" | "classes" | "accessibility" | "source" | "url" | (string & {})

export interface InspectPanelSettings {
  /** Sections in display order; a section left out is hidden. Default: every built-in section, then the module's. */
  sections?: InspectSectionId[]
  /** Props never shown (in the props table or the copied JSX): exact names, or regexes written as "/pattern/flags". */
  hideProps?: string[]
  /** Links shown for the selected component. `{name}`, `{kebab}` and `{kit}` are filled in; a link whose placeholder has no value is left out. */
  links?: InspectLink[]
  /** Which copy buttons the panel offers. Default all three. */
  copy?: Array<"jsx" | "token" | "class">
}

export interface InspectLink {
  label: string
  /** e.g. "https://ds.example.com/components/{kebab}" or "https://storybook.example.com/?path=/docs/{kit}-{name}" */
  href: string
  /** Only for components whose name matches this regular expression. */
  match?: string
  /** Only for components of this kit (by `kits[].name`). */
  kit?: string
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
  /**
   * The workspace page viewport: the size every `kind: "page"` state is
   * rendered and captured at. Default 1920 × 1080, dpr 1. `pages[].frame`
   * still overrides this per page (mainly for components).
   */
  viewport?: { width: number; height: number; dpr?: number }
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
  /** Legacy (0.2) boards: Mermaid / image / text, rendered in the map's Boards area. 0.3 boards live in `stavy-content/boards/`. */
  boards?: BoardDef[]
  requirements?: RequirementDef[]
}

/* ------------------------------------------------------------------ */
/* Authored content — stavy-content/ next to stavy.json (SPEC §4)       */
/* ------------------------------------------------------------------ */

/** stavy-content/index.json: which boards and docs exist, in order. */
export interface ContentIndex {
  boards?: Array<{ id: string; title: string; description?: string }>
  docs?: Array<{ id: string; title: string }>
}

/** An action the scan (and the player) performs before showing a board screen item. */
export type BoardAction =
  | { click: string }
  | { hover: string }
  | { focus: string }
  | { press: string }
  | { type: string; into: string }
  | { wait: number }

interface ItemBase {
  /** Unique within the board; arrows and edits refer to it. */
  id: string
  /** Position and size in board pixels. Omit x/y and the board places the item automatically. */
  x?: number
  y?: number
  w?: number
  h?: number
  /** Caption above the item */
  title?: string
  /** Short text under the item (Markdown allowed) */
  note?: string
}

/** One screen at one state, as a snapshot card that opens the player. */
export interface ScreenItem extends ItemBase {
  type: "screen"
  screen: string
  /** Named state id (pages with `states`) */
  state?: string
  /** Dimension values (pages with dimensions) */
  dims?: Record<string, string>
  /** Show only this target (plus a margin), captured by scan as its own crop */
  crop?: string
  /** Steps the scan performs before capturing: open a menu, hover, focus… */
  do?: BoardAction[]
  /** Capture at another viewport, e.g. { width: 390, height: 844 } */
  viewport?: { width: number; height: number }
}

/** Several states of one screen, laid out together. */
export interface StatesItem extends ItemBase {
  type: "states"
  screen: string
  /** Subset and order of states (state ids, or instance indexes as strings); default all shown */
  states?: string[]
  layout?: "row" | "grid"
  columns?: number
  crop?: string
}

/** A flow (scenario) as a compact strip of steps; long flows wrap, never cap. */
export interface FlowItem extends ItemBase {
  type: "flow"
  flow: string
  /** Steps per row before wrapping (default: fit to `w`, else 5) */
  perRow?: number
  collapsed?: boolean
}

/** Rendered Markdown — inline (`md`) or a file in stavy-content (`src`, optionally `#heading`). */
export interface MarkdownItem extends ItemBase {
  type: "markdown"
  md?: string
  src?: string
}

/** A sticky note. */
export interface NoteItem extends ItemBase {
  type: "note"
  text: string
  color?: "yellow" | "blue" | "green" | "pink" | "purple" | "gray"
  author?: string
}

/** A titled frame grouping other items; children are laid out inside it unless they carry x/y. */
export interface SectionItem extends ItemBase {
  type: "section"
  title: string
  items?: BoardItem[]
  layout?: "row" | "column" | "grid"
  columns?: number
  collapsed?: boolean
}

/** An image (reference, crop, whiteboard photo, an SVG an agent drew), with optional numbered callouts. */
export interface ImageItem extends ItemBase {
  type: "image"
  /** URL, or a path relative to stavy-content */
  src: string
  alt?: string
  callouts?: BoardCallout[]
}

/** A Mermaid diagram; the renderer loads only when a board uses one. */
export interface MermaidItem extends ItemBase {
  type: "mermaid"
  code: string
}

/** A connector between two items. */
export interface ArrowItem {
  id: string
  type: "arrow"
  from: string
  to: string
  label?: string
  style?: "solid" | "dashed"
}

export type BoardItem = ScreenItem | StatesItem | FlowItem | MarkdownItem | NoteItem | SectionItem | ImageItem | MermaidItem | ArrowItem

/** stavy-content/boards/<id>.json */
export interface BoardFile {
  title: string
  description?: string
  /** "draft" | "review" | "ready" are styled; anything else shows as-is */
  status?: string
  /** Auto-layout for unplaced top-level items */
  layout?: { direction?: "row" | "column"; gap?: number; maxWidth?: number }
  items: BoardItem[]
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
  /** Image file name inside the snapshots folder (.webp; .png when the browser could not encode webp) */
  file: string
  width: number
  height: number
  /** Device scale factor the capture ran at (SPEC §1.8 viewer.viewport.dpr; default 1). */
  dpr?: number
  /** Every target referenced for this instance that was found, with its box */
  targets: Record<string, TargetBox>
  /** Required targets (scenario steps, notes) that were not found in the rendered page — the contract broke */
  missing?: string[]
  /** Optional targets (annotations) not present on this state — no pin is drawn; not a failure */
  absent?: string[]
  /** The scan scrolled the state's first required target into view before measuring/capturing (it was below the fold) */
  scrolled?: boolean
  /** A board item's `do` steps that could not be performed (the capture was taken anyway) */
  actionFailed?: string[]
  /** Content hash of the image; scan skips rewriting (and keeps `at`) when a re-capture is identical */
  hash?: string
  /** ISO timestamp the image last changed */
  at?: string
}

/** instanceKey(page, dims) → entry */
export type SnapshotIndex = Record<string, SnapshotEntry>
