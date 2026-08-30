import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { fileURLToPath } from "node:url"
import { validate } from "../../scripts/validate.mjs"

const root = fileURLToPath(new URL("./fixtures", import.meta.url))
const reqDoc = fileURLToPath(new URL("./fixtures/req-doc.md", import.meta.url))

// A fully valid manifest, referencing real fixture source files under
// tests/unit/fixtures/ so the data-proto target lookups have something real
// to scan. Every field that would otherwise trigger a warning is filled in,
// so the "valid manifest" test can assert on a clean bill of health and each
// other test can mutate exactly one thing via structuredClone().
function baseManifest() {
  return {
    version: "0.1",
    product: { name: "Test Product" },
    strings: "strings.json",
    dimensions: [
      {
        id: "role",
        label: "Role",
        values: [
          { id: "user", label: "User" },
          { id: "admin", label: "Admin" },
        ],
      },
    ],
    templates: [
      { id: "simple-template", label: "Simple", source: "src/template.tsx", organisms: ["organism-page"] },
      { id: "organism-template", label: "Organism", source: "src/organism.tsx" },
    ],
    pages: [
      {
        id: "simple-page",
        label: "Simple Page",
        template: "simple-template",
        module: "src/page.tsx",
        fidelity: "static",
        dimensions: { role: ["user", "admin"] },
        defaults: { role: "user" },
        instances: [{ dims: { role: "user" } }],
        annotations: [{ target: "SubmitButton", title: "Submit", note: "submits the form" }],
      },
      {
        id: "organism-page",
        label: "Organism",
        kind: "component",
        template: "organism-template",
        module: "src/organism.tsx",
        fidelity: "static",
        dimensions: {},
        instances: [{ dims: {} }],
      },
    ],
    scenarios: [
      {
        id: "demo-scenario",
        label: "Demo",
        refs: ["REQ-1"],
        steps: [{ page: "simple-page", title: "Step 1", target: "SubmitButton", dims: { role: "user" } }],
      },
    ],
    prototypes: [{ id: "demo-proto", label: "Demo Proto", pages: ["simple-page", "organism-page"], scenarios: ["demo-scenario"] }],
    requirements: [{ id: "REQ-1", title: "Some requirement" }],
    notes: [{ id: "note-1", text: "hi", page: "simple-page", dims: { role: "user" }, target: "SubmitButton" }],
    boards: [{ id: "board-1", title: "Board", kind: "text", source: "some text" }],
  }
}

interface ValidateResult {
  errors: string[]
  warnings: string[]
}

async function run(mutate?: (m: ReturnType<typeof baseManifest>) => void, flags?: { refs: string[]; coverage: boolean }): Promise<ValidateResult> {
  const m = baseManifest()
  mutate?.(m)
  return (await validate(m as any, root, flags ?? { refs: [], coverage: false })) as ValidateResult
}

describe("validate: happy path", () => {
  it("a fully valid manifest produces no errors and no warnings", async () => {
    const { errors, warnings } = await run()
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })
})

describe("validate: JSON schema", () => {
  it("flags a missing required field", async () => {
    const { errors } = await run((m) => {
      // @ts-expect-error deliberately invalid
      delete m.product.name
    })
    expect(errors.some((e) => e.startsWith("schema"))).toBe(true)
  })

  it("flags an additional (unknown) top-level property", async () => {
    const { errors } = await run((m) => {
      // @ts-expect-error deliberately invalid
      m.notAField = true
    })
    expect(errors.some((e) => e.startsWith("schema"))).toBe(true)
  })

  it("flags a version that doesn't match the expected pattern", async () => {
    const { errors } = await run((m) => {
      m.version = "9.9"
    })
    expect(errors.some((e) => e.startsWith("schema"))).toBe(true)
  })
})

