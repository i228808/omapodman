const { test, eq, ok, Model, imageRow, volumeRow, networkRow, make } = require("../harness.js")

const MARKUP = '<img src="http://evil.test/x.png">'

function rowsOf(kind, items) {
  return Model.rowsForSections(Model.usageSectionsFor(items), kind)
}

// ------------------------------------------------------------------- tabs

test("the tabs are a ring the arrow keys walk in both directions", () => {
  eq(Model.TABS.map(t => t.key), ["containers", "images", "volumes", "networks"])
  eq(Model.shiftTab("containers", 1), "images")
  eq(Model.shiftTab("networks", 1), "containers", "forward off the end wraps")
  eq(Model.shiftTab("containers", -1), "networks", "and back off the front wraps too")
  eq(Model.tabKeyAt(2), "volumes")
  eq(Model.tabKeyAt(99), "networks", "an index past the end clamps")
  ok(Model.isTabKey("volumes"))
  ok(!Model.isTabKey("buildcache"))
})

test("an unknown tab key never crashes a caller, it reads as the first tab", () => {
  eq(Model.tabIndex("nonsense"), 0)
  eq(Model.tabNoun("nonsense"), "container")
  eq(Model.shiftTab("nonsense", 1), "images")
})

// ----------------------------------------------------------------- parsing

test("parseTagged splits one shell round-trip into a list and a verdict", () => {
  const raw = [
    '{"Name":"a"}',
    '{"Name":"b"}',
    "#UNUSED",
    "b",
    ""
  ].join("\n")
  const parsed = Model.parseTagged(raw)
  eq(parsed.records.map(r => r.Name), ["a", "b"])
  eq(parsed.unused, ["b"])
})

test("parseTagged survives a truncated payload and a daemon error", () => {
  eq(Model.parseTagged(""), { records: [], unused: [] })
  eq(Model.parseTagged(null), { records: [], unused: [] })
  eq(Model.parseTagged('{"Name":"a"}\n{"Name":'), { records: [{ Name: "a" }], unused: [] })
  eq(Model.parseTagged("Cannot connect to Podman"), { records: [], unused: [] })
})

test("hasLabel tells an absent label from one set to an empty string", () => {
  ok(Model.hasLabel("com.docker.volume.anonymous=", "com.docker.volume.anonymous"))
  ok(Model.hasLabel("a=1,com.docker.volume.anonymous=,b=2", "com.docker.volume.anonymous"))
  ok(!Model.hasLabel("com.docker.compose.project=shop", "com.docker.volume.anonymous"))
  ok(!Model.hasLabel("", "anything"))
  eq(Model.labelValue("com.docker.volume.anonymous=", "com.docker.volume.anonymous"), "",
    "which is exactly what labelValue cannot tell you")
})

// ------------------------------------------------------------------ images

test("normalizeImage folds a podman images row into the shared shape", () => {
  const image = Model.normalizeImage(imageRow({
    ID: "708e7c2a26ec", Repository: "ghcr.io/acme/api", Tag: "1.4", Containers: "2", Size: "1.07GB"
  }))
  eq(image.kind, "images")
  eq(image.id, "708e7c2a26ec")
  eq(image.name, "ghcr.io/acme/api:1.4")
  eq(image.sizeBytes, 1.07e9)
  eq(image.containers, 2)
  eq(image.inUse, true)
  eq(image.dangling, false)
})

test("an untagged image is named by its id, and says so underneath", () => {
  const image = Model.normalizeImage(imageRow({ Repository: "<none>", Tag: "<none>", ID: "7fd8eaad6bb6" }))
  eq(image.dangling, true)
  eq(image.name, "7fd8eaad6bb6")
  eq(image.reference, "")
  eq(rowsOf("images", [image])[0].subtitle.indexOf("untagged"), 0)
})

test("a container count Podman withholds counts as in use, never as junk", () => {
  eq(Model.normalizeImage(imageRow({ Containers: "N/A" })).inUse, true)
  eq(Model.normalizeImage(imageRow({ Containers: "" })).inUse, true)
  eq(Model.normalizeImage(imageRow({ Containers: "0" })).inUse, false)
  eq(Model.normalizeImage(imageRow({ Containers: "1" })).inUse, true)
})

