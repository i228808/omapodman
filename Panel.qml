import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Io
import qs.Ui
import qs.Commons
import "Model.js" as Model

Panel {
  id: root

  moduleName: "abdullahmansoor.omapodman"
  ipcTarget: "abdullahmansoor.omapodman"
  manageIpc: false

  readonly property int refreshIntervalSec: Math.max(5, Number(setting("refreshIntervalSec", 15)))
  readonly property bool showStopped: setting("showStopped", true) === true
  readonly property bool showStats: setting("showStats", true) === true
  readonly property bool showVolumeSizes: setting("showVolumeSizes", true) === true
  readonly property bool hideWhenEmpty: setting("hideWhenEmpty", false) === true
  // The setting reads "Containers"; the tab keys are lowercase.
  readonly property string defaultTab: {
    var key = String(setting("defaultTab", "containers")).toLowerCase()
    return Model.isTabKey(key) ? key : "containers"
  }

  // ------------------------------------------------------------------ state

  property string tab: "containers"

  property var containers: []
  property var images: []
  property var volumes: []
  property var networks: []
  property var volumeSizes: []
  property var usage: ({})
  property var stats: ({})

  property bool daemonReachable: true
  property bool permissionDenied: false
  property bool loading: false
  property bool everLoaded: false
  property string filterText: ""
  property string lastError: ""

  property string pendingId: ""
  property var pendingCommand: null
  property string confirmMessage: ""
  property string confirmLabel: "Remove"
  property bool confirmOpen: false
  property bool helpOpen: false

  property int cursorIndex: 0
  property bool cursorActive: false
  property bool cursorFromKeyboard: false

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color dim: Qt.darker(foreground, 1.5)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  // ------------------------------------------------------------- derivation

  // `podman system df -v` is the only source for what a volume costs, and it
  // arrives on its own schedule, so it is folded in here rather than stored.
  readonly property var sizedVolumes: Model.mergeVolumeUsage(volumes, volumeSizes)

  readonly property var items: {
    if (tab === "images") return images
    if (tab === "volumes") return sizedVolumes
    if (tab === "networks") return networks
    return containers
  }
  readonly property var visibleItems: tab === "containers"
    ? Model.filterContainers(containers, filterText)
    : Model.filterResources(items, filterText)
  readonly property var sections: tab === "containers"
    ? Model.sectionsFor(visibleItems)
    : Model.usageSectionsFor(visibleItems)
  readonly property var rows: Model.rowsForSections(sections, tab)

  readonly property var counts: Model.counts(containers)
  readonly property var tabCounts: ({
    containers: containers.length,
    images: images.length,
    volumes: volumes.length,
    networks: networks.length
  })

  readonly property var cursorRow: cursorIndex >= 0 && cursorIndex < rows.length ? rows[cursorIndex] : null
  readonly property var cursorItem: cursorRow ? Model.itemById(items, cursorRow.id) : null
  // The field is always on screen. Hiding it below a row count meant `/` had
  // nothing to focus on a short list, which left the filter mouse-only — and
  // a control you can only reach with the mouse is not a control everyone has.
  readonly property bool filterable: true

  readonly property string usageLine: Model.usageText(usage, tab, items)
  readonly property bool prunable: Model.canPrune(tab, usage, items)

  onRowsChanged: root.cursorIndex = Model.clampCursor(root.cursorIndex, rows.length)

  // ------------------------------------------------------------------- tabs

  function setTab(key) {
    if (!Model.isTabKey(key) || key === root.tab) return
    // Empty the list before the rows underneath it change, so the new tab is
    // inserted into an empty model rather than diffed against the old one.
    list.clear()
    root.tab = key
    root.filterText = ""
    root.cursorIndex = 0
    root.cursorActive = false
    root.lastError = ""
    filterField.text = ""
    refreshResources()
    refreshUsage()
  }

  // --------------------------------------------------------------- refresh

  function refresh() {
    if (listProcess.running) return
    root.loading = true
    listProcess.running = true
  }

  function refreshStats() {
    if (!showStats || statsProcess.running || !opened) return
    if (counts.running === 0) return
    statsProcess.running = true
  }

  // All three lists, not just the one on screen: the tab strip carries a count
  // for each of them, and a count that only appears once you visit the tab is
  // not a count, it is a surprise. Each of these is a single cheap query — the
  // expensive one is refreshVolumeSizes below, which stays lazy.
  function refreshResources() {
    if (!opened) return
    if (!imagesProcess.running) imagesProcess.running = true
    if (!volumesProcess.running) volumesProcess.running = true
    if (!networksProcess.running) networksProcess.running = true
    if (root.tab === "volumes") refreshVolumeSizes()
  }

  function refreshUsage() {
    if (!opened || usageProcess.running) return
    usageProcess.running = true
  }

  // Deliberately off every timer. Walking every volume on disk takes a second
  // or two, so it runs when the tab is opened and after something has
  // changed, and never once a second in the background.
  function refreshVolumeSizes() {
    if (!showVolumeSizes || !opened || volumeSizeProcess.running) return
    volumeSizeProcess.running = true
  }

  function refreshAll() {
    refresh()
    refreshStats()
    refreshResources()
    refreshUsage()
  }

  Timer {
    interval: root.refreshIntervalSec * 1000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }

  Timer {
    interval: 3000
    running: root.opened
    repeat: true
    onTriggered: root.refresh()
  }

  Timer {
    interval: 5000
    running: root.opened && root.showStats
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refreshStats()
  }

  // Images, volumes and networks change when someone changes them, not on
  // their own, so they get a far lazier beat than the container list.
  Timer {
    interval: 10000
    running: root.opened
    repeat: true
    onTriggered: { root.refreshResources(); root.refreshUsage() }
  }

  onOpenedChanged: {
    if (opened) {
      cursorActive = false
      cursorIndex = 0
      filterText = ""
      filterField.text = ""
      lastError = ""
      helpOpen = false
      closeConfirm()
      if (root.tab !== root.defaultTab) {
        list.clear()
        root.tab = root.defaultTab
      }
      refreshAll()
    } else {
      stats = ({})
      helpOpen = false
      closeConfirm()
    }
  }

  // --------------------------------------------------------------- actions

  function runCommand(command) {
    if (!command || actionProcess.running) return
    root.lastError = ""
    actionProcess.command = command
    actionProcess.running = true
  }

  function runAction(ids, verb) {
    if (!ids || ids.length === 0 || actionProcess.running) return
    root.pendingId = ids.length === 1 ? ids[0] : ""
    runCommand(["podman", verb].concat(ids))
  }

  function toggleContainer(container) {
    if (!container) return
    runAction([container.id], container.up ? "stop" : "start")
  }

  function restartContainer(container) {
    if (container && container.up) runAction([container.id], "restart")
  }

  function toggleSection(sectionKey) {
    var action = Model.sectionAction(Model.sectionByKey(sections, sectionKey))
    if (action) runAction(action.ids, action.verb)
  }

  function stopEverything() {
    var ids = []
    for (var i = 0; i < containers.length; i++) {
      if (containers[i].up) ids.push(containers[i].id)
    }
    runAction(ids, "stop")
  }

  // Every row's buttons come from Model.actionsFor, so this is the one place
  // a verb turns into something that happens.
  function dispatch(kind, id, verb) {
    var item = Model.itemById(items, id)
    if (verb === "copy") { copyText(Model.copyValue(kind, item)); return }
    if (verb === "logs") { viewLogs(id); return }
    if (verb === "shell") { openShell(id); return }
    if (verb === "remove") { askRemove(kind, id); return }
    if (verb === "start" || verb === "stop" || verb === "restart") runAction([id], verb)
  }

  function activateRow() {
    if (!cursorActive || !cursorRow) return
    if (root.tab === "containers") toggleContainer(cursorItem)
    else dispatch(root.tab, cursorRow.id, "copy")
  }

  // ---------------------------------------------------------- confirmation

  function ask(command, message, label) {
    if (!command) return
    root.pendingCommand = command
    root.confirmMessage = message
    root.confirmLabel = label
    // Cancel is the default answer to every question asked here.
    confirmDialog.selectedIndex = 0
    root.confirmOpen = true
  }

  function askRemove(kind, id) {
    var item = Model.itemById(items, id)
    var command = Model.removeCommand(kind, id)
    if (!item || !command) return
    ask(command, Model.removeMessage(kind, item), "Remove")
  }

  function askPrune() {
    var spec = Model.pruneSpec(root.tab)
    if (!spec || !root.prunable) return
    ask(spec.args, spec.message, spec.label)
  }

  function closeConfirm() {
    root.confirmOpen = false
    root.pendingCommand = null
  }

  function confirmAccepted() {
    var command = root.pendingCommand
    closeConfirm()
    runCommand(command)
  }

  // ----------------------------------------------------------- side effects

  function copyText(value) {
    if (!value || copyProcess.running) return
    copyProcess.command = ["wl-copy", "--trim-newline", String(value)]
    copyProcess.running = true
  }

  function viewLogs(id) {
    if (!Model.isContainerId(id)) return
    root.close()
    // The terminal is held open by the shell, not by a launcher flag: not
    // every omarchy-launch-tui out there understands --hold.
    Quickshell.execDetached(["omarchy-launch-tui", "--app-id=org.omarchy.podman-logs",
      "sh", "-c",
      "podman logs --tail 200 --follow \"$1\"; printf '\\n[logs ended — press enter to close]'; read -r _",
      "sh", id])
  }

  function openShell(id) {
    if (!Model.isContainerId(id)) return
    root.close()
    Quickshell.execDetached(["omarchy-launch-tui", "--app-id=org.omarchy.podman-shell",
      "sh", "-c",
      "podman exec -it \"$1\" sh -c 'command -v bash >/dev/null 2>&1 && exec bash || exec sh'",
      "sh", id])
  }

  function launchTui() {
    root.close()
    Quickshell.execDetached(["omarchy-launch-or-focus-tui", "podman-tui"])
  }

  // -------------------------------------------------------------- keyboard

  function moveCursor(delta) {
    // Up from the first row lands in the filter, the mirror of the Down key
    // that walks out of it. Between the two, the whole panel is reachable
    // without ever touching the mouse.
    if (delta < 0 && cursorActive && cursorIndex === 0) {
      filterField.forceActiveFocus()
      cursorActive = false
      return
    }
    if (rows.length === 0) {
      filterField.forceActiveFocus()
      return
    }
    cursorActive = true
    cursorFromKeyboard = true
    cursorIndex = Model.clampCursor(cursorIndex + delta, rows.length)
  }

  function setCursor(index) {
    cursorActive = true
    cursorFromKeyboard = false
    cursorIndex = Model.clampCursor(index, rows.length)
  }

  function handleTextKey(key) {
    if (key === "?") { root.helpOpen = !root.helpOpen; return }
    if (root.helpOpen) { root.helpOpen = false; return }
    if (key === "/") { filterField.forceActiveFocus(); return }

    var digit = "1234".indexOf(key)
    if (digit !== -1) { setTab(Model.tabKeyAt(digit)); return }

    if (key === "u") { refreshAll(); return }
    if (key === "d") { launchTui(); return }
    if (key === "p") { askPrune(); return }

    if (!cursorActive || !cursorRow) return
    if (key === "c") { dispatch(root.tab, cursorRow.id, "copy"); return }

    if (root.tab !== "containers" || !cursorItem) return
    if (key === "o") viewLogs(cursorItem.id)
    else if (key === "s") { if (cursorItem.up) openShell(cursorItem.id) }
    else if (key === "r") restartContainer(cursorItem)
    else if (key === "n") copyText(cursorItem.name)
  }

  function removeAtCursor() {
    if (!cursorActive || !cursorRow) return
    if (!Model.allowsVerb(cursorRow, "remove")) return
    askRemove(root.tab, cursorRow.id)
  }

  // -------------------------------------------------------------- processes
  //
  // Every listing goes through a custom Go template rather than `{{json .}}`:
  // Podman's own JSON dump uses field names and shapes (arrays for Names and
  // Ports, an object for Labels, health status crammed into the Status field)
  // that differ tab by tab and version by version. Naming every field
  // explicitly gets back exactly the flattened, Docker-shaped strings
  // Model.js expects — "key=value,key=value" labels, "0.0.0.0:80->80/tcp"
  // ports, "Up 2 hours (healthy)" status — so one parser works for both.

  readonly property string containerFormat:
    "{\"ID\":{{json .ID}},\"Names\":{{json .Names}},\"Image\":{{json .Image}}," +
    "\"State\":{{json .State}},\"Status\":{{json .Status}},\"Labels\":{{json .Labels}}," +
    "\"Ports\":{{json .Ports}}}"

  Process {
    id: listProcess
    command: root.showStopped
      ? ["sh", "-c", "podman ps --all --format '" + root.containerFormat + "' | head -c 1M"]
      : ["sh", "-c", "podman ps --format '" + root.containerFormat + "' | head -c 1M"]
    stdout: StdioCollector { id: listOut; waitForEnd: true }
    stderr: StdioCollector { id: listErr; waitForEnd: true }

    onExited: function(code) {
      root.loading = false
      root.everLoaded = true

      if (code !== 0) {
        var message = String(listErr.text || "")
        root.daemonReachable = false
        root.permissionDenied = /permission denied/i.test(message)
        root.containers = []
        root.images = []
        root.volumes = []
        root.networks = []
        root.volumeSizes = []
        root.usage = ({})
        root.stats = ({})
        return
      }

      root.daemonReachable = true
      root.permissionDenied = false

      root.containers = Model.normalizeContainers(Model.parseJsonLines(listOut.text))
      root.refreshStats()
    }
  }

  Process {
    id: statsProcess
    command: ["sh", "-c",
      "podman stats --no-stream --format '{\"ID\":{{json .ID}},\"CPUPerc\":{{json .CPUPerc}}," +
      "\"MemUsage\":{{json .MemUsage}},\"MemPerc\":{{json .MemPerc}}}' | head -c 1M"]
    stdout: StdioCollector { id: statsOut; waitForEnd: true }

    onExited: function(code) {
      if (code === 0) root.stats = Model.indexStats(Model.parseJsonLines(statsOut.text))
    }
  }

  Process {
    id: imagesProcess
    command: ["sh", "-c",
      "podman images --format '{\"ID\":{{json .ID}},\"Repository\":{{json .Repository}}," +
      "\"Tag\":{{json .Tag}},\"Size\":{{json .Size}},\"CreatedSince\":{{json .CreatedSince}}," +
      "\"Containers\":{{json .Containers}}}' | head -c 1M"]
    stdout: StdioCollector { id: imagesOut; waitForEnd: true }

    onExited: function(code) {
      if (code === 0) root.images = Model.normalizeImages(Model.parseJsonLines(imagesOut.text))
    }
  }

  // One shell, two questions: the whole list, then the names `prune` would
  // take. Podman decides what counts as unused, so the panel never has to.
  Process {
    id: volumesProcess
    command: ["sh", "-c",
      "{ podman volume ls --format '{\"Name\":{{json .Name}},\"Driver\":{{json .Driver}}," +
      "\"Mountpoint\":{{json .Mountpoint}},\"Labels\":{{json .Labels}}}'; echo '#UNUSED'; " +
      "podman volume ls --filter dangling=true --format '{{.Name}}'; } | head -c 1M"]
    stdout: StdioCollector { id: volumesOut; waitForEnd: true }

    onExited: function(code) {
      if (code !== 0) return
      var parsed = Model.parseTagged(volumesOut.text)
      root.volumes = Model.normalizeVolumes(parsed.records, parsed.unused)
    }
  }

  Process {
    id: networksProcess
    command: ["sh", "-c",
      "{ podman network ls --format '{\"ID\":{{json .ID}},\"Name\":{{json .Name}}," +
      "\"Driver\":{{json .Driver}},\"Internal\":{{json .Internal}},\"Labels\":{{json .Labels}}}'; " +
      "echo '#UNUSED'; podman network ls --filter dangling=true --format '{{.Name}}'; } | head -c 1M"]
    stdout: StdioCollector { id: networksOut; waitForEnd: true }

    onExited: function(code) {
      if (code !== 0) return
      var parsed = Model.parseTagged(networksOut.text)
      root.networks = Model.normalizeNetworks(parsed.records, parsed.unused)
    }
  }

  Process {
    id: usageProcess
    command: ["sh", "-c", "podman system df --format '{{json .}}' | head -c 64k"]
    stdout: StdioCollector { id: usageOut; waitForEnd: true }

    onExited: function(code) {
      if (code === 0) root.usage = Model.indexUsage(Model.parseJsonLines(usageOut.text))
    }
  }

  // `system df -v` refuses to combine with `--format`, so this reads the
  // plain "Local Volumes space usage:" table instead of JSON — see
  // Model.parseVolumeSizeTable for how that text turns back into records.
  Process {
    id: volumeSizeProcess
    command: ["sh", "-c",
      "podman system df -v 2>/dev/null | awk '/^Local Volumes space usage:/{f=1;next} " +
      "f&&/^VOLUME NAME/{g=1;next} g&&NF==0{g=0} g' | head -c 1M"]
    stdout: StdioCollector { id: volumeSizeOut; waitForEnd: true }

    onExited: function(code) {
      if (code === 0) root.volumeSizes = Model.parseVolumeSizeTable(volumeSizeOut.text)
    }
  }

  Process {
    id: actionProcess
    stderr: StdioCollector { id: actionErr; waitForEnd: true }

    onExited: function(code) {
      root.pendingId = ""
      // Podman refuses plenty of reasonable-looking requests — a volume still
      // mounted, an image still referenced — and its reason is the only
      // useful thing the panel can say, so it says it verbatim.
      if (code !== 0) root.lastError = Model.errorText(actionErr.text)
      root.refresh()
      root.refreshResources()
      root.refreshUsage()
      if (root.tab === "volumes") root.volumeSizes = []
    }
  }

  Process { id: copyProcess }

  IpcHandler {
    target: root.ipcTarget

    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.toggle() }
    function refresh(): void { root.refreshAll() }
    function stopAll(): void { root.stopEverything() }
    function tab(name: string): void { root.setTab(name) }
  }

  // ------------------------------------------------------------------- bar

  implicitWidth: button.visible ? button.implicitWidth : 0
  implicitHeight: button.implicitHeight

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: Model.Glyph.podman
    visible: !root.hideWhenEmpty || root.counts.total > 0
    dimmed: root.counts.running === 0
    active: root.counts.alerting > 0 || root.counts.running > 0
    useActiveColor: true
    activeColor: root.counts.alerting > 0 ? Color.urgent : Color.accent
    tooltipText: "OmaPodman · " + Model.summaryText(root.containers, root.daemonReachable)

    onPressed: function(b) {
      if (b === Qt.MiddleButton) root.refresh()
      else root.toggle()
    }
  }

  // ----------------------------------------------------------------- panel

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(470))
    contentHeight: panel.fittedContentHeight(column.implicitHeight)

    // The confirmation lives outside PanelKeyCatcher on purpose: the catcher
    // goes `blocked` while a question is open, so the unhandled key bubbles
    // out to here and the dialog answers it.
    Item {
      id: keyRoot
      anchors.fill: parent

      Keys.onPressed: function(event) {
        if (!root.confirmOpen) return
        if (confirmDialog.handleKey(event)) event.accepted = true
      }

      PanelKeyCatcher {
        id: keyCatcher
        anchors.fill: parent
        blocked: filterField.activeFocus || root.confirmOpen

        onMoveRequested: function(dx, dy) {
          if (root.helpOpen) return
          if (dy !== 0) root.moveCursor(dy)
          else if (dx !== 0) root.setTab(Model.shiftTab(root.tab, dx))
        }
        onActivateRequested: if (root.helpOpen) root.helpOpen = false; else root.activateRow()
        onDeleteRequested: if (!root.helpOpen) root.removeAtCursor()
        onCloseRequested: {
          if (root.helpOpen) root.helpOpen = false
          else root.close()
        }
        onTabRequested: function(direction) { root.switchPanel(direction) }
        onTextKey: function(text) { root.handleTextKey(text) }

        Column {
          id: column
          anchors.fill: parent
          spacing: Style.spacing.panelGap

          PanelHero {
            title: "OmaPodman"
            meta: Model.summaryText(root.containers, root.daemonReachable)
            foreground: root.foreground
            fontFamily: root.fontFamily
            iconOpacity: root.counts.running > 0 ? 1.0 : 0.5

            iconComponent: Text {
              text: Model.Glyph.podman
              color: root.counts.alerting > 0 ? Color.urgent : root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.display
            }

            trailingControl: Row {
              spacing: Style.spacing.sm

              PanelActionButton {
                iconText: Model.Glyph.keyboard
                tooltipText: "Keyboard shortcuts  (?)"
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.helpOpen = !root.helpOpen
              }

              PanelActionButton {
                iconText: Model.Glyph.refresh
                tooltipText: "Refresh  (u)"
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.refreshAll()

                RotationAnimation on rotation {
                  running: root.loading
                  from: 0
                  to: 360
                  duration: 900
                  loops: Animation.Infinite
                  onRunningChanged: if (!running) rotation = 0
                }
              }

              PanelActionButton {
                visible: root.tab === "containers" && root.counts.running > 0
                iconText: Model.Glyph.stop
                tooltipText: "Stop every running container"
                foreground: root.foreground
                hoverColor: Color.urgent
                fontFamily: root.fontFamily
                onClicked: root.stopEverything()
              }
            }
          }

          TabStrip {
            width: parent.width
            current: root.tab
            counts: root.tabCounts
            alerting: root.counts.alerting > 0
            foreground: root.foreground
            fontFamily: root.fontFamily
            onSelected: function(key) { root.setTab(key) }
          }

          TextField {
            id: filterField
            width: parent.width
            foreground: root.foreground
            // The operator stays on the first line: a line that ends on a
            // complete expression gets a semicolon inserted for it, and the
            // rest of the binding is quietly dropped.
            placeholderText: Model.Glyph.search + "  Filter " + Model.tabNoun(root.tab) + "s" +
              (activeFocus ? "" : "   /")
            onTextChanged: {
              root.filterText = text
              root.cursorIndex = 0
            }
            Keys.onEscapePressed: {
              if (text.length > 0) text = ""
              else keyCatcher.forceActiveFocus()
            }
            Keys.onDownPressed: {
              keyCatcher.forceActiveFocus()
              root.moveCursor(0)
            }
          }

          ResourceList {
            id: list
            width: parent.width
            rows: root.rows
            kind: root.tab
            stats: root.stats
            showStats: root.showStats
            busy: actionProcess.running
            pendingId: root.pendingId
            cursorIndex: root.cursorIndex
            cursorActive: root.cursorActive
            cursorFromKeyboard: root.cursorFromKeyboard
            foreground: root.foreground
            fontFamily: root.fontFamily

            onActionRequested: function(kind, id, verb) { root.dispatch(kind, id, verb) }
            onRowClicked: function(id) { root.dispatch(root.tab, id, "copy") }
            onSectionToggled: function(key) { root.toggleSection(key) }
            onCursorRequested: function(index) { root.setCursor(index) }
          }

          Column {
            visible: list.count === 0
            width: parent.width
            spacing: Style.spacing.sm
            topPadding: Style.spacing.lg
            bottomPadding: Style.spacing.lg

            Text {
              width: parent.width
              horizontalAlignment: Text.AlignHCenter
              text: Model.emptyText(root.tab, {
                everLoaded: root.everLoaded,
                daemonReachable: root.daemonReachable,
                permissionDenied: root.permissionDenied,
                filtered: root.items.length > 0,
                showStopped: root.showStopped
              })
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
              wrapMode: Text.WordWrap
            }

            Text {
              visible: text !== ""
              width: parent.width
              horizontalAlignment: Text.AlignHCenter
              text: {
                if (root.permissionDenied) return "Rootless Podman needs a subuid/subgid range for your user.\nRun  podman info  to see what it found wrong."
                if (!root.daemonReachable && root.everLoaded) return "Run  podman info  to see what it found wrong."
                return ""
              }
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              wrapMode: Text.WordWrap
              lineHeight: 1.3
            }
          }

          // Podman's refusals are more useful than anything the panel could
          // invent, so they get their own line until the user dismisses them.
          Item {
            width: parent.width
            visible: root.lastError !== ""
            implicitHeight: visible ? Math.max(errorText.implicitHeight, errorDismiss.height) : 0
            height: implicitHeight

            Text {
              id: errorGlyph
              anchors.left: parent.left
              anchors.top: parent.top
              text: Model.Glyph.alert
              textFormat: Text.PlainText
              color: Color.urgent
              font.family: root.fontFamily
              font.pixelSize: Style.font.iconSmall
            }

            Text {
              id: errorText
              anchors.left: errorGlyph.right
              anchors.leftMargin: Style.spacing.md
              anchors.right: errorDismiss.left
              anchors.rightMargin: Style.spacing.md
              anchors.top: parent.top
              text: root.lastError
              textFormat: Text.PlainText
              color: Color.urgent
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              wrapMode: Text.WordWrap
            }

            PanelActionButton {
              id: errorDismiss
              anchors.right: parent.right
              anchors.top: parent.top
              anchors.topMargin: -Style.spacing.xs
              iconText: Model.Glyph.close
              tooltipText: "Dismiss"
              foreground: root.foreground
              fontFamily: root.fontFamily
              fontSize: Style.font.iconSmall
              size: Style.space(20)
              onClicked: root.lastError = ""
            }
          }

          PanelSeparator { foreground: root.foreground }

          Item {
            width: parent.width
            implicitHeight: Math.max(usageRow.implicitHeight, pruneButton.implicitHeight)
            height: implicitHeight

            Row {
              id: usageRow
              anchors.left: parent.left
              anchors.verticalCenter: parent.verticalCenter
              anchors.right: pruneButton.left
              anchors.rightMargin: Style.spacing.md
              spacing: Style.spacing.md

              Text {
                anchors.verticalCenter: parent.verticalCenter
                text: Model.Glyph.disk
                textFormat: Text.PlainText
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.iconSmall
              }

              Text {
                anchors.verticalCenter: parent.verticalCenter
                width: Math.min(implicitWidth, usageRow.width - Style.space(20))
                text: root.usageLine
                textFormat: Text.PlainText
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                elide: Text.ElideRight
              }
            }

            Button {
              id: pruneButton
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              enabled: root.prunable && !actionProcess.running
              bordered: true
              iconText: Model.Glyph.prune
              iconSize: Style.font.iconSmall
              text: Model.pruneSpec(root.tab) ? Model.pruneSpec(root.tab).label : ""
              tooltipText: "Reclaim what nothing is using  (p)"
              foreground: root.prunable ? root.foreground : root.dim
              fontFamily: root.fontFamily
              fontSize: Style.font.caption
              verticalPadding: Style.spacing.xs
              opacity: root.prunable ? 1.0 : 0.5
              onClicked: root.askPrune()
            }
          }
        }
      }

      ShortcutSheet {
        id: helpSheet
        anchors.fill: parent
        z: 5
        opened: root.helpOpen
        foreground: root.foreground
        background: Color.popups.background
        fontFamily: root.fontFamily
        onDismissed: root.helpOpen = false
      }

      ConfirmDialog {
        id: confirmDialog
        anchors.fill: parent
        z: 10
        opened: root.confirmOpen
        message: root.confirmMessage
        confirmText: root.confirmLabel
        background: Color.popups.background
        foreground: root.foreground
        fontFamily: root.fontFamily
        onCanceled: root.closeConfirm()
        onConfirmed: root.confirmAccepted()
      }
    }
  }
}
