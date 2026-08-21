/// <reference types="vite/client" />

declare const __PROTO_SLICE__: string | null
declare const __PROTO_ROOT__: string | null

declare module "virtual:proto-pages" {
  export const pageModules: Record<
    string,
    () => Promise<{ default: import("react").ComponentType<import("@/stavy/types").PageProps> }>
  >
}

declare module "virtual:proto-strings" {
  export const strings: Record<string, Record<string, string>>
}
