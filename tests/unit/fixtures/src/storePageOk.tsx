import { create } from "zustand"

// @proto-shared-store
export const useStore = create((set) => ({ count: 0 }))

export function StorePageOk() {
  return <div data-proto="StoreWidgetOk">Count</div>
}
