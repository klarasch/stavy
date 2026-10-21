export interface Gate {
  closed: boolean
  close(): void
  open(): void
}
export function installGate(win: Window): Gate
export const FRAME_HOOK: string
