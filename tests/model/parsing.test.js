const { test, eq, ok, Model, psRow, container } = require("../harness.js")

const COMPOSE_LABELS = [
  "com.docker.compose.config-hash=cc1093244e32663aff05f25273f67f94d02ec1dca61b0d",
  "com.docker.compose.container-number=1",
  "com.docker.compose.depends_on=",
  "com.docker.compose.project.config_files=/srv/shop/docker-compose.yml,/srv/shop/compose.override.yml",
  "com.docker.compose.project=shop",
  "com.docker.compose.service=api",
  "com.docker.compose.version=5.5.0"
].join(",")

test("parseJsonLines keeps the readable lines and drops the rest", () => {
  const raw = [
    '{"ID":"aaa","Names":"one"}',
    "",
    "Cannot connect to Podman",
    '{"ID":"bbb","Names":"two"}',
    '{"ID":"ccc","Names":',
    "  "
  ].join("\n")
  eq(Model.parseJsonLines(raw).map(row => row.ID), ["aaa", "bbb"])
  eq(Model.parseJsonLines(""), [])
  eq(Model.parseJsonLines(null), [])
})

test("labelValue survives commas inside a label's own value", () => {
  eq(Model.composeProject(COMPOSE_LABELS), "shop")
  eq(Model.labelValue(COMPOSE_LABELS, "com.docker.compose.service"), "api")
  eq(Model.labelValue(COMPOSE_LABELS, "com.docker.compose.depends_on"), "")
  eq(Model.labelValue(COMPOSE_LABELS, "nope"), "")
  eq(Model.composeProject(""), "")
  eq(Model.composeProject(null), "")
})

test("healthOf reads the field, then falls back to the status suffix", () => {
  eq(Model.healthOf(psRow({ HealthStatus: "healthy" })), "healthy")
  eq(Model.healthOf(psRow({ HealthStatus: "none" })), "")
  eq(Model.healthOf({ Status: "Up 2 hours (unhealthy)" }), "unhealthy")
  eq(Model.healthOf({ Status: "Up 3 seconds (health: starting)" }), "starting")
  eq(Model.healthOf({ Status: "Up 2 hours" }), "")
  eq(Model.healthOf(null), "")
})

test("exitCode reads a stopped container's code, or -1 while it runs", () => {
  eq(Model.exitCode("Exited (137) 2 hours ago"), 137)
  eq(Model.exitCode("Exited (0) 2 hours ago"), 0)
  eq(Model.exitCode("Up 2 hours"), -1)
  eq(Model.exitCode(""), -1)
})

test("failing covers a bad exit, alerting deliberately does not", () => {
  const stale = container({ State: "exited", Status: "Exited (1) 17 hours ago" })
  eq(stale.failing, true)
  eq(stale.alerting, false)

  const sick = container({ HealthStatus: "unhealthy", Status: "Up 2 hours (unhealthy)" })
  eq(sick.failing, true)
  eq(sick.alerting, true)

  const looping = container({ State: "restarting", Status: "Restarting (1) 2 seconds ago" })
  eq(looping.alerting, true)
  eq(looping.up, true)

  const clean = container({ State: "exited", Status: "Exited (0) 2 hours ago" })
  eq(clean.failing, false)
  eq(clean.alerting, false)
})

test("health is only read while the container is actually up", () => {
  const stale = container({
    State: "exited",
    Status: "Exited (0) 3 days ago",
    HealthStatus: "unhealthy"
  })
  eq(stale.up, false)
  eq(stale.alerting, false, "a stopped container is never urgent")
  eq(stale.failing, false, "it exited cleanly, whatever its last check said")

  const crashed = container({
    State: "exited",
    Status: "Exited (137) 3 days ago",
    HealthStatus: "unhealthy"
  })
  eq(crashed.failing, true)
  eq(crashed.alerting, false)
})

