.pragma library

var Glyph = {
  podman: String.fromCodePoint(0xE866),
  play: String.fromCodePoint(0xF040A),
  stop: String.fromCodePoint(0xF04DB),
  restart: String.fromCodePoint(0xF0709),
  logs: String.fromCodePoint(0xF0219),
  shell: String.fromCodePoint(0xF018D),
  copy: String.fromCodePoint(0xF018F),
  refresh: String.fromCodePoint(0xF0450),
  unhealthy: String.fromCodePoint(0xF05D6),
  search: String.fromCodePoint(0xF0349),
  containers: String.fromCodePoint(0xF01A7),
  images: String.fromCodePoint(0xF09FE),
  volumes: String.fromCodePoint(0xF01BC),
  networks: String.fromCodePoint(0xF0317),
  remove: String.fromCodePoint(0xF0A7A),
  prune: String.fromCodePoint(0xF00E2),
  disk: String.fromCodePoint(0xF02CA),
  link: String.fromCodePoint(0xF0339),
  alert: String.fromCodePoint(0xF002A),
  close: String.fromCodePoint(0xF0156),
  keyboard: String.fromCodePoint(0xF030C)
}

var UNGROUPED = "\\x00ungrouped"

var UP_STATES = ["running", "restarting", "removing"]

var MAX_FIELD = 64

// ---------------------------------------------------------------- tabs
//
// The panel is one list renderer driven by whichever tab is active. Every
// tab produces rows of the same shape (see ROW_FIELDS), so switching tabs
// swaps the row source and nothing else.

var TABS = [
  { key: "containers", label: "Containers", glyph: Glyph.containers, noun: "container" },
  { key: "images", label: "Images", glyph: Glyph.images, noun: "image" },
  { key: "volumes", label: "Volumes", glyph: Glyph.volumes, noun: "volume" },
  { key: "networks", label: "Networks", glyph: Glyph.networks, noun: "network" }
]

function tabIndex(key) {
  for (var i = 0; i < TABS.length; i++) {
    if (TABS[i].key === key) return i
  }
  return 0
}

function tabAt(index) {
  return TABS[clampCursor(index, TABS.length)]
}

function tabKeyAt(index) {
  return tabAt(index).key
}

// Wraps, so ← on the first tab lands on the last one.
function shiftTab(key, delta) {
  var count = TABS.length
  var next = (tabIndex(key) + delta) % count
  return TABS[next < 0 ? next + count : next].key
}

function isTabKey(key) {
  for (var i = 0; i < TABS.length; i++) {
    if (TABS[i].key === key) return true
  }
  return false
}

// ---------------------------------------------------------------- keys
//
// The one list of what the keyboard does. The panel's `?` sheet renders it,
// and the README quotes it, so the two can never drift apart.

var SHORTCUTS = [
  { group: "Move", keys: "1 – 4", text: "Jump straight to a tab" },
  { group: "Move", keys: "h  l  ← →", text: "Previous / next tab" },
  { group: "Move", keys: "j  k  ↑ ↓", text: "Move the cursor down / up" },
  { group: "Move", keys: "/", text: "Jump into the filter box" },
  { group: "Move", keys: "k  ↑", text: "From the first row, step back up into the filter" },
  { group: "Move", keys: "esc", text: "Leave the filter, then close the panel" },

  { group: "Containers", keys: "enter", text: "Start or stop the container" },
  { group: "Containers", keys: "r", text: "Restart it" },
  { group: "Containers", keys: "o", text: "Follow its logs in a terminal" },
  { group: "Containers", keys: "s", text: "Open a shell inside it" },
  { group: "Containers", keys: "n", text: "Copy its name" },

  { group: "Clean up", keys: "x", text: "Remove whatever the cursor is on" },
  { group: "Clean up", keys: "p", text: "Prune everything unused on this tab" },

  { group: "Panel", keys: "c", text: "Copy the id, or a volume's mount path" },
  { group: "Panel", keys: "enter", text: "Copy, on the image, volume and network tabs" },
  { group: "Panel", keys: "u", text: "Refresh now" },
  { group: "Panel", keys: "d", text: "Open podman-tui" },
  { group: "Panel", keys: "?", text: "Show this list" }
]

function shortcutGroups() {
  var order = []
  var byGroup = {}
  for (var i = 0; i < SHORTCUTS.length; i++) {
    var entry = SHORTCUTS[i]
    if (!byGroup[entry.group]) {
      byGroup[entry.group] = []
      order.push(entry.group)
    }
    byGroup[entry.group].push({ keys: entry.keys, text: entry.text })
  }
  var out = []
  for (var g = 0; g < order.length; g++) {
    out.push({ title: order[g], entries: byGroup[order[g]] })
  }
  return out
}

// ---------------------------------------------------------------- text

