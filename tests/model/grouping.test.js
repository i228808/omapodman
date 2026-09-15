const { test, eq, ok, Model, make, rowsOf } = require("../harness.js")

test("filterContainers matches name, image, project, service and id", () => {
  const list = [make("web", "shop"), make("db", "shop")]
  eq(Model.filterContainers(list, "web").length, 1)
  eq(Model.filterContainers(list, "SHOP").length, 2)
  eq(Model.filterContainers(list, "alpine").length, 2)
  eq(Model.filterContainers(list, "nothing").length, 0)
  eq(Model.filterContainers(list, "  ").length, 2)
  eq(Model.filterContainers(list, "").length, 2)
})

test("sections are one per project, ungrouped last", () => {
  const sections = Model.sectionsFor([
    make("loose", ""),
    make("zeta-web", "zeta"),
    make("alpha-web", "alpha")
  ])
  eq(sections.map(s => s.title), ["alpha", "zeta", "Ungrouped"])
  eq(sections[2].containers.map(c => c.name), ["loose"])
})

test("a lone ungrouped section drops its header", () => {
  const sections = Model.sectionsFor([make("a", ""), make("b", "")])
  eq(sections.length, 1)
  eq(sections[0].title, "")
  eq(sections[0].total, 2)
})

test("a project genuinely named ungrouped keeps its own header", () => {
  const sections = Model.sectionsFor([make("a", "ungrouped"), make("b", "")])
  eq(sections.map(s => s.title), ["ungrouped", "Ungrouped"])
  ok(sections[0].key !== sections[1].key)
})

test("within a section: running, then failed, then the rest by name", () => {
  const sections = Model.sectionsFor([
    make("z-running", "p"),
    make("a-clean-stop", "p", "exited"),
    make("m-crashed", "p", "exited", { Status: "Exited (1) 1 hour ago" }),
    make("a-running", "p")
  ])
  eq(sections[0].containers.map(c => c.name),
    ["a-running", "z-running", "m-crashed", "a-clean-stop"])
  eq(sections[0].runningCount, 2)
  eq(sections[0].runningIds, ["a-running", "z-running"])
  eq(sections[0].stoppedIds, ["m-crashed", "a-clean-stop"])
})

test("rowsFor gives the section title to the first row only", () => {
  const rows = rowsOf([make("a", "one"), make("b", "one"), make("c", "two")])
  eq(rows.map(r => r.sectionTitle), ["one", "", "two"])
  eq(rows.map(r => r.firstSection), [true, true, false])
  eq(rows.map(r => r.name), ["a", "b", "c"])
})

test("rows are flat primitives, because a ListModel mangles anything else", () => {
  for (const value of Object.values(rowsOf([make("a", "p")])[0])) {
    ok(["string", "number", "boolean"].includes(typeof value),
      "got " + typeof value + " on a row")
  }
})

test("the cursor index is the row index", () => {
  const containers = [make("a", "one"), make("b", "two")]
  const rows = rowsOf(containers)
  eq(Model.containerAtCursor(containers, rows, 0).name, "a")
  eq(Model.containerAtCursor(containers, rows, 1).name, "b")
  eq(Model.containerAtCursor(containers, rows, 2), null)
  eq(Model.containerAtCursor(containers, rows, -1), null)
  eq(Model.containerAtCursor(containers, [], 0), null)
})

test("clampCursor keeps the cursor inside a list that just got shorter", () => {
  eq(Model.clampCursor(7, 3), 2)
  eq(Model.clampCursor(-4, 3), 0)
  eq(Model.clampCursor(1, 3), 1)
  eq(Model.clampCursor(2, 0), 0)
})

test("counts separates ended-badly from needs-attention", () => {
  const c = Model.counts([
    make("up", "p"),
    make("old", "p", "exited", { Status: "Exited (1) 17 hours ago" }),
    make("sick", "p", "running", { HealthStatus: "unhealthy" })
  ])
  eq(c, { total: 3, running: 2, stopped: 1, failing: 2, alerting: 1 })
  eq(Model.counts([]), { total: 0, running: 0, stopped: 0, failing: 0, alerting: 0 })
})

test("sectionAction brings a project down if any of it is up", () => {
  const [mixed] = Model.sectionsFor([make("a", "p"), make("b", "p", "exited")])
  eq(Model.sectionAction(mixed), { verb: "stop", ids: ["a"] })

  const [down] = Model.sectionsFor([make("a", "q", "exited"), make("b", "q", "exited")])
  eq(Model.sectionAction(down), { verb: "start", ids: ["a", "b"] })

  eq(Model.sectionAction(null), null)
  eq(Model.sectionAction({ total: 0 }), null)
})

test("sectionByKey finds the section a row only knows by key", () => {
  const sections = Model.sectionsFor([make("a", "one"), make("b", "")])
  const rows = rowsOf([make("a", "one"), make("b", "")])
  eq(Model.sectionByKey(sections, rows[0].sectionKey).title, "one")
  eq(Model.sectionByKey(sections, rows[1].sectionKey).title, "Ungrouped")
  eq(Model.sectionByKey(sections, "nope"), null)
})
