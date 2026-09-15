const { test, eq, ok, Model, container, rowsOf, make } = require("../harness.js")

const MARKUP = '<img src="http://evil.test/x.png">'

test("sanitize strips control characters", () => {
  eq(Model.sanitize("a\u0000b"), "ab")
  eq(Model.sanitize("a\u001bb"), "ab")
  eq(Model.sanitize("a\nb\tc"), "abc")
  eq(Model.sanitize("a\u007fb"), "ab")
  eq(Model.sanitize("a\u009bb"), "ab")
  eq(Model.sanitize("  padded  "), "padded")
  eq(Model.sanitize(null), "")
  eq(Model.sanitize(undefined), "")
})

test("sanitize removes the characters that start rich text", () => {
  eq(Model.sanitize(MARKUP), 'img src="http://evil.test/x.png"')
  eq(Model.sanitize("<b>x</b>"), "bx/b")
  eq(Model.sanitize("a&lt;b"), "alt;b")
  ok(Model.sanitize(MARKUP).indexOf("<") === -1)
  ok(Model.sanitize(MARKUP).indexOf("&") === -1)
})

test("sanitize clamps to a fixed length with an ellipsis", () => {
  eq(Model.sanitize("x".repeat(200)).length, 64)
  ok(Model.sanitize("x".repeat(200)).endsWith("…"))
  eq(Model.sanitize("x".repeat(200), 10), "xxxxxxxxx…")
  eq(Model.sanitize("short", 10), "short")
})

test("a hostile compose project label cannot reach the section header", () => {
  const evil = make("c1", MARKUP + "x".repeat(300))
  eq(evil.project.length <= 32, true)
  ok(evil.project.indexOf("<") === -1)

  const rows = rowsOf([evil])
  ok(rows[0].sectionTitle.indexOf("<") === -1)
  ok(rows[0].sectionTitle.length <= 32)
})

test("every externally supplied display field is bounded and inert", () => {
  const evil = container({
    Names: MARKUP + "name",
    Image: MARKUP + "image",
    Status: MARKUP + "Up 2 hours",
    Labels: "com.docker.compose.project=" + MARKUP +
      ",com.docker.compose.service=" + MARKUP
  })
  for (const field of ["name", "image", "shortImage", "state", "status", "project", "service"]) {
    ok(evil[field].indexOf("<") === -1, field + " carries no markup")
    ok(evil[field].indexOf("&") === -1, field + " carries no entity")
    ok(evil[field].length <= 64, field + " is bounded")
  }
  ok(Model.subtitleText(evil).indexOf("<") === -1)
  ok(Model.subtitleText(evil).length <= 96)
})

test("stats readings are bounded too", () => {
  const stats = Model.indexStats([{
    ID: "abc123",
    CPUPerc: MARKUP,
    MemPerc: "1%",
    MemUsage: MARKUP + " / 31GiB"
  }])
  ok(stats["abc123"].cpu.indexOf("<") === -1)
  ok(stats["abc123"].cpu.length <= 12)
  ok(stats["abc123"].mem.length <= 12)
})

test("only plain alphanumeric container ids are accepted", () => {
  ok(Model.isContainerId("ecc682f86872"))
  ok(Model.isContainerId("a"))
  ok(!Model.isContainerId(""))
  ok(!Model.isContainerId("--rm"))
  ok(!Model.isContainerId("../etc/passwd"))
  ok(!Model.isContainerId("a b"))
  ok(!Model.isContainerId("a;rm -rf /"))
  ok(!Model.isContainerId("x".repeat(129)))
})

test("a container whose id is not an id is dropped before it reaches a command", () => {
  const list = Model.normalizeContainers([
    { ID: "ecc682f86872", Names: "good", State: "running", Status: "Up 1 hour" },
    { ID: "--privileged", Names: "bad", State: "running", Status: "Up 1 hour" },
    { ID: "", Names: "blank", State: "running", Status: "Up 1 hour" }
  ])
  eq(list.map(c => c.name), ["good"])
})

test("ports are capped so one container cannot fill the row", () => {
  const many = Array.from({ length: 40 }, (_, i) => `0.0.0.0:${9000 + i}->${9000 + i}/tcp`).join(", ")
  eq(container({ Ports: many }).ports.length, 6)
})