function sanitize(value, maxLength) {
  var text = String(value === undefined || value === null ? "" : value)
  var limit = maxLength > 0 ? maxLength : MAX_FIELD
  var out = ""
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i)
    if (code < 0x20 || code === 0x7F || (code >= 0x80 && code <= 0x9F)) continue
    var ch = text.charAt(i)
    if (ch === "<" || ch === ">" || ch === "&") continue
    out += ch
  }
  out = out.replace(/^\s+|\s+$/g, "")
  if (out.length > limit) out = out.substring(0, limit - 1) + "…"
  return out
}

function trim(value) {
  return String(value === undefined || value === null ? "" : value).replace(/^\s+|\s+$/g, "")
}

function join(parts, separator) {
  var out = []
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] !== undefined && parts[i] !== null && String(parts[i]) !== "") out.push(String(parts[i]))
  }
  return out.join(separator === undefined ? " · " : separator)
}

function plural(count, noun) {
  return count + " " + noun + (count === 1 ? "" : "s")
}

// ---------------------------------------------------------------- identifiers

// Every value that reaches an argv slot goes through one of these first.
// Podman's own naming rules are narrower than these, so anything that
// fails here was never a real id or name to begin with.
function isContainerId(value) {
  return /^[A-Za-z0-9]{1,128}$/.test(String(value || ""))
}

function isVolumeName(value) {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(String(value || ""))
}

function shortId(value) {
  var text = trim(value).replace(/^sha256:/, "")
  return text.length > 12 ? text.substring(0, 12) : text
}

// ---------------------------------------------------------------- sizes

// Podman prints SI units almost everywhere (`podman system df`, `podman
// images`) and IEC units in `podman stats`. Read both, print SI.
var SIZE_UNITS = {
  b: 1,
  kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, pb: 1e15,
  kib: 1024, mib: 1048576, gib: 1073741824, tib: 1099511627776
}

var SIZE_SCALE = ["kB", "MB", "GB", "TB", "PB"]

function parseSize(value) {
  var match = String(value === undefined || value === null ? "" : value)
    .match(/(-?\d+(?:\.\d+)?)\s*([KMGTP]?i?B)/i)
  if (!match) return -1
  var amount = Number(match[1])
  if (!isFinite(amount) || amount < 0) return -1
  var unit = SIZE_UNITS[match[2].toLowerCase()]
  // Bytes are whole numbers; 1.07 * 1e9 in binary floating point is not.
  return unit === undefined ? -1 : Math.round(amount * unit)
}

function formatSize(bytes) {
  if (typeof bytes !== "number" || !isFinite(bytes) || bytes < 0) return ""
  if (bytes < 1000) return Math.round(bytes) + " B"
  var value = bytes
  var index = -1
  while (value >= 1000 && index < SIZE_SCALE.length - 1) {
    value /= 1000
    index++
  }
  var digits = value >= 100 ? 0 : (value >= 10 ? 1 : 2)
  return value.toFixed(digits) + " " + SIZE_SCALE[index]
}

function sumSizes(list) {
  var total = -1
  var items = list || []
  for (var i = 0; i < items.length; i++) {
    var bytes = items[i] ? items[i].sizeBytes : -1
    if (typeof bytes !== "number" || bytes < 0) continue
    total = (total < 0 ? 0 : total) + bytes
  }
  return total
}

// ---------------------------------------------------------------- parsing

function parseJsonLines(raw) {
  var lines = String(raw || "").split("\n")
  var out = []
  for (var i = 0; i < lines.length; i++) {
    var line = trim(lines[i])
    if (line.charAt(0) !== "{") continue
    try {
      out.push(JSON.parse(line))
    } catch (e) {
    }
  }
  return out
}

// `podman system df -v` cannot be combined with `--format`, so the sizes it
// knows about arrive as a plain text table instead of JSON. This pulls just
// the "Local Volumes space usage:" section out of that table — the header
// line, an optional blank line, then one row per volume until the section
// ends — and turns each row into the {Name, Links, Size} shape
// mergeVolumeUsage already expects from the Docker world this shares code
// with. A volume name can never contain whitespace (see isVolumeName), so
// splitting each row on a run of two or more spaces is safe.
function parseVolumeSizeTable(raw) {
  var lines = String(raw || "").split("\n")
  var out = []
  for (var i = 0; i < lines.length; i++) {
    var line = trim(lines[i])
    if (!line || /^VOLUME NAME/i.test(line)) continue
    var cols = line.split(/\s{2,}/)
    if (cols.length < 3) continue
    out.push({ Name: trim(cols[0]), Links: trim(cols[1]), Size: trim(cols[2]) })
  }
  return out
}

// The volume and network queries ask Podman twice in one shell — the full
// list, then the names `prune` would take — and separate the two answers
// with this marker. One process instead of two, and the "is it unused?"
// verdict comes from Podman rather than from us guessing at it.
var UNUSED_MARK = "#UNUSED"