describe("validate: pages", () => {
  it("errors when a page references an unregistered template", async () => {
    const { errors } = await run((m) => {
      m.pages[0].template = "missing-template"
    })
    expect(errors.some((e) => e.includes('template "missing-template" is not registered'))).toBe(true)
  })

  it("errors when a page id is not kebab-case", async () => {
    const { errors } = await run((m) => {
      m.pages[0].id = "BadId"
      m.scenarios[0].steps[0].page = "BadId"
      m.prototypes[0].pages[0] = "BadId"
    })
    expect(errors.some((e) => e.includes("id must be kebab-case"))).toBe(true)
  })

  it("errors when a page declares an unknown dimension", async () => {
    const { errors } = await run((m) => {
      // @ts-expect-error deliberately invalid
      m.pages[0].dimensions.colors = ["red"]
    })
    expect(errors.some((e) => e.includes('unknown dimension "colors"'))).toBe(true)
  })

  it("errors when a page dimension declares an undeclared value", async () => {
    const { errors } = await run((m) => {
      m.pages[0].dimensions.role = ["nonexistent-value"]
    })
    expect(errors.some((e) => e.includes('"role=nonexistent-value" not declared'))).toBe(true)
  })

  it("warns when a page has no fidelity rung", async () => {
    const { warnings } = await run((m) => {
      // @ts-expect-error deliberately invalid: fidelity is optional at runtime, not in this literal's inferred type
      delete m.pages[0].fidelity
    })
    expect(warnings.some((w) => w.includes("no fidelity rung declared"))).toBe(true)
  })

  it("warns when a page dimension has no default", async () => {
    const { warnings } = await run((m) => {
      // @ts-expect-error deliberately invalid: defaults.role is optional at runtime, not in this literal's inferred type
      delete m.pages[0].defaults!.role
    })
    expect(warnings.some((w) => w.includes('no default for dimension "role"'))).toBe(true)
  })

  it("warns when a page has no pinned instances", async () => {
    const { warnings } = await run((m) => {
      m.pages[0].instances = []
    })
    expect(warnings.some((w) => w.includes("no pinned instances"))).toBe(true)
  })

  it("errors when an annotation target is not found in source", async () => {
    const { errors } = await run((m) => {
      m.pages[0].annotations = [{ target: "NoSuchTarget", title: "x", note: "y" }]
    })
    expect(errors.some((e) => e.includes('annotation target "NoSuchTarget" not found in source'))).toBe(true)
  })
})

describe("validate: module-level singleton stores", () => {
  it("warns about a module-level zustand store shared across canvas cards", async () => {
    const { warnings } = await run((m) => {
      m.pages[0].module = "src/storePage.tsx"
    })
    expect(warnings.some((w) => w.includes("module-level store (zustand store)"))).toBe(true)
  })

  it("does not warn when the store line is annotated with @proto-shared-store", async () => {
    const { warnings } = await run((m) => {
      m.pages[0].module = "src/storePageOk.tsx"
    })
    expect(warnings.some((w) => w.includes("module-level store"))).toBe(false)
  })
})

describe("validate: scenarios", () => {
  it("errors when a scenario step references an unknown page", async () => {
    const { errors } = await run((m) => {
      m.scenarios[0].steps[0].page = "missing-page"
    })
    expect(errors.some((e) => e.includes('unknown page "missing-page"'))).toBe(true)
  })

  it("errors when a scenario step target is not found in source", async () => {
    const { errors } = await run((m) => {
      m.scenarios[0].steps[0].target = "NoSuchTarget"
    })
    expect(errors.some((e) => e.includes('target "NoSuchTarget" not found in source of "simple-page"'))).toBe(true)
  })

  it("errors when a scenario step uses an undeclared dimension value", async () => {
    const { errors } = await run((m) => {
      m.scenarios[0].steps[0].dims = { role: "nonexistent-value" }
    })
    expect(errors.some((e) => e.includes('"nonexistent-value" is not a declared value of dimension "role"'))).toBe(true)
  })

  it("warns when a scenario has no refs", async () => {
    const { warnings } = await run((m) => {
      // @ts-expect-error deliberately invalid: refs is optional at runtime, not in this literal's inferred type
      delete m.scenarios[0].refs
    })
    expect(warnings.some((w) => w.includes("no refs"))).toBe(true)
  })

  it("errors when a scenario's page is not in any prototype that includes the scenario", async () => {
    const { errors } = await run((m) => {
      m.prototypes[0].pages = ["organism-page"]
    })
    expect(errors.some((e) => e.includes('page "simple-page" is not in any prototype that includes this scenario'))).toBe(true)
  })
})