test("a sha256 image id is cut to the twelve characters Podman shows", () => {
  eq(Model.normalizeImage(imageRow({ ID: "sha256:" + "a".repeat(64) })).id, "a".repeat(12))
})

test("normalizeImages drops any row whose id could not reach a command", () => {
  eq(Model.normalizeImages([
    imageRow({ ID: "708e7c2a26ec" }),
    imageRow({ ID: "--force" }),
    imageRow({ ID: "" })
  ]).map(i => i.id), ["708e7c2a26ec"])
  eq(Model.normalizeImages(null), [])
})

// ----------------------------------------------------------------- volumes

test("normalizeVolume reads the compose labels and the prune verdict", () => {
  const [volume] = Model.normalizeVolumes([volumeRow()], ["other"])
  eq(volume.kind, "volumes")
  eq(volume.id, "shop_pgdata")
  eq(volume.project, "shop")
  eq(volume.service, "pgdata")
  eq(volume.inUse, true, "podman did not list it as prunable")
  eq(volume.anonymous, false)
  eq(volume.sizeBytes, -1, "the cheap listing does not carry sizes")
})

test("a volume podman would prune is the one marked unused", () => {
  const [volume] = Model.normalizeVolumes([volumeRow()], ["shop_pgdata"])
  eq(volume.inUse, false)
})

test("an anonymous volume is recognised by its label or by its 64-hex name", () => {
  const hex = "5a32626d1a6a41909a85863d4ea531defae7d31ca8775f48e488e4004e88b24f"
  const [byName] = Model.normalizeVolumes([volumeRow({ Name: hex, Labels: "" })], [])
  eq(byName.anonymous, true)
  eq(byName.name, hex.slice(0, 12), "and shown by its first twelve characters")
  eq(byName.id, hex, "while the full name is what reaches podman volume rm")

  const [byLabel] = Model.normalizeVolumes([volumeRow({ Labels: "com.docker.volume.anonymous=" })], [])
  eq(byLabel.anonymous, true)
})

test("mergeVolumeUsage folds in the sizes only podman system df -v knows", () => {
  const volumes = Model.normalizeVolumes([volumeRow(), volumeRow({ Name: "other" })], [])
  const merged = Model.mergeVolumeUsage(volumes, [
    { Name: "shop_pgdata", Size: "23.38MB", Links: "2" }
  ])
  eq(merged[0].sizeBytes, 23.38e6)
  eq(merged[0].links, 2)
  eq(merged[1].sizeBytes, -1, "a volume df did not mention keeps what it had")
  eq(merged[0].id, "shop_pgdata", "and everything else survives the merge")
  eq(volumes[0].sizeBytes, -1, "the input is left alone")
})

test("mergeVolumeUsage ignores a df row that carries no size", () => {
  const volumes = Model.normalizeVolumes([volumeRow()], [])
  const merged = Model.mergeVolumeUsage(volumes, [{ Name: "shop_pgdata", Size: "N/A", Links: "N/A" }])
  eq(merged[0].sizeBytes, -1)
  eq(merged[0].links, -1)
  eq(Model.mergeVolumeUsage(volumes, null)[0].id, "shop_pgdata")
})

test("a volume name that is not a volume name never reaches podman volume rm", () => {
  ok(Model.isVolumeName("shop_pgdata"))
  ok(Model.isVolumeName("a.b-c_d"))
  ok(!Model.isVolumeName("-rf"))
  ok(!Model.isVolumeName("../etc/passwd"))
  ok(!Model.isVolumeName("a b"))
  ok(!Model.isVolumeName("a;rm -rf /"))
  ok(!Model.isVolumeName(""))
  eq(Model.normalizeVolumes([volumeRow({ Name: "--force" })], []), [])
})

// ---------------------------------------------------------------- networks

test("normalizeNetwork reads the driver, the scope and the compose project", () => {
  const [network] = Model.normalizeNetworks([networkRow()], [])
  eq(network.kind, "networks")
  eq(network.id, "f638321f8a24")
  eq(network.name, "shop_default")
  eq(network.driver, "bridge")
  eq(network.project, "shop")
  eq(network.builtin, false)
})