function parseTagged(raw) {
  var lines = String(raw || "").split("\n")
  var records = []
  var unused = []
  var inUnused = false
  for (var i = 0; i < lines.length; i++) {
    var line = trim(lines[i])
    if (line === UNUSED_MARK) {
      inUnused = true
      continue
    }
    if (!line) continue
    if (inUnused) {
      unused.push(line)
      continue
    }
    if (line.charAt(0) !== "{") continue
    try {
      records.push(JSON.parse(line))
    } catch (e) {
    }
  }
  return { records: records, unused: unused }
}

function keySet(names) {
  var out = {}
  var list = names || []
  for (var i = 0; i < list.length; i++) out[list[i]] = true
  return out
}

function labelValue(labels, key) {
  var parts = String(labels || "").split(",")
  for (var i = 0; i < parts.length; i++) {
    var eq = parts[i].indexOf("=")
    if (eq <= 0) continue
    if (trim(parts[i].substring(0, eq)) === key) return trim(parts[i].substring(eq + 1))
  }
  return ""
}

// Distinguishes "the label is absent" from "the label is set to an empty
// string" — which is exactly how Compose marks an anonymous volume.
function hasLabel(labels, key) {
  var parts = String(labels || "").split(",")
  for (var i = 0; i < parts.length; i++) {
    var eq = parts[i].indexOf("=")
    var name = eq < 0 ? trim(parts[i]) : trim(parts[i].substring(0, eq))
    if (name === key) return true
  }
  return false
}

function composeProject(labels) {
  return labelValue(labels, "com.docker.compose.project")
}

// ---------------------------------------------------------------- containers

function isUp(state) {
  return UP_STATES.indexOf(trim(state).toLowerCase()) !== -1
}

function healthOf(raw) {
  var direct = trim(raw && raw.HealthStatus).toLowerCase()
  if (direct && direct !== "none") return direct
  var match = String(raw && raw.Status || "").match(/\((healthy|unhealthy|health: starting|starting)\)/i)
  if (!match) return ""
  var found = match[1].toLowerCase()
  return found === "health: starting" ? "starting" : found
}

function exitCode(status) {
  var match = String(status || "").match(/^Exited \((\d+)\)/)
  return match ? parseInt(match[1], 10) : -1
}

function isFailing(container) {
  if (!container) return false
  if (container.up) return container.health === "unhealthy"
  return container.exitCode > 0
}

function isAlerting(container) {
  if (!container || !container.up) return false
  return container.health === "unhealthy" || container.state === "restarting"
}

function hostPorts(ports) {
  var seen = {}
  var out = []
  var parts = String(ports || "").split(",")
  for (var i = 0; i < parts.length; i++) {
    var match = trim(parts[i]).match(/:(\d+)(?:-(\d+))?->/)
    if (!match) continue
    var port = match[1]
    if (seen[port]) continue
    seen[port] = true
    out.push(port)
  }
  return out
}

function shortImage(image) {
  var value = trim(image)
  if (!value) return ""
  if (value.indexOf("sha256:") === 0) return value.substring(0, 19)
  var slash = value.indexOf("/")
  if (slash > 0) {
    var host = value.substring(0, slash)
    if (host.indexOf(".") !== -1 || host.indexOf(":") !== -1 || host === "localhost") {
      value = value.substring(slash + 1)
    }
  }
  var colon = value.lastIndexOf(":")
  if (colon > 0 && value.indexOf("/", colon) === -1) value = value.substring(0, colon)
  return value
}

function normalizeContainer(raw) {
  var state = trim(raw && raw.State).toLowerCase()
  var status = trim(raw && raw.Status)
  var container = {
    kind: "containers",
    id: trim(raw && raw.ID),
    name: sanitize(trim(raw && raw.Names).split(",")[0]),
    image: sanitize(raw && raw.Image),
    shortImage: sanitize(shortImage(raw && raw.Image)),
    state: sanitize(state, 24),
    status: sanitize(status, 48),
    health: healthOf(raw),
    exitCode: exitCode(status),
    project: sanitize(composeProject(raw && raw.Labels), 32),
    service: sanitize(labelValue(raw && raw.Labels, "com.docker.compose.service"), 32),
    ports: hostPorts(raw && raw.Ports).slice(0, 6),
    up: isUp(state)
  }
  container.failing = isFailing(container)
  container.alerting = isAlerting(container)
  return container
}

function normalizeContainers(rawList) {
  var out = []
  var list = rawList || []
  for (var i = 0; i < list.length; i++) {
    var container = normalizeContainer(list[i])
    if (isContainerId(container.id)) out.push(container)
  }
  return out
}

// ---------------------------------------------------------------- images

