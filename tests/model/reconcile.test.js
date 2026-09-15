const { test, eq, ok, Model, make, rowsOf } = require("../harness.js")

function apply(current, rows) {
  const model = current.map(r => Object.assign({}, r))
  const inserted = []
  const updated = []

  for (const op of Model.reconcilePlan(model.map(r => r.key), rows)) {
    if (op.op === "remove") model.splice(op.index, 1)
    else if (op.op === "move") model.splice(op.to, 0, model.splice(op.from, 1)[0])
    else {
      model.splice(op.index, 0, Object.assign({}, op.row))
      inserted.push(op.row.key)
    }
  }

  model.forEach((entry, i) => {
    for (const field of Model.ROW_FIELDS) {
      if (entry[field] === rows[i][field]) continue
      entry[field] = rows[i][field]
      if (!inserted.includes(entry.key) && !updated.includes(entry.key)) updated.push(entry.key)
    }
  })
  return { model: model, inserted: inserted, updated: updated }
}

test("an unchanged list produces no operations at all", () => {
  const rows = rowsOf([make("a", "p"), make("b", "p")])
  eq(Model.reconcilePlan(rows.map(r => r.key), rows), [])
})

test("Podman re-humanizing 'Up 2 hours' rebuilds no delegate", () => {
  const before = rowsOf([make("a", "p", "running", { Status: "Up 59 seconds" })])
  const after = rowsOf([make("a", "p", "running", { Status: "Up About a minute" })])

  const plan = Model.reconcilePlan(before.map(r => r.key), after)
  eq(plan, [], "no structural op")

  const result = apply(before, after)
  eq(result.inserted, [], "nothing is rebuilt")
  eq(result.updated, ["a"], "the row is updated in place")
  eq(result.model[0].status, "Up About a minute", "and the text still lands")
})

test("starting a container moves its row instead of replacing it", () => {
  const before = rowsOf([make("web", "p"), make("worker", "p", "exited")])
  eq(before.map(r => r.key), ["web", "worker"])

  const after = rowsOf([make("web", "p"), make("worker", "p")])
  const plan = Model.reconcilePlan(before.map(r => r.key), after)
  eq(plan, [])

  const result = apply(before, after)
  eq(result.inserted, [], "nothing is rebuilt")
  eq(result.model[1].up, true)
  eq(result.updated.sort(), ["web", "worker"])
})

test("a container that sorts past its neighbour moves, and nothing else does", () => {
  const before = rowsOf([make("a-svc", "p", "exited"), make("z-svc", "p")])
  eq(before.map(r => r.key), ["z-svc", "a-svc"])

  const after = rowsOf([make("a-svc", "p"), make("z-svc", "p")])
  eq(after.map(r => r.key), ["a-svc", "z-svc"])

  const plan = Model.reconcilePlan(before.map(r => r.key), after)
  eq(plan, [{ op: "move", from: 1, to: 0 }])
  eq(apply(before, after).model.map(r => r.key), ["a-svc", "z-svc"])
})

test("a new container is inserted at its place, leaving its neighbours alone", () => {
  const before = rowsOf([make("a", "p"), make("c", "p")])
  const after = rowsOf([make("a", "p"), make("b", "p"), make("c", "p")])

  const plan = Model.reconcilePlan(before.map(r => r.key), after)
  eq(plan.length, 1)
  eq(plan[0].op, "insert")
  eq(plan[0].index, 1)
  eq(plan[0].row.key, "b")

  const result = apply(before, after)
  eq(result.model.map(r => r.key), ["a", "b", "c"])
  eq(result.inserted, ["b"], "only the new row is built")
  eq(result.updated.sort(), ["a", "c"])
})

test("removals go back to front so the indices ahead of them stay valid", () => {
  const before = rowsOf([make("a", "p"), make("b", "p"), make("c", "p"), make("d", "p")])
  const after = rowsOf([make("b", "p"), make("d", "p")])

  eq(Model.reconcilePlan(before.map(r => r.key), after),
    [{ op: "remove", index: 2 }, { op: "remove", index: 0 }])
  eq(apply(before, after).model.map(r => r.key), ["b", "d"])
})

test("a filter that empties the list clears it, and clearing refills it", () => {
  const all = rowsOf([make("a", "p"), make("b", "p")])
  eq(apply(all, []).model, [])
  eq(apply([], all).model.map(r => r.key), ["a", "b"])
})

test("the plan lands on the right order however the list was shuffled", () => {
  const names = ["a", "b", "c", "d", "e", "f"]
  const rows = rowsOf(names.map(n => make(n, "p")))

  const cases = []
  for (let i = 0; i < names.length; i++) cases.push(names.slice(i).concat(names.slice(0, i)))
  cases.push(names.slice().reverse())
  cases.push(["c", "a"])
  cases.push(["f", "e", "a", "b"])

  for (const order of cases) {
    const target = order.map(n => rows.find(r => r.key === n))
    const result = apply(rows, target)
    eq(result.model.map(r => r.key), order, "reached " + order.join(","))
  }
})

test("a whole project appearing at once inserts only its own rows", () => {
  const before = rowsOf([make("solo", "zeta")])
  const after = rowsOf([make("solo", "zeta"), make("one", "alpha"), make("two", "alpha")])

  eq(after.map(r => r.key), ["one", "two", "solo"])
  const result = apply(before, after)
  eq(result.model.map(r => r.key), ["one", "two", "solo"])
  eq(result.inserted.sort(), ["one", "two"], "only the new project is built")
  eq(result.updated, ["solo"])
  eq(result.model[2].firstSection, false)
})

test("a row picking up its section's header updates in place", () => {
  const before = rowsOf([make("a", "p"), make("b", "p")])
  eq(before.map(r => r.sectionTitle), ["p", ""])

  const after = rowsOf([make("b", "p")])
  eq(after.map(r => r.sectionTitle), ["p"])

  const result = apply(before, after)
  eq(result.model.map(r => r.key), ["b"])
  eq(result.model[0].sectionTitle, "p")
})

test("the section tally on every row of a project follows the project", () => {
  const before = rowsOf([make("a", "p"), make("b", "p", "exited")])
  eq(before.map(r => r.sectionTally), ["1/2", "1/2"])
  eq(before.map(r => r.sectionToggle), ["stop", "stop"])

  const after = rowsOf([make("a", "p"), make("b", "p")])
  const result = apply(before, after)
  eq(result.model.map(r => r.sectionTally), ["2/2", "2/2"])
  eq(Model.reconcilePlan(before.map(r => r.key), after), [], "still no rebuild")
})

test("reconcilePlan tolerates being handed nothing", () => {
  eq(Model.reconcilePlan(null, null), [])
  eq(Model.reconcilePlan(undefined, []), [])
})

test("ROW_FIELDS covers every mutable field a row carries", () => {
  const row = rowsOf([make("a", "p")])[0]
  const identity = ["key", "id"]
  const covered = Model.ROW_FIELDS.concat(identity).sort()
  eq(Object.keys(row).sort(), covered,
    "a field that is neither identity nor in ROW_FIELDS would go stale")
})
