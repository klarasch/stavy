import { create } from "zustand"

export const useStore = create((set) => ({ count: 0 }))

export function StorePage() {
  return <div data-proto="StoreWidget">Count</div>
}