function normalizeImage(raw) {
  var repository = trim(raw && raw.Repository)
  var tag = trim(raw && raw.Tag)
  var untagged = repository === "" || repository === "<none>"
  var id = shortId(raw && raw.ID)
  var reference = untagged ? "" : repository + (tag && tag !== "<none>" ? ":" + tag : "")
  var containers = parseInt(trim(raw && raw.Containers), 10)
  if (!isFinite(containers)) containers = -1

  var image = {
    kind: "images",
    id: id,
    // An untagged image has no name worth printing, so the id becomes one.
    name: sanitize(untagged ? id : reference, 96),
    reference: sanitize(reference, 96),
    repository: sanitize(repository, 64),
    tag: sanitize(tag, 40),
    dangling: untagged,
    containers: containers,
    created: sanitize(raw && raw.CreatedSince, 24),
    sizeBytes: parseSize(raw && raw.Size)
  }
  // A count Podman would not give us is treated as "in use": never invite
  // someone to delete an image on the strength of a number we don't have.
  image.inUse = containers !== 0
  image.search = (image.name + " " + image.reference + " " + id).toLowerCase()
  return image
}

function normalizeImages(rawList) {
  var out = []
  var list = rawList || []
  for (var i = 0; i < list.length; i++) {
    var image = normalizeImage(list[i])
    if (isContainerId(image.id)) out.push(image)
  }
  return out
}

// ---------------------------------------------------------------- volumes

var ANONYMOUS_NAME = /^[0-9a-f]{64}$/

function normalizeVolume(raw, unused) {
  var name = trim(raw && raw.Name)
  var labels = raw && raw.Labels
  var anonymous = hasLabel(labels, "com.docker.volume.anonymous") || ANONYMOUS_NAME.test(name)
  var links = parseInt(trim(raw && raw.Links), 10)

  var volume = {
    kind: "volumes",
    id: name,
    name: sanitize(anonymous ? shortId(name) : name, 96),
    anonymous: anonymous,
    driver: sanitize(raw && raw.Driver, 24),
    mountpoint: trim(raw && raw.Mountpoint),
    project: sanitize(composeProject(labels), 32),
    service: sanitize(labelValue(labels, "com.docker.compose.volume"), 32),
    links: isFinite(links) ? links : -1,
    sizeBytes: parseSize(raw && raw.Size),
    inUse: !(unused || {})[name]
  }
  volume.search = (volume.name + " " + name + " " + volume.project + " " + volume.service).toLowerCase()
  return volume
}

function normalizeVolumes(rawList, unusedNames) {
  var unused = keySet(unusedNames)
  var out = []
  var list = rawList || []
  for (var i = 0; i < list.length; i++) {
    var volume = normalizeVolume(list[i], unused)
    if (isVolumeName(volume.id)) out.push(volume)
  }
  return out
}

// `podman system df -v` is the only place Podman will tell us what a volume
// costs on disk, and it costs a second or two of runtime to ask (see
// parseVolumeSizeTable above for how its answer reaches this shape). Keep it
// out of the listing call and fold its answer in when it arrives.
function mergeVolumeUsage(volumes, usageRows) {
  var sizes = {}
  var rows = usageRows || []
  for (var i = 0; i < rows.length; i++) {
    var name = trim(rows[i] && rows[i].Name)
    if (!name) continue
    var links = parseInt(trim(rows[i].Links), 10)
    sizes[name] = {
      sizeBytes: parseSize(rows[i].Size),
      links: isFinite(links) ? links : -1
    }
  }

  var out = []
  var list = volumes || []
  for (var v = 0; v < list.length; v++) {
    var volume = list[v]
    var found = sizes[volume.id]
    if (!found) {
      out.push(volume)
      continue
    }
    var merged = {}
    for (var key in volume) merged[key] = volume[key]
    if (found.sizeBytes >= 0) merged.sizeBytes = found.sizeBytes
    if (found.links >= 0) merged.links = found.links
    out.push(merged)
  }
  return out
}

// ---------------------------------------------------------------- networks

// Podman creates its default bridge network itself and refuses to remove it,
// so it is never offered as something to clean up. Unlike Docker, Podman does
// not list "host" or "none" as network objects at all.
var BUILTIN_NETWORKS = ["podman"]

function normalizeNetwork(raw, unused) {
  var name = trim(raw && raw.Name)
  var labels = raw && raw.Labels
  var builtin = BUILTIN_NETWORKS.indexOf(name) !== -1

  var network = {
    kind: "networks",
    id: trim(raw && raw.ID),
    name: sanitize(name, 96),
    driver: sanitize(raw && raw.Driver, 24),
    scope: sanitize(raw && raw.Scope, 16),
    project: sanitize(composeProject(labels), 32),
    internal: trim(raw && raw.Internal) === "true",
    ipv6: trim(raw && raw.IPv6) === "true",
    builtin: builtin,
    sizeBytes: -1
  }
  network.inUse = builtin || !(unused || {})[name]
  network.search = (network.name + " " + network.driver + " " + network.project).toLowerCase()
  return network
}

function normalizeNetworks(rawList, unusedNames) {
  var unused = keySet(unusedNames)
  var out = []
  var list = rawList || []
  for (var i = 0; i < list.length; i++) {
    var network = normalizeNetwork(list[i], unused)
    if (isContainerId(network.id)) out.push(network)
  }
  return out
}