test("the default network Podman made itself is never offered for removal", () => {
  const nets = Model.normalizeNetworks([
    networkRow({ ID: "aaa1", Name: "podman", Labels: "" }),
    networkRow({ ID: "aaa4", Name: "shop_default" })
  ], ["podman", "shop_default"])
  eq(nets.map(n => n.builtin), [true, false])
  eq(nets.map(n => n.inUse), [true, false],
    "a predefined network reads as in use however podman filters it")
})

test("a predefined network says so instead of pretending to have a project", () => {
  const [row] = rowsOf("networks", Model.normalizeNetworks([networkRow({ Name: "podman", Labels: "" })], []))
  ok(row.subtitle.indexOf("predefined") !== -1)
})

test("nothing offers a button that can only ever fail", () => {
  const [builtin] = rowsOf("networks", Model.normalizeNetworks([networkRow({ Name: "podman", Labels: "" })], []))
  eq(builtin.removable, false)
  eq(Model.actionsFor(builtin).map(a => a.verb), ["copy"], "podman will not remove its own default network")
  eq(Model.allowsVerb(builtin, "remove"), false, "and x must not try")

  const [ours] = rowsOf("networks", Model.normalizeNetworks([networkRow()], ["shop_default"]))
  eq(ours.removable, true)
  eq(Model.actionsFor(ours).map(a => a.verb), ["copy", "remove"])

  const running = Model.rowsFor(Model.sectionsFor([make("a", "p")]))[0]
  const stopped = Model.rowsFor(Model.sectionsFor([make("a", "p", "exited")]))[0]
  eq(running.removable, false, "a row can be seconds stale; a live container must survive that")
  eq(stopped.removable, true)
})

// ---------------------------------------------------------------- sections

test("unused comes first, because cleaning up is what these tabs are for", () => {
  const images = Model.normalizeImages([
    imageRow({ ID: "aaa", Repository: "used", Containers: "1", Size: "1GB" }),
    imageRow({ ID: "bbb", Repository: "junk", Containers: "0", Size: "2GB" })
  ])
  const sections = Model.usageSectionsFor(images)
  eq(sections.map(s => s.title), ["Unused", "In use"])
  eq(sections[0].items.map(i => i.id), ["bbb"])
})

test("within a section the biggest thing is at the top", () => {
  const images = Model.normalizeImages([
    imageRow({ ID: "sml", Repository: "small", Containers: "0", Size: "10MB" }),
    imageRow({ ID: "big", Repository: "big", Containers: "0", Size: "4GB" }),
    imageRow({ ID: "mid", Repository: "mid", Containers: "0", Size: "700MB" })
  ])
  eq(Model.usageSectionsFor(images)[0].items.map(i => i.id), ["big", "mid", "sml"])
})

test("equal or unknown sizes fall back to the name so the order never jitters", () => {
  const nets = Model.normalizeNetworks([
    networkRow({ ID: "n1", Name: "zeta" }),
    networkRow({ ID: "n2", Name: "alpha" })
  ], ["zeta", "alpha"])
  eq(Model.usageSectionsFor(nets)[0].items.map(n => n.name), ["alpha", "zeta"])
})

test("a section header counts its members and adds up what they cost", () => {
  const images = Model.normalizeImages([
    imageRow({ ID: "aaa", Repository: "a", Containers: "0", Size: "1GB" }),
    imageRow({ ID: "bbb", Repository: "b", Containers: "0", Size: "3GB" })
  ])
  const [unused] = Model.usageSectionsFor(images)
  eq(unused.tally, "2 · 4.00 GB")
  eq(unused.toggle, "", "nothing about a section of images is a toggle")
  eq(Model.sectionAction(unused), null, "and it carries no start/stop action")
})

test("a section of things with no size at all just counts them", () => {
  const nets = Model.normalizeNetworks([networkRow({ ID: "n1", Name: "a" })], ["a"])
  eq(Model.usageSectionsFor(nets)[0].tally, "1")
})

test("an empty side of the split produces no header at all", () => {
  const images = Model.normalizeImages([imageRow({ ID: "aaa", Containers: "2" })])
  eq(Model.usageSectionsFor(images).map(s => s.key), ["in-use"])
  eq(Model.usageSectionsFor([]), [])
})

// -------------------------------------------------------------------- rows

