import { describe, expect, it } from "vitest"
import { extractSection, findEmbeds, parseStavyRef, renderMarkdown, safeUrl, sanitizeHtml, splitSrc } from "../../src/stavy/boards/markdown"

describe("renderMarkdown", () => {
  it("renders headings, lists, tables and code", () => {
    const html = renderMarkdown("# Rules\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nx < 1\n```")
    expect(html).toContain('<h1 id="rules">Rules</h1>')
    expect(html).toContain("<li>one</li>")
    expect(html).toContain("<table>")
    expect(html).toContain("x &lt; 1")
  })

  it("escapes raw HTML instead of rendering it", () => {
    const html = renderMarkdown('Hi <script>alert(1)</script> <img src=x onerror="alert(1)">')
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/<img/i)
    expect(html).toContain("&lt;script&gt;")
  })

  it("drops script URLs from links and images, keeping the text", () => {
    const html = renderMarkdown("[click](javascript:alert(1)) ![pic](javascript:alert(2)) [ok](https://example.com)")
    expect(html).not.toMatch(/javascript:/i)
    expect(html).toContain("click")
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it("turns stavy: images into embed placeholders and stavy: links into player links", () => {
    const html = renderMarkdown("![Empty list](stavy:expenses/empty)\n\nSee [the queue](stavy:dashboard?role=manager).")
    expect(html).toContain('class="ps-md-embed" data-embed="stavy:expenses/empty" data-caption="Empty list"')
    expect(html).toContain('data-stavy-ref="stavy:dashboard?role=manager"')
  })

  it("resolves relative images through the given resolver", () => {
    const html = renderMarkdown("![a](assets/a.png)", { resolveUrl: (u) => `/stavy-content/${u}` })
    expect(html).toContain('src="/stavy-content/assets/a.png"')
  })

  it("inline mode keeps text inline with line breaks", () => {
    const html = renderMarkdown("**Bold** and _it_\nnext", { inline: true })
    expect(html).toContain("<strong>Bold</strong>")
    expect(html).toContain("<br>")
    expect(html).not.toContain("<p>")
  })

  it("keeps prose that merely looks like an attribute", () => {
    expect(renderMarkdown("onboarding = 2 steps")).toContain("onboarding = 2 steps")
  })
})

describe("sanitizeHtml", () => {
  it("strips script elements, handlers and script URLs", () => {
    const out = sanitizeHtml(
      '<p onclick="x()">a</p><script>bad()</script><a href="javascript:x">l</a><a href="jav&#x61;script:x">m</a><img src="data:text/html;base64,xx"><iframe src="https://x"></iframe>'
    )
    expect(out).toBe('<p>a</p><a>l</a><a>m</a><img>')
  })
  it("keeps safe URLs", () => {
    const html = '<a href="/docs/a.md">a</a><img src="https://x/y.png"><a href="#top">t</a><a href="mailto:a@b.c">m</a>'
    expect(sanitizeHtml(html)).toBe(html)
  })
})

describe("safeUrl", () => {
  it("allows only harmless schemes", () => {
    expect(safeUrl("https://a.b", "link")).toBe("https://a.b")
    expect(safeUrl("java\nscript:alert(1)", "link")).toBeNull()
    expect(safeUrl("data:image/png;base64,AAA", "image")).not.toBeNull()
    expect(safeUrl("data:image/png;base64,AAA", "link")).toBeNull()
    expect(safeUrl("vbscript:x", "link")).toBeNull()
  })
})

describe("stavy references", () => {
  it("parses page, state and dims", () => {
    expect(parseStavyRef("stavy:expenses")).toEqual({ page: "expenses" })
    expect(parseStavyRef("stavy:expenses/empty")).toEqual({ page: "expenses", state: "empty" })
    expect(parseStavyRef("stavy:expenses?role=manager&state=empty")).toEqual({ page: "expenses", dims: { role: "manager", state: "empty" } })
    expect(parseStavyRef("stavy:not a ref")).toBeNull()
  })
  it("finds embeds in order", () => {
    const e = findEmbeds("x ![One](stavy:a/b) y ![](stavy:c) ![img](pic.png)")
    expect(e.map((x) => x.raw)).toEqual(["stavy:a/b", "stavy:c"])
    expect(e[0].caption).toBe("One")
  })
})

describe("extractSection", () => {
  const md = "# Doc\n\nintro\n\n## Approval limits\n\nUnder 500.\n\n### Detail\n\nmore\n\n## Other\n\nnope\n"
  it("returns one section with its subsections", () => {
    const s = extractSection(md, "approval-limits")
    expect(s.startsWith("## Approval limits")).toBe(true)
    expect(s).toContain("### Detail")
    expect(s).not.toContain("Other")
  })
  it("matches by heading text too, and falls back to the whole file", () => {
    expect(extractSection(md, "Approval%20limits")).toContain("Under 500.")
    expect(extractSection(md, "missing")).toBe(md)
  })
  it("ignores headings inside code fences", () => {
    const src = "## A\n\n```\n## B\n```\n\ntext\n\n## C\n"
    expect(extractSection(src, "a")).toContain("text")
  })
  it("splits src paths", () => {
    expect(splitSrc("docs/rules.md#limits")).toEqual({ file: "docs/rules.md", heading: "limits" })
    expect(splitSrc("docs/rules.md")).toEqual({ file: "docs/rules.md" })
  })
})