// ---------------------------------------------------------------- stats

function parsePercent(value) {
  var match = String(value || "").match(/(-?\d+(?:\.\d+)?)\s*%/)
  if (!match) return -1
  var n = Number(match[1])
  return isFinite(n) ? n : -1
}

function memUsed(usage) {
  return trim(String(usage || "").split("/")[0])
}

function indexStats(rawList) {
  var out = {}
  var list = rawList || []
  for (var i = 0; i < list.length; i++) {
    var row = list[i]
    var id = trim(row && row.ID)
    if (!id) continue
    out[id] = {
      id: id,
      cpu: sanitize(row.CPUPerc, 12),
      cpuPercent: parsePercent(row.CPUPerc),
      mem: sanitize(memUsed(row.MemUsage), 12),
      memPercent: parsePercent(row.MemPerc)
    }
  }
  return out
}

// ---------------------------------------------------------------- disk usage

var USAGE_TYPE = {
  containers: "Containers",
  images: "Images",
  volumes: "Local Volumes",
  buildCache: "Build Cache"
}

function indexUsage(rawList) {
  var out = {}
  var list = rawList || []
  for (var i = 0; i < list.length; i++) {
    var row = list[i]
    var type = trim(row && row.Type)
    if (!type) continue
    var count = parseInt(trim(row.TotalCount), 10)
    var active = parseInt(trim(row.Active), 10)
    out[type] = {
      type: type,
      count: isFinite(count) ? count : -1,
      active: isFinite(active) ? active : -1,
      sizeBytes: parseSize(row.Size),
      reclaimableBytes: parseSize(row.Reclaimable)
    }
  }
  return out
}

function usageFor(usage, tabKey) {
  var type = USAGE_TYPE[tabKey]
  if (!type) return null
  return (usage || {})[type] || null
}

// The footer line. Networks cost no disk, so they report how many of them
// are idle instead of how many bytes they hold.
function usageText(usage, tabKey, items) {
  var list = items || []
  if (tabKey === "networks") {
    var idle = 0
    for (var i = 0; i < list.length; i++) {
      if (!list[i].inUse) idle++
    }
    return join([plural(list.length, "network"), idle > 0 ? idle + " unused" : ""])
  }

  var entry = usageFor(usage, tabKey)
  if (!entry) return list.length > 0 ? plural(list.length, tabNoun(tabKey)) : ""

  var total = entry.count >= 0 ? plural(entry.count, tabNoun(tabKey)) : ""
  var size = formatSize(entry.sizeBytes)
  var free = entry.reclaimableBytes > 0 ? formatSize(entry.reclaimableBytes) + " reclaimable" : ""
  return join([total, size, free])
}

function tabNoun(tabKey) {
  return TABS[tabIndex(tabKey)].noun
}

// ---------------------------------------------------------------- filtering

function matchesFilter(container, query) {
  var needle = trim(query).toLowerCase()
  if (!needle) return true
  if (!container) return false
  var haystack = [container.name, container.image, container.project, container.service, container.id]
  for (var i = 0; i < haystack.length; i++) {
    if (String(haystack[i] || "").toLowerCase().indexOf(needle) !== -1) return true
  }
  return false
}

function filterContainers(containers, query) {
  var out = []
  var list = containers || []
  for (var i = 0; i < list.length; i++) {
    if (matchesFilter(list[i], query)) out.push(list[i])
  }
  return out
}

// Images, volumes and networks each carry a precomputed `search` field, so
// one filter covers all three.
function filterResources(resources, query) {
  var needle = trim(query).toLowerCase()
  var list = resources || []
  if (!needle) return list.slice()
  var out = []
  for (var i = 0; i < list.length; i++) {
    if (String(list[i].search || "").indexOf(needle) !== -1) out.push(list[i])
  }
  return out
}

// ---------------------------------------------------------------- sections

function compareContainers(a, b) {
  if (a.up !== b.up) return a.up ? -1 : 1
  if (!a.up && a.failing !== b.failing) return a.failing ? -1 : 1
  return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0)
}

// Biggest first: the reason to open these tabs is to find what is eating the
// disk. Equal (or unknown) sizes fall back to name so the order is stable.
function compareBySize(a, b) {
  var left = typeof a.sizeBytes === "number" ? a.sizeBytes : -1
  var right = typeof b.sizeBytes === "number" ? b.sizeBytes : -1
  if (left !== right) return right - left
  return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0)
}