test("every tab produces rows of exactly one shape", () => {
  const shape = Object.keys(rowsOf("images", Model.normalizeImages([imageRow()]))[0]).sort()
  eq(Object.keys(rowsOf("volumes", Model.normalizeVolumes([volumeRow()], []))[0]).sort(), shape)
  eq(Object.keys(rowsOf("networks", Model.normalizeNetworks([networkRow()], []))[0]).sort(), shape)
  eq(Object.keys(Model.rowsFor(Model.sectionsFor([make("a", "p")]))[0]).sort(), shape)
  eq(Model.ROW_FIELDS.concat(["key", "id"]).sort(), shape,
    "a field outside ROW_FIELDS would go stale in the ListModel")
})

test("rows stay flat primitives, because a ListModel mangles anything else", () => {
  const rows = []
    .concat(rowsOf("images", Model.normalizeImages([imageRow()])))
    .concat(rowsOf("volumes", Model.normalizeVolumes([volumeRow()], [])))
    .concat(rowsOf("networks", Model.normalizeNetworks([networkRow()], [])))
  for (const row of rows) {
    for (const value of Object.values(row)) {
      ok(["string", "number", "boolean"].includes(typeof value), "got " + typeof value)
    }
  }
})

test("an unused row is muted and a used one is lit", () => {
  const images = Model.normalizeImages([
    imageRow({ ID: "aaa", Repository: "junk", Containers: "0" }),
    imageRow({ ID: "bbb", Repository: "live", Containers: "1" })
  ])
  const rows = rowsOf("images", images)
  eq(rows.map(r => r.muted), [true, false])
  eq(rows.map(r => r.up), [false, true])
})

test("a row carries the size it is worth reclaiming in its own right margin", () => {
  eq(rowsOf("images", Model.normalizeImages([imageRow({ Size: "3.62GB" })]))[0].meta, "3.62 GB")
  eq(rowsOf("networks", Model.normalizeNetworks([networkRow()], []))[0].meta, "",
    "and nothing when there is no size to show")
})

test("the section title lands on the first row of the section only", () => {
  const images = Model.normalizeImages([
    imageRow({ ID: "aaa", Repository: "junk", Containers: "0" }),
    imageRow({ ID: "bbb", Repository: "more", Containers: "0" }),
    imageRow({ ID: "ccc", Repository: "live", Containers: "1" })
  ])
  const rows = rowsOf("images", images)
  eq(rows.map(r => r.sectionTitle), ["Unused", "", "In use"])
  eq(rows.map(r => r.firstSection), [true, true, false])
})

test("reconcile treats a resource list exactly as it treats containers", () => {
  const before = rowsOf("volumes", Model.normalizeVolumes([
    volumeRow({ Name: "a" }), volumeRow({ Name: "b" })
  ], ["a", "b"]))
  const after = rowsOf("volumes", Model.normalizeVolumes([volumeRow({ Name: "b" })], ["b"]))
  eq(Model.reconcilePlan(before.map(r => r.key), after), [{ op: "remove", index: 0 }])
})

// ----------------------------------------------------------------- actions

test("a running container offers logs, a shell, restart and stop", () => {
  const row = Model.rowsFor(Model.sectionsFor([make("a", "p")]))[0]
  eq(Model.actionsFor(row).map(a => a.verb), ["logs", "shell", "restart", "stop"])
  eq(Model.actionsFor(row).filter(a => a.danger).map(a => a.verb), ["stop"])
})

test("a stopped container offers removal in place of the shell", () => {
  const row = Model.rowsFor(Model.sectionsFor([make("a", "p", "exited")]))[0]
  eq(Model.actionsFor(row).map(a => a.verb), ["logs", "remove", "start"])
})

test("every other tab offers the same two verbs", () => {
  const byKind = {
    images: rowsOf("images", Model.normalizeImages([imageRow()])),
    volumes: rowsOf("volumes", Model.normalizeVolumes([volumeRow()], [])),
    networks: rowsOf("networks", Model.normalizeNetworks([networkRow()], []))
  }
  for (const kind of ["images", "volumes", "networks"]) {
    eq(Model.actionsFor(byKind[kind][0]).map(a => a.verb), ["copy", "remove"], kind)
  }
  eq(Model.actionsFor(null), [])
})