test("hostPorts dedupes the two address families Podman prints", () => {
  eq(Model.hostPorts("0.0.0.0:3000->3000/tcp, [::]:3000->3000/tcp"), ["3000"])
  eq(Model.hostPorts("127.0.0.1:4000->4000/tcp"), ["4000"])
  eq(Model.hostPorts("0.0.0.0:9001->9001/tcp, [::]:9001->9001/tcp, 0.0.0.0:9002->9002/tcp"),
    ["9001", "9002"])
  eq(Model.hostPorts("3000/tcp"), [])
  eq(Model.hostPorts(""), [])
})

test("shortImage drops the registry and the tag, but not a plain namespace", () => {
  eq(Model.shortImage("ghcr.io/acme/api:1"), "acme/api")
  eq(Model.shortImage("minio/mc:RELEASE.2025-08-13T08-35-41Z"), "minio/mc")
  eq(Model.shortImage("alpine:latest"), "alpine")
  eq(Model.shortImage("shop-api"), "shop-api")
  eq(Model.shortImage("localhost:5000/thing:dev"), "thing")
  eq(Model.shortImage("sha256:f6d088e608ca5014169551e328627f70"), "sha256:f6d088e608ca")
  eq(Model.shortImage(""), "")
})

test("normalizeContainer folds one ps row into the row's own shape", () => {
  const row = Model.normalizeContainer({
    ID: "ed42e44629ec",
    Names: "shop-api",
    Image: "ghcr.io/acme/api:1",
    State: "running",
    Status: "Up 2 hours (healthy)",
    HealthStatus: "healthy",
    Ports: "127.0.0.1:4000->4000/tcp",
    Labels: COMPOSE_LABELS
  })
  eq(row.id, "ed42e44629ec")
  eq(row.name, "shop-api")
  eq(row.shortImage, "acme/api")
  eq(row.project, "shop")
  eq(row.service, "api")
  eq(row.health, "healthy")
  eq(row.ports, ["4000"])
  eq(row.up, true)
  eq(row.failing, false)
})

test("normalizeContainers drops rows with no id rather than listing a blank", () => {
  eq(Model.normalizeContainers([psRow({ ID: "aaa" }), { Names: "orphan" }]).length, 1)
  eq(Model.normalizeContainers(null), [])
})

test("parsePercent and memUsed read the stats columns", () => {
  eq(Model.parsePercent("0.75%"), 0.75)
  eq(Model.parsePercent("142.30%"), 142.3)
  eq(Model.parsePercent("--"), -1)
  eq(Model.parsePercent(""), -1)
  eq(Model.memUsed("238.5MiB / 31.21GiB"), "238.5MiB")
  eq(Model.memUsed("0B / 31.21GiB"), "0B")
  eq(Model.memUsed(""), "")
})

test("indexStats keys stats output by the id ps also reports", () => {
  const raw = [
    '{"BlockIO":"136MB / 2.69MB","CPUPerc":"0.10%","Container":"ecc682f86872a39e4fc417276159f1c3","ID":"ecc682f86872","MemPerc":"0.75%","MemUsage":"238.5MiB / 31.21GiB","Name":"shop-web","NetIO":"1.86MB / 33.8MB","PIDs":"39"}',
    '{"BlockIO":"106MB / 0B","CPUPerc":"0.00%","Container":"ed42e44629ecce5f7602bcadfb0a7184","ID":"ed42e44629ec","MemPerc":"0.13%","MemUsage":"41.59MiB / 31.21GiB","Name":"shop-api","NetIO":"14.7kB / 126B","PIDs":"11"}'
  ].join("\n")
  const stats = Model.indexStats(Model.parseJsonLines(raw))
  eq(stats["ecc682f86872"].cpu, "0.10%")
  eq(stats["ecc682f86872"].cpuPercent, 0.1)
  eq(stats["ecc682f86872"].mem, "238.5MiB")
  eq(stats["ecc682f86872"].memPercent, 0.75)
  eq(stats["ed42e44629ec"].mem, "41.59MiB")
  ok(!stats["nope"])
})