function sectionsFor(containers) {
  var list = (containers || []).slice()
  var byProject = {}
  var order = []

  for (var i = 0; i < list.length; i++) {
    var key = list[i].project || UNGROUPED
    if (!byProject[key]) {
      byProject[key] = []
      order.push(key)
    }
    byProject[key].push(list[i])
  }

  order.sort(function(a, b) {
    if (a === UNGROUPED) return 1
    if (b === UNGROUPED) return -1
    return a < b ? -1 : (a > b ? 1 : 0)
  })

  var sections = []
  for (var j = 0; j < order.length; j++) {
    var members = byProject[order[j]].sort(compareContainers)
    var running = []
    var stopped = []
    for (var k = 0; k < members.length; k++) {
      if (members[k].up) running.push(members[k].id)
      else stopped.push(members[k].id)
    }
    sections.push({
      key: order[j],
      title: order[j] === UNGROUPED ? "Ungrouped" : sanitize(order[j], 32),
      items: members,
      containers: members,
      runningIds: running,
      stoppedIds: stopped,
      runningCount: running.length,
      total: members.length,
      tally: running.length + "/" + members.length,
      toggle: running.length > 0 ? "stop" : (members.length > 0 ? "start" : "")
    })
  }

  if (sections.length === 1 && sections[0].key === UNGROUPED) sections[0].title = ""
  return sections
}

// Images, volumes and networks split on one question: can this be deleted
// right now? Unused comes first, because that is what the tab is for.
function usageSectionsFor(resources) {
  var list = resources || []
  var unused = []
  var used = []
  for (var i = 0; i < list.length; i++) {
    if (list[i].inUse) used.push(list[i])
    else unused.push(list[i])
  }
  unused.sort(compareBySize)
  used.sort(compareBySize)

  var sections = []
  if (unused.length > 0) sections.push(usageSection("unused", "Unused", unused))
  if (used.length > 0) sections.push(usageSection("in-use", "In use", used))
  return sections
}

function usageSection(key, title, items) {
  var bytes = sumSizes(items)
  return {
    key: key,
    title: title,
    items: items,
    containers: items,
    total: items.length,
    tally: join([String(items.length), formatSize(bytes)]),
    toggle: ""
  }
}

function sectionByKey(sections, key) {
  var list = sections || []
  for (var i = 0; i < list.length; i++) {
    if (list[i].key === key) return list[i]
  }
  return null
}

function sectionAction(section) {
  if (!section || section.total === 0) return null
  if (section.runningCount === undefined) return null
  if (section.runningCount > 0) return { verb: "stop", ids: section.runningIds }
  return { verb: "start", ids: section.stoppedIds }
}

// ---------------------------------------------------------------- rows

// One row shape for every tab, so a single delegate renders all four and a
// ListModel never has to be told about a new field halfway through.
var ROW_FIELDS = ["kind", "name", "subtitle", "status", "meta", "up", "failing",
  "restarting", "unhealthy", "muted", "removable", "sectionKey", "sectionTitle",
  "sectionTally", "sectionToggle", "firstSection"]

// The seven fields a row carries as booleans. Everything else is a string.
var ROW_BOOLEANS = ["up", "failing", "restarting", "unhealthy", "muted", "removable",
  "firstSection"]

// A ListModel takes its role types from whatever object it is first handed and
// drops any field it cannot type — and it re-derives them after a clear(), so
// a tab switch can leave it with roles it silently refused to make. Hand it a
// freshly built plain object with every field present and explicitly typed,
// rather than the row object the rest of the panel is still holding on to.
function rowRecord(row) {
  var out = { key: String(row.key), id: String(row.id) }
  for (var i = 0; i < ROW_FIELDS.length; i++) {
    var field = ROW_FIELDS[i]
    var value = row[field]
    out[field] = ROW_BOOLEANS.indexOf(field) !== -1
      ? value === true
      : String(value === undefined || value === null ? "" : value)
  }
  return out
}

function blankRow(key, id, kind) {
  return {
    key: key,
    id: id,
    kind: kind,
    name: "",
    subtitle: "",
    status: "",
    meta: "",
    up: false,
    failing: false,
    restarting: false,
    unhealthy: false,
    muted: false,
    removable: true,
    sectionKey: "",
    sectionTitle: "",
    sectionTally: "",
    sectionToggle: "",
    firstSection: false
  }
}

function containerRow(container) {
  var row = blankRow(container.id, container.id, "containers")
  row.name = container.name
  row.subtitle = subtitleText(container)
  row.status = statusText(container)
  row.up = container.up
  row.failing = container.failing
  row.restarting = container.state === "restarting"
  row.unhealthy = container.health === "unhealthy"
  // Only a container that is already down. A row can be a few seconds stale,
  // and a stale row must never be the thing that deletes a live container.
  row.removable = !container.up
  return row
}

function imageRow(image) {
  var row = blankRow(image.id, image.id, "images")
  row.name = image.name
  row.subtitle = sanitize(join([
    image.dangling ? "untagged" : image.id,
    image.created,
    image.containers > 0 ? plural(image.containers, "container") : ""
  ]), 96)
  row.meta = formatSize(image.sizeBytes)
  row.up = image.inUse
  row.muted = !image.inUse
  return row
}