test("every action carries a glyph and a tooltip, because the panel shows no labels", () => {
  const rows = []
    .concat(Model.rowsFor(Model.sectionsFor([make("a", "p"), make("b", "p", "exited")])))
    .concat(rowsOf("volumes", Model.normalizeVolumes([volumeRow()], [])))
  for (const row of rows) {
    for (const action of Model.actionsFor(row)) {
      eq(Array.from(action.glyph).length, 1, action.verb + " has one glyph")
      ok(action.tooltip.length > 0, action.verb + " has a tooltip")
    }
  }
})

test("a click on the row body copies the string you would actually paste", () => {
  const [volume] = Model.normalizeVolumes([volumeRow()], [])
  eq(Model.copyValue("volumes", volume), "/home/user/.local/share/containers/storage/volumes/shop_pgdata/_data")
  eq(Model.copyValue("images", { id: "708e7c2a26ec" }), "708e7c2a26ec")
  eq(Model.copyValue("containers", { id: "ed42e44629ec" }), "ed42e44629ec")
  eq(Model.copyValue("volumes", null), "")
})

// ---------------------------------------------------------------- commands

test("every removal command is built from a validated identifier", () => {
  eq(Model.removeCommand("containers", "ed42e44629ec"), ["podman", "rm", "ed42e44629ec"])
  eq(Model.removeCommand("images", "708e7c2a26ec"), ["podman", "rmi", "708e7c2a26ec"])
  eq(Model.removeCommand("volumes", "shop_pgdata"), ["podman", "volume", "rm", "shop_pgdata"])
  eq(Model.removeCommand("networks", "f638321f8a24"), ["podman", "network", "rm", "f638321f8a24"])
})

test("a removal command is refused outright rather than escaped", () => {
  for (const kind of ["containers", "images", "volumes", "networks"]) {
    eq(Model.removeCommand(kind, "--force"), null, kind)
    eq(Model.removeCommand(kind, ""), null, kind)
    eq(Model.removeCommand(kind, "a;rm -rf /"), null, kind)
    eq(Model.removeCommand(kind, "../../etc"), null, kind)
  }
  eq(Model.removeCommand("buildcache", "anything"), null)
})

test("no removal or prune ever carries -f for a container, only for the prompt", () => {
  ok(Model.removeCommand("containers", "abc").indexOf("-f") === -1,
    "a stale row must not be able to kill something that came back to life")
  ok(Model.removeCommand("images", "abc").indexOf("-f") === -1)
  for (const key of ["containers", "images", "volumes", "networks"]) {
    const spec = Model.pruneSpec(key)
    eq(spec.args[0], "podman")
    ok(spec.args.indexOf("-f") !== -1, key + " does not stop to ask the terminal")
    ok(spec.message.length > 0, key + " says what it is about to do")
  }
  eq(Model.pruneSpec("nonsense"), null)
})

test("prune is live only when there is genuinely something to reclaim", () => {
  const usage = Model.indexUsage([{ Type: "Images", Size: "1GB", Reclaimable: "0B (0%)" }])
  eq(Model.canPrune("images", usage, [{ inUse: true }]), false)
  eq(Model.canPrune("images", usage, [{ inUse: false }]), true, "even before df catches up")

  const dirty = Model.indexUsage([{ Type: "Images", Size: "1GB", Reclaimable: "500MB (50%)" }])
  eq(Model.canPrune("images", dirty, []), true)

  eq(Model.canPrune("networks", {}, [{ inUse: true }]), false)
  eq(Model.canPrune("networks", {}, [{ inUse: false }]), true)
  eq(Model.canPrune("volumes", {}, []), false)
})

test("the confirmation says what is about to happen, and warns when it will not", () => {
  const [doomed] = Model.normalizeVolumes([volumeRow()], ["shop_pgdata"])
  ok(Model.removeMessage("volumes", doomed).indexOf("shop_pgdata") !== -1)
  ok(Model.removeMessage("volumes", doomed).indexOf("goes with it") !== -1)

  const [held] = Model.normalizeVolumes([volumeRow()], [])
  ok(Model.removeMessage("volumes", held).indexOf("refuse") !== -1)

  const live = Model.normalizeImage(imageRow({ Containers: "2", Repository: "api" }))
  ok(Model.removeMessage("images", live).indexOf("refuse") !== -1)

  const [net] = Model.normalizeNetworks([networkRow()], ["shop_default"])
  eq(Model.removeMessage("networks", net), "Remove network shop_default?")
  eq(Model.removeMessage("networks", null), "")
})

