export interface RoundEvent {
  id: string
  /** The comment this is about */
  thread: string
  type: "reply" | "status" | "edit" | "remove"
  at: string
  body?: string
  status?: "open" | "addressed" | "closed"
  /** The commit a status change was made on (addressed) */
  commit?: string
  patch?: Record<string, unknown>
}
export interface Round {
  version: 1
  id: string
  author: string
  date: string
  /** The commit and branch reviewed */
  commit?: string
  branch?: string
  comments: Array<Record<string, any> & { id: string }>
  events: RoundEvent[]
}
export type RoundOp =
  | { op: "comment"; comment: Record<string, any> & { id: string } }
  | { op: "event"; event: Omit<RoundEvent, "id" | "at"> & { id?: string; at?: string | number } }
  | { op: "import"; round: unknown }
export interface RoundCtx {
  author: string
  date: string
  commit?: string
  branch?: string
  avoid?: string[]
}
export declare const ROUNDS_DIR: string
export declare const ROUNDS_INDEX: string
export declare const LEGACY_FILE: string
export declare const STATUSES: string[]
export declare function localDate(d?: Date): string
export declare function localTime(d?: Date): string
export declare function slugAuthor(author: string): string
export declare function roundId(author: string, date: string): string
export declare function newId(): string
export declare function tidyRound(r: Partial<Round> & { id: string; date: string }): Round
export declare function serializeRound(r: Round): string
export declare function asRound(raw: unknown): Round | null
export declare function mergeRounds(rounds: Round[]): Array<Record<string, any>>
export declare function applyOp(rounds: Round[], ctx: RoundCtx, op: RoundOp): { rounds: Round[]; changed: Set<string> }
export declare function legacyToRounds(list: unknown): Round[]
export declare function describeRounds(rounds: Round[]): { authors: string[]; comments: number; events: number }