describe("validate: templates", () => {
  it("errors when a template organism is not a registered component", async () => {
    const { errors } = await run((m) => {
      m.templates[0].organisms = ["missing-organism"]
    })
    expect(errors.some((e) => e.includes('organism "missing-organism" is not a registered component'))).toBe(true)
  })

  it("warns when a template organism is a page, not a component", async () => {
    const { warnings } = await run((m) => {
      m.templates[0].organisms = ["simple-page"]
    })
    expect(warnings.some((w) => w.includes('organism "simple-page" is a page, not a component'))).toBe(true)
  })
})

describe("validate: prototypes", () => {
  it("errors when a prototype references an unknown page", async () => {
    const { errors } = await run((m) => {
      m.prototypes[0].pages.push("missing-page")
    })
    expect(errors.some((e) => e.includes('unknown page "missing-page"'))).toBe(true)
  })

  it("errors when a prototype references an unknown scenario", async () => {
    const { errors } = await run((m) => {
      m.prototypes[0].scenarios.push("missing-scenario")
    })
    expect(errors.some((e) => e.includes('unknown scenario "missing-scenario"'))).toBe(true)
  })
})

describe("validate: canvas notes", () => {
  it("errors when a note references an unknown page", async () => {
    const { errors } = await run((m) => {
      m.notes[0].page = "missing-page"
    })
    expect(errors.some((e) => e.includes('note "note-1": unknown page "missing-page"'))).toBe(true)
  })

  it("errors when a note target is not found in source", async () => {
    const { errors } = await run((m) => {
      m.notes[0].target = "NoSuchTarget"
    })
    expect(errors.some((e) => e.includes('note "note-1": target "NoSuchTarget" not found in source'))).toBe(true)
  })

  it("warns when a note points at an instance that is not pinned", async () => {
    const { warnings } = await run((m) => {
      m.notes[0].dims = { role: "admin" } // only role=user is pinned
    })
    expect(warnings.some((w) => w.includes('note "note-1": points at an instance that is not pinned'))).toBe(true)
  })
})

describe("validate: copy catalog", () => {
  it("errors when the strings catalog file does not exist", async () => {
    const { errors } = await run((m) => {
      m.strings = "does-not-exist.json"
    })
    expect(errors.some((e) => e.includes('strings catalog "does-not-exist.json" not found'))).toBe(true)
  })
})

describe("validate: boards", () => {
  it("errors on a duplicate board id", async () => {
    const { errors } = await run((m) => {
      m.boards.push({ id: "board-1", title: "Board 2", kind: "text", source: "more text" })
    })
    expect(errors.some((e) => e.includes('board "board-1": duplicate id'))).toBe(true)
  })

  it("errors on an unknown board kind", async () => {
    const { errors } = await run((m) => {
      m.boards[0].kind = "video"
    })
    expect(errors.some((e) => e.includes('unknown kind "video"'))).toBe(true)
  })

  it("errors on an empty board source", async () => {
    const { errors } = await run((m) => {
      m.boards[0].source = ""
    })
    expect(errors.some((e) => e.includes('board "board-1": empty source'))).toBe(true)
  })
})

describe("validate: requirements <-> scenario refs", () => {
  it("warns when a requirement is not demonstrated by any scenario", async () => {
    const { warnings } = await run((m) => {
      m.requirements!.push({ id: "REQ-2", title: "Unused" })
    })
    expect(warnings.some((w) => w.includes('requirement "REQ-2" (Unused) is not demonstrated by any scenario'))).toBe(true)
  })

  it("warns when a scenario cites a requirement id that isn't declared", async () => {
    const { warnings } = await run((m) => {
      m.scenarios[0].refs = ["REQ-999"]
    })
    expect(warnings.some((w) => w.includes('cites "REQ-999", which is not in requirements'))).toBe(true)
  })
})