// ------------------------------------------------------------ empty + error

test("the empty line says why the tab is empty, not just that it is", () => {
  const base = { everLoaded: true, daemonReachable: true, permissionDenied: false, filtered: false, showStopped: true }
  eq(Model.emptyText("volumes", Object.assign({}, base, { everLoaded: false })), "Loading…")
  eq(Model.emptyText("volumes", Object.assign({}, base, { permissionDenied: true })), "No access to the Podman storage")
  eq(Model.emptyText("volumes", Object.assign({}, base, { daemonReachable: false })), "Podman unreachable")
  eq(Model.emptyText("volumes", Object.assign({}, base, { filtered: true })), "Nothing on this tab matches that filter")
  eq(Model.emptyText("volumes", base), "No volumes")
  eq(Model.emptyText("networks", base), "No networks")
  eq(Model.emptyText("containers", base), "No containers")
  eq(Model.emptyText("containers", Object.assign({}, base, { showStopped: false })), "No running containers")
})

test("errorText keeps the one line Podman actually explained itself on", () => {
  eq(Model.errorText("Error: volume abc is being used"), "volume abc is being used")
  eq(Model.errorText("\n\nError: no container with name or ID \"abc\" found\n"),
    "no container with name or ID \"abc\" found")
  eq(Model.errorText("plain trouble"), "plain trouble")
  eq(Model.errorText(""), "")
  eq(Model.errorText(null), "")
})

test("a hostile field cannot reach the panel through the new tabs either", () => {
  const [volume] = Model.normalizeVolumes([volumeRow({
    Name: "safe_name", Driver: MARKUP, Labels: "com.docker.compose.project=" + MARKUP
  })], [])
  const image = Model.normalizeImage(imageRow({ Repository: MARKUP, Tag: MARKUP }))
  const [network] = Model.normalizeNetworks([networkRow({ Name: MARKUP + "net", Driver: MARKUP })], [])

  for (const field of [volume.driver, volume.project, image.name, network.name, network.driver]) {
    ok(field.indexOf("<") === -1, "no markup survives")
    ok(field.indexOf("&") === -1, "no entity survives")
  }
  for (const row of [].concat(rowsOf("volumes", [volume]), rowsOf("networks", [network]))) {
    ok(row.subtitle.indexOf("<") === -1)
    ok(row.subtitle.length <= 96)
    ok(row.name.length <= 96)
  }
})

test("filterResources reads the search field every resource carries", () => {
  const volumes = Model.normalizeVolumes([
    volumeRow({ Name: "shop_pgdata" }),
    volumeRow({ Name: "cache", Labels: "" })
  ], [])
  eq(Model.filterResources(volumes, "pg").map(v => v.id), ["shop_pgdata"])
  eq(Model.filterResources(volumes, "SHOP").map(v => v.id), ["shop_pgdata"])
  eq(Model.filterResources(volumes, "").length, 2)
  eq(Model.filterResources(volumes, "  ").length, 2)
  eq(Model.filterResources(volumes, "nothing").length, 0)
  eq(Model.filterResources(null, "x"), [])
})

test("parseVolumeSizeTable reads the plain table podman system df -v answers in", () => {
  const raw = [
    "digify_oracle_23ai_data  1           3.226GB",
    "omapodman-unused-test    0           0B"
  ].join("\n")
  eq(Model.parseVolumeSizeTable(raw), [
    { Name: "digify_oracle_23ai_data", Links: "1", Size: "3.226GB" },
    { Name: "omapodman-unused-test", Links: "0", Size: "0B" }
  ])
})

test("parseVolumeSizeTable skips the header line and tolerates an empty table", () => {
  eq(Model.parseVolumeSizeTable("VOLUME NAME              LINKS       SIZE\nshop_pgdata  1  1.2MB"),
    [{ Name: "shop_pgdata", Links: "1", Size: "1.2MB" }])
  eq(Model.parseVolumeSizeTable(""), [])
  eq(Model.parseVolumeSizeTable(null), [])
  eq(Model.parseVolumeSizeTable("\n\n"), [])
})

