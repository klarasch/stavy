/// <reference types="vite/client" />

declare const __PROTO_SLICE__: string | null
declare const __PROTO_ROOT__: string | null

declare module "virtual:proto-pages" {
  export const pageModules: Record<
    string,
    () => Promise<{ default: import("react").ComponentType<import("@/protoscope/types").PageProps> }>
  >
}