describe("validate: --refs cross-check against requirement documents", () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
  })
  afterEach(() => {
    logSpy.mockRestore()
  })

  it("finds a ref whose id and section both appear in the document", async () => {
    const { errors } = await run(
      (m) => {
        m.scenarios[0].refs = ["REQ-1 §1.0"]
      },
      { refs: [reqDoc], coverage: false }
    )
    expect(errors.some((e) => e.includes('ref "REQ-1 §1.0"'))).toBe(false)
  })

  it("errors when a ref is not found in any referenced document", async () => {
    const { errors } = await run(
      (m) => {
        m.scenarios[0].refs = ["REQ-2 §2.0"]
      },
      { refs: [reqDoc], coverage: false }
    )
    expect(errors.some((e) => e.includes('ref "REQ-2 §2.0"') && e.includes("not found in"))).toBe(true)
  })

  it("warns about a section in the document that no scenario demonstrates", async () => {
    const { warnings } = await run(
      (m) => {
        m.scenarios[0].refs = ["REQ-1 §1.0"]
      },
      { refs: [reqDoc], coverage: false }
    )
    expect(warnings.some((w) => w.includes("§3.0") && w.includes("Uncovered Section"))).toBe(true)
  })
})

describe("validate: --coverage summary", () => {
  it("runs without throwing and doesn't add errors or warnings on its own", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const { errors, warnings } = await run(undefined, { refs: [], coverage: true })
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    expect(logSpy).toHaveBeenCalled()
    logSpy.mockRestore()
  })
})

describe("validate: workspace-scoped dimensions", () => {
  /** Add a `phase` axis with scope "workspace", supported by the simple page. */
  function withPhase(m: ReturnType<typeof baseManifest>, pageValues = ["p1", "p2"]) {
    m.dimensions.push({
      id: "phase",
      label: "Release phase",
      // @ts-expect-error the fixture's dimension type is narrowed to the base shape
      scope: "workspace",
      values: [
        { id: "p1", label: "Phase I" },
        { id: "p2", label: "Phase II" },
      ],
    })
    // @ts-expect-error same
    m.pages[0].dimensions.phase = pageValues
  }

  it("does not ask for a default on a workspace-scoped axis", async () => {
    const { warnings } = await run(withPhase)
    expect(warnings.some((w) => w.includes('no default for dimension "phase"'))).toBe(false)
  })

  it("warns that a page default for a workspace-scoped axis is ignored", async () => {
    const { warnings } = await run((m) => {
      withPhase(m)
      // @ts-expect-error the fixture's defaults map is narrowed to the base shape
      m.pages[0].defaults.phase = "p1"
    })
    expect(warnings.some((w) => w.includes('default for workspace-scoped dimension "phase" is ignored'))).toBe(true)
  })

  it("errors when a scenario's steps pin two values of a workspace-scoped axis", async () => {
    const { errors } = await run((m) => {
      withPhase(m)
      m.scenarios[0].steps.push({ page: "simple-page", title: "Step 2", dims: { role: "user", phase: "p2" } })
      m.scenarios[0].steps[0].dims = { role: "user", phase: "p1" }
    })
    expect(errors.some((e) => e.includes("pin 2 values of workspace-scoped"))).toBe(true)
  })

  it("errors when a step's page does not exist at the value the scenario pins", async () => {
    const { errors } = await run((m) => {
      withPhase(m, ["p1"])
      m.scenarios[0].steps[0].dims = { role: "user", phase: "p1" }
      m.scenarios[0].steps.push({ page: "organism-page", title: "Step 2" })
      // @ts-expect-error the fixture's dimension map is narrowed to the base shape
      m.pages[1].dimensions.phase = ["p2"]
      m.pages[1].instances = [{ dims: { phase: "p2" } }]
    })
    expect(errors.some((e) => e.includes('does not exist at "phase=p1"'))).toBe(true)
  })

  it("warns when no page varies by a workspace-scoped axis", async () => {
    const { warnings } = await run((m) => {
      withPhase(m)
      // @ts-expect-error the fixture's dimension map is narrowed to the base shape
      delete m.pages[0].dimensions.phase
    })
    expect(warnings.some((w) => w.includes("no page varies by it"))).toBe(true)
  })

  it("warns when a workspace value has no page at all", async () => {
    const { warnings } = await run((m) => withPhase(m, ["p1"]))
    expect(warnings.some((w) => w.includes('no page exists at "p2"'))).toBe(true)
  })
})