test("allowsVerb is what stops the x key removing a running container", () => {
  const running = Model.rowsFor(Model.sectionsFor([make("a", "p")]))[0]
  const stopped = Model.rowsFor(Model.sectionsFor([make("a", "p", "exited")]))[0]
  eq(Model.allowsVerb(running, "remove"), false)
  eq(Model.allowsVerb(stopped, "remove"), true)
  eq(Model.allowsVerb(running, "restart"), true)
  eq(Model.allowsVerb(stopped, "restart"), false)
  eq(Model.allowsVerb(rowsOf("volumes", Model.normalizeVolumes([volumeRow()], []))[0], "remove"), true)
  eq(Model.allowsVerb(null, "remove"), false)
})

test("the shortcut sheet is one list, grouped in the order it was written", () => {
  const groups = Model.shortcutGroups()
  eq(groups.map(g => g.title), ["Move", "Containers", "Clean up", "Panel"])
  eq(groups.reduce((n, g) => n + g.entries.length, 0), Model.SHORTCUTS.length)
  for (const group of groups) {
    for (const entry of group.entries) {
      ok(entry.keys.length > 0, "every line names a key")
      ok(entry.text.length > 0, "and says what it does")
    }
  }
})

test("every key the panel actually listens for is written down", () => {
  const documented = Model.SHORTCUTS.map(s => s.keys).join(" ")
  for (const key of ["1 – 4", "j", "x", "p", "c", "n", "u", "d", "o", "r", "s", "/", "?", "enter", "esc"]) {
    ok(documented.indexOf(key) !== -1, key + " is documented")
  }
})

test("every action object has exactly the same keys as every other", () => {
  const rows = []
    .concat(Model.rowsFor(Model.sectionsFor([make("a", "p"), make("b", "p", "exited")])))
    .concat(rowsOf("images", Model.normalizeImages([imageRow()])))
    .concat(rowsOf("volumes", Model.normalizeVolumes([volumeRow()], [])))
    .concat(rowsOf("networks", Model.normalizeNetworks([
      networkRow(), networkRow({ ID: "aaa", Name: "podman", Labels: "" })
    ], [])))
  const shape = ["danger", "glyph", "tooltip", "verb"]
  for (const row of rows) {
    for (const action of Model.actionsFor(row)) {
      eq(Object.keys(action).sort(), shape, row.kind + "/" + action.verb)
      eq(typeof action.danger, "boolean")
    }
  }
})

test("rowRecord hands the ListModel a fully typed object, field by field", () => {
  const row = Model.rowsFor(Model.sectionsFor([make("a", "p")]))[0]
  const record = Model.rowRecord(row)
  eq(Object.keys(record).sort(), Model.ROW_FIELDS.concat(["key", "id"]).sort())
  for (const field of Model.ROW_FIELDS) {
    eq(typeof record[field], Model.ROW_BOOLEANS.indexOf(field) !== -1 ? "boolean" : "string", field)
  }
  eq(record.up, true)
  eq(record.name, "a")
})

test("rowRecord fills in a field that went missing rather than passing it on", () => {
  const row = Model.rowsFor(Model.sectionsFor([make("a", "p")]))[0]
  delete row.up
  delete row.meta
  row.subtitle = null
  const record = Model.rowRecord(row)
  eq(record.up, false, "an absent boolean is false, never undefined")
  eq(record.meta, "", "and an absent string is empty")
  eq(record.subtitle, "")
})

test("every row field is declared either a boolean or a string, never neither", () => {
  const row = Model.rowsFor(Model.sectionsFor([make("a", "p")]))[0]
  for (const field of Model.ROW_FIELDS) {
    const declared = Model.ROW_BOOLEANS.indexOf(field) !== -1 ? "boolean" : "string"
    eq(typeof row[field], declared, field + " is built as the type it is declared")
  }
  for (const field of Model.ROW_BOOLEANS) {
    ok(Model.ROW_FIELDS.indexOf(field) !== -1, field + " is a real row field")
  }
})