function volumeRow(volume) {
  var row = blankRow(volume.id, volume.id, "volumes")
  row.name = volume.name
  row.subtitle = sanitize(join([
    volume.project,
    volume.anonymous ? "anonymous" : "",
    volume.driver && volume.driver !== "local" ? volume.driver : "",
    volume.links > 0 ? plural(volume.links, "link") : ""
  ]), 96)
  row.meta = formatSize(volume.sizeBytes)
  row.up = volume.inUse
  row.muted = !volume.inUse
  return row
}

function networkRow(network) {
  var row = blankRow(network.id, network.id, "networks")
  row.name = network.name
  row.subtitle = sanitize(join([
    network.driver,
    network.builtin ? "predefined" : network.project,
    network.internal ? "internal" : "",
    network.ipv6 ? "ipv6" : ""
  ]), 96)
  row.up = network.inUse
  row.muted = !network.inUse
  // Podman made this network itself and will not let it go, so the panel
  // does not offer a button that can only ever fail.
  row.removable = !network.builtin
  return row
}

var ROW_BUILDERS = {
  containers: containerRow,
  images: imageRow,
  volumes: volumeRow,
  networks: networkRow
}

function rowsForSections(sections, kind) {
  var build = ROW_BUILDERS[kind] || containerRow
  var rows = []
  var list = sections || []
  for (var i = 0; i < list.length; i++) {
    var section = list[i]
    var items = section.items || section.containers || []
    for (var j = 0; j < items.length; j++) {
      var row = build(items[j])
      row.sectionKey = section.key
      row.sectionTitle = j === 0 ? section.title : ""
      row.sectionTally = section.tally
      row.sectionToggle = section.toggle
      row.firstSection = i === 0
      rows.push(row)
    }
  }
  return rows
}

function rowsFor(sections) {
  return rowsForSections(sections, "containers")
}

// ---------------------------------------------------------------- actions
//
// A row's buttons are data, so the delegate that draws them never has to
// know which tab it is rendering, and the verbs stay testable.

// Every action carries every field, `danger` included. A Repeater builds its
// roles from the objects it is handed, and an array whose members disagree
// about which keys exist leaves it with roles it cannot make.
function action(verb, glyph, tooltip, danger) {
  return { verb: verb, glyph: glyph, tooltip: tooltip, danger: danger === true }
}

function actionsFor(row) {
  if (!row) return []
  if (row.kind === "containers") {
    var actions = [action("logs", Glyph.logs, "Follow logs in a terminal  (o)", false)]
    if (row.up) {
      actions.push(action("shell", Glyph.shell, "Open a shell in the container  (s)", false))
      actions.push(action("restart", Glyph.restart, "Restart  (r)", false))
      actions.push(action("stop", Glyph.stop, "Stop  (enter)", true))
    } else {
      if (row.removable) actions.push(action("remove", Glyph.remove, "Remove this container  (x)", true))
      actions.push(action("start", Glyph.play, "Start  (enter)", false))
    }
    return actions
  }

  var out = [action("copy", Glyph.copy, copyTooltip(row.kind) + "  (c)", false)]
  if (row.removable) {
    out.push(action("remove", Glyph.remove, "Remove this " + tabNoun(row.kind) + "  (x)", true))
  }
  return out
}

// Whether a row offers a verb at all — a running container has no remove
// button, so the x key must not quietly remove it either.
function allowsVerb(row, verb) {
  var actions = actionsFor(row)
  for (var i = 0; i < actions.length; i++) {
    if (actions[i].verb === verb) return true
  }
  return false
}

function copyTooltip(kind) {
  if (kind === "volumes") return "Copy the mount path"
  if (kind === "networks") return "Copy the network id"
  if (kind === "images") return "Copy the image id"
  return "Copy the container id"
}

// What a click on the row body copies: whichever string is the one you would
// actually want to paste somewhere.
function copyValue(kind, item) {
  if (!item) return ""
  if (kind === "volumes") return item.mountpoint || item.id
  return item.id
}

// ---------------------------------------------------------------- commands

function removeCommand(kind, id) {
  if (kind === "containers") return isContainerId(id) ? ["podman", "rm", id] : null
  if (kind === "images") return isContainerId(id) ? ["podman", "rmi", id] : null
  if (kind === "volumes") return isVolumeName(id) ? ["podman", "volume", "rm", id] : null
  if (kind === "networks") return isContainerId(id) ? ["podman", "network", "rm", id] : null
  return null
}

// Deliberately without -f on every one of these. A stale row must never be
// able to destroy something that came back to life since the last refresh.
var PRUNE = {
  containers: {
    label: "Remove stopped",
    args: ["podman", "container", "prune", "-f"],
    message: "Remove every stopped container?"
  },
  images: {
    label: "Prune unused",
    args: ["podman", "image", "prune", "-a", "-f"],
    message: "Remove every image that no container is using?"
  },
  volumes: {
    label: "Prune unused",
    args: ["podman", "volume", "prune", "-a", "-f"],
    message: "Remove every volume that no container is using? Whatever is stored in them goes with them."
  },
  networks: {
    label: "Prune unused",
    args: ["podman", "network", "prune", "-f"],
    message: "Remove every network that no container is using?"
  }
}

