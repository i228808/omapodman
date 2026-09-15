const fs = require("fs")
const path = require("path")
const vm = require("vm")
const assert = require("assert")

function load(file) {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8")
    .replace(/^\s*\.pragma\s+library\s*$/m, "")

  const before = new Set(Object.getOwnPropertyNames(globalThis))
  vm.runInThisContext(source, { filename: file })

  const namespace = {}
  for (const name of Object.getOwnPropertyNames(globalThis)) {
    if (!before.has(name)) namespace[name] = globalThis[name]
  }
  return namespace
}

const Model = load("Model.js")

let passed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed += 1
  } catch (error) {
    failures.push({ name: name, error: error })
  }
}

function report() {
  for (const failure of failures) {
    console.error("FAIL  " + failure.name)
    console.error("      " + String(failure.error.message).split("\n").join("\n      "))
  }
  console.log(`${passed} passed, ${failures.length} failed`)
  return failures.length === 0 ? 0 : 1
}

function psRow(overrides) {
  return Object.assign({
    ID: "abc123def456",
    Names: "container",
    Image: "alpine:latest",
    State: "running",
    Status: "Up 2 hours",
    HealthStatus: "none",
    Labels: "",
    Ports: ""
  }, overrides || {})
}

function container(overrides) {
  return Model.normalizeContainer(psRow(overrides))
}

function make(name, project, state, extra) {
  return container(Object.assign({
    ID: name,
    Names: name,
    State: state || "running",
    Status: state === "exited" ? "Exited (0) 1 hour ago" : "Up 1 hour",
    Labels: project ? "com.docker.compose.project=" + project : ""
  }, extra || {}))
}

function rowsOf(containers) {
  return Model.rowsFor(Model.sectionsFor(containers))
}

function imageRow(overrides) {
  return Object.assign({
    ID: "7fd8eaad6bb6",
    Repository: "alpine",
    Tag: "latest",
    Size: "3.62GB",
    CreatedSince: "7 days ago",
    Containers: "0"
  }, overrides || {})
}

function volumeRow(overrides) {
  return Object.assign({
    Name: "shop_pgdata",
    Driver: "local",
    Mountpoint: "/home/user/.local/share/containers/storage/volumes/shop_pgdata/_data",
    Labels: "com.docker.compose.project=shop,com.docker.compose.volume=pgdata",
    Links: "N/A",
    Size: "N/A"
  }, overrides || {})
}

function networkRow(overrides) {
  return Object.assign({
    ID: "f638321f8a24",
    Name: "shop_default",
    Driver: "bridge",
    Scope: "local",
    IPv6: "false",
    Internal: "false",
    Labels: "com.docker.compose.project=shop"
  }, overrides || {})
}

function dfRow(overrides) {
  return Object.assign({
    Type: "Images",
    TotalCount: "43",
    Active: "18",
    Size: "22.18GB",
    Reclaimable: "10.57GB (47%)"
  }, overrides || {})
}

module.exports = {
  test: test,
  eq: assert.deepStrictEqual,
  ok: assert.ok,
  report: report,
  psRow: psRow,
  container: container,
  make: make,
  rowsOf: rowsOf,
  imageRow: imageRow,
  volumeRow: volumeRow,
  networkRow: networkRow,
  dfRow: dfRow,
  Model: Model
}
