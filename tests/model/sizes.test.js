const { test, eq, ok, Model, dfRow } = require("../harness.js")

test("parseSize reads both unit families Podman prints", () => {
  eq(Model.parseSize("3.62GB"), 3.62e9)
  eq(Model.parseSize("1.07GB"), 1.07e9, "and never a fraction of a byte")
  eq(Model.parseSize("22.18 GB"), 22.18e9)
  eq(Model.parseSize("512B"), 512)
  eq(Model.parseSize("238.5MiB"), 238.5 * 1048576)
  eq(Model.parseSize("31.21GiB"), Math.round(31.21 * 1073741824))
  eq(Model.parseSize("0B"), 0)
})

test("parseSize takes the number off a reclaimable column and ignores the percentage", () => {
  eq(Model.parseSize("1.479GB (99%)"), 1.479e9)
  eq(Model.parseSize("32.47GB"), 32.47e9)
})

test("parseSize says -1 rather than guessing", () => {
  eq(Model.parseSize("N/A"), -1)
  eq(Model.parseSize(""), -1)
  eq(Model.parseSize(null), -1)
  eq(Model.parseSize(undefined), -1)
  eq(Model.parseSize("Exited (0) 2 hours ago"), -1)
  eq(Model.parseSize("-4GB"), -1)
})

test("formatSize keeps three significant figures and never more", () => {
  eq(Model.formatSize(0), "0 B")
  eq(Model.formatSize(512), "512 B")
  eq(Model.formatSize(1000), "1.00 kB")
  eq(Model.formatSize(23.38e6), "23.4 MB")
  eq(Model.formatSize(3.62e9), "3.62 GB")
  eq(Model.formatSize(22.18e9), "22.2 GB")
  eq(Model.formatSize(322e9), "322 GB")
  eq(Model.formatSize(4.5e12), "4.50 TB")
})

test("formatSize prints nothing at all for a size Podman would not give us", () => {
  eq(Model.formatSize(-1), "")
  eq(Model.formatSize(NaN), "")
  eq(Model.formatSize("3GB"), "")
  eq(Model.formatSize(undefined), "")
})

test("a size round-trips through both halves without drifting", () => {
  for (const text of ["3.62GB", "23.38MB", "1.07GB", "512B"]) {
    ok(Model.formatSize(Model.parseSize(text)) !== "", text + " survives")
  }
})

test("sumSizes adds what it knows and stays -1 when it knows nothing", () => {
  eq(Model.sumSizes([{ sizeBytes: 1e9 }, { sizeBytes: 2e9 }]), 3e9)
  eq(Model.sumSizes([{ sizeBytes: 1e9 }, { sizeBytes: -1 }]), 1e9)
  eq(Model.sumSizes([{ sizeBytes: -1 }, { sizeBytes: -1 }]), -1)
  eq(Model.sumSizes([]), -1)
  eq(Model.sumSizes(null), -1)
})

test("indexUsage keys podman system df by the type name it prints", () => {
  const usage = Model.indexUsage([
    dfRow(),
    dfRow({ Type: "Local Volumes", TotalCount: "30", Active: "18", Size: "17.65GB", Reclaimable: "5.231GB (29%)" }),
    dfRow({ Type: "Build Cache", TotalCount: "322", Active: "0", Size: "38.67GB", Reclaimable: "32.47GB" })
  ])
  eq(usage["Images"].count, 43)
  eq(usage["Images"].active, 18)
  eq(usage["Images"].sizeBytes, 22.18e9)
  eq(usage["Images"].reclaimableBytes, 10.57e9)
  eq(usage["Local Volumes"].count, 30)
  eq(usage["Build Cache"].reclaimableBytes, 32.47e9)
  ok(!usage["Networks"])
  eq(Model.indexUsage(null), {})
})

test("usageFor maps a tab onto the row podman system df calls it", () => {
  const usage = Model.indexUsage([dfRow({ Type: "Local Volumes", TotalCount: "30" })])
  eq(Model.usageFor(usage, "volumes").count, 30)
  eq(Model.usageFor(usage, "images"), null)
  eq(Model.usageFor(usage, "networks"), null)
  eq(Model.usageFor({}, "nonsense"), null)
})

test("usageText reads as a sentence on the tabs that cost disk", () => {
  const usage = Model.indexUsage([
    dfRow(),
    dfRow({ Type: "Local Volumes", TotalCount: "30", Size: "17.65GB", Reclaimable: "5.231GB (29%)" }),
    dfRow({ Type: "Containers", TotalCount: "1", Size: "1.483GB", Reclaimable: "0B (0%)" })
  ])
  eq(Model.usageText(usage, "images", []), "43 images · 22.2 GB · 10.6 GB reclaimable")
  eq(Model.usageText(usage, "volumes", []), "30 volumes · 17.6 GB · 5.23 GB reclaimable")
  eq(Model.usageText(usage, "containers", []), "1 container · 1.48 GB")
})

test("usageText counts idle networks, because networks cost no disk", () => {
  const nets = [{ inUse: true }, { inUse: false }, { inUse: false }]
  eq(Model.usageText({}, "networks", nets), "3 networks · 2 unused")
  eq(Model.usageText({}, "networks", [{ inUse: true }]), "1 network")
  eq(Model.usageText({}, "networks", []), "0 networks")
})

test("usageText falls back to a plain count before podman system df answers", () => {
  eq(Model.usageText({}, "images", [{}, {}]), "2 images")
  eq(Model.usageText({}, "images", []), "")
})