function pruneSpec(tabKey) {
  return PRUNE[tabKey] || null
}

// True only when Podman has told us there is something to reclaim, so the
// button is never live on a tab that is already clean.
function canPrune(tabKey, usage, items) {
  var list = items || []
  if (tabKey === "networks") {
    for (var i = 0; i < list.length; i++) {
      if (!list[i].inUse) return true
    }
    return false
  }
  var entry = usageFor(usage, tabKey)
  if (entry && entry.reclaimableBytes > 0) return true
  for (var j = 0; j < list.length; j++) {
    if (!list[j].inUse) return true
  }
  return false
}

function removeMessage(kind, item) {
  if (!item) return ""
  var noun = tabNoun(kind)
  var name = item.name || item.id
  if (kind === "volumes") {
    return item.inUse
      ? "Remove volume " + name + "? A container is still using it, so Podman will refuse."
      : "Remove volume " + name + "? Whatever is stored in it goes with it."
  }
  if (kind === "images" && item.inUse) {
    return "Remove image " + name + "? A container still references it, so Podman will refuse."
  }
  return "Remove " + noun + " " + name + "?"
}

// ---------------------------------------------------------------- lookup

function itemById(items, id) {
  var list = items || []
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i]
  }
  return null
}

function containerById(containers, id) {
  return itemById(containers, id)
}

function containerAtCursor(containers, rows, cursorIndex) {
  var list = rows || []
  if (cursorIndex < 0 || cursorIndex >= list.length) return null
  return itemById(containers, list[cursorIndex].id)
}

function clampCursor(cursorIndex, total) {
  if (total <= 0) return 0
  if (cursorIndex < 0) return 0
  if (cursorIndex > total - 1) return total - 1
  return cursorIndex
}

// ---------------------------------------------------------------- reconcile

function reconcilePlan(currentKeys, nextRows) {
  var keys = (currentKeys || []).slice()
  var next = nextRows || []
  var ops = []

  var wanted = {}
  for (var i = 0; i < next.length; i++) wanted[next[i].key] = true

  for (var r = keys.length - 1; r >= 0; r--) {
    if (wanted[keys[r]]) continue
    ops.push({ op: "remove", index: r })
    keys.splice(r, 1)
  }

  for (var n = 0; n < next.length; n++) {
    if (keys[n] === next[n].key) continue
    var found = keys.indexOf(next[n].key, n)
    if (found > n) {
      ops.push({ op: "move", from: found, to: n })
      keys.splice(n, 0, keys.splice(found, 1)[0])
    } else {
      ops.push({ op: "insert", index: n, row: next[n] })
      keys.splice(n, 0, next[n].key)
    }
  }
  return ops
}

// ---------------------------------------------------------------- summaries

function counts(containers) {
  var list = containers || []
  var out = { total: list.length, running: 0, stopped: 0, failing: 0, alerting: 0 }
  for (var i = 0; i < list.length; i++) {
    if (list[i].up) out.running++
    else out.stopped++
    if (list[i].failing) out.failing++
    if (list[i].alerting) out.alerting++
  }
  return out
}

function summaryText(containers, daemonUp) {
  if (!daemonUp) return "Podman unreachable"
  var c = counts(containers)
  if (c.total === 0) return "No containers"
  var base = c.running + " of " + c.total + " running"
  if (c.alerting > 0) return c.alerting + (c.alerting === 1 ? " needs" : " need") + " attention · " + base
  return base
}

function statusText(container) {
  if (!container) return ""
  if (container.up) return trim(container.status).replace(/\s*\((healthy|unhealthy|health: starting|starting)\)\s*$/i, "")
  if (container.exitCode > 0) return "Exited (" + container.exitCode + ")"
  return trim(container.status)
}

function subtitleText(container) {
  if (!container) return ""
  var parts = []
  if (container.service && container.service !== container.name) parts.push(container.service)
  if (container.shortImage) parts.push(container.shortImage)
  var line = parts.join(" · ")
  if (container.ports.length > 0) line += (line ? "  " : "") + ":" + container.ports.join(" :")
  return sanitize(line, 96)
}

// The one line the panel shows when a tab has nothing to show. Says why,
// which is usually more useful than saying what.
function emptyText(tabKey, state) {
  if (!state.everLoaded) return "Loading…"
  if (state.permissionDenied) return "No access to the Podman storage"
  if (!state.daemonReachable) return "Podman unreachable"
  if (state.filtered) return "Nothing on this tab matches that filter"
  if (tabKey === "containers") return state.showStopped ? "No containers" : "No running containers"
  return "No " + tabNoun(tabKey) + "s"
}

// Podman's own error text, trimmed down to the one line that says something.
function errorText(raw) {
  var lines = String(raw || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var line = trim(lines[i]).replace(/^Error(?: response from daemon)?:\s*/i, "")
    if (line) return sanitize(line, 160)
  }
  return ""
}
