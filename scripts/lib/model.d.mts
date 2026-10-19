import type { Manifest, PageDef, StateDef } from "../../src/stavy/types"
export declare const STATE_DIM: "_state"
export declare const CONTENT_DIR: "stavy-content"
export declare function normalizeManifest<M extends Manifest>(m: M): M
export declare function stateOf(page: PageDef, dims: Record<string, string> | undefined): StateDef | undefined
export declare function resolveDims(page: PageDef, overrides?: Record<string, string>): Record<string, string>
export declare function statePath(page: PageDef, dims: Record<string, string>): string | null
export declare function stateHref(page: PageDef, dims: Record<string, string>, appBase?: string): string | null
export declare function instanceKey(pageId: string, dims: Record<string, string>): string
export declare function snapshotStem(page: PageDef, dims: Record<string, string>): string
export type Variant = { crop?: string; do?: Array<Record<string, string | number>>; viewport?: { width: number; height: number } }
export declare function variantKey(pageId: string, dims: Record<string, string>, v?: Variant): string
export declare function variantStem(page: PageDef, dims: Record<string, string>, v?: Variant): string
