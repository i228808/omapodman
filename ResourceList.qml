import QtQuick
import QtQuick.Controls
import qs.Ui
import qs.Commons
import "Model.js" as Model

// The one list the panel draws, whichever tab is showing. Every tab hands it
// rows of the same shape (Model.ROW_FIELDS), so the delegate never has to ask
// what it is rendering — the row's own `kind` decides which buttons it gets
// and whether it carries CPU and memory meters.
//
// The ListModel is reconciled rather than reassigned: a container whose status
// line goes from "Up 59 seconds" to "Up About a minute" updates in place
// instead of rebuilding its delegate and dropping the hover state under the
// cursor.
Item {
  id: root

  property var rows: []
  property string kind: "containers"
  property var stats: ({})
  property bool showStats: true
  property bool busy: false
  property string pendingId: ""

  property int cursorIndex: 0
  property bool cursorActive: false
  property bool cursorFromKeyboard: false

  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property int maxHeight: Style.space(560)

  readonly property color dim: Qt.darker(foreground, 1.5)
  readonly property int count: rowModel.count

  signal actionRequested(string kind, string id, string verb)
  signal activated(string id)
  signal rowClicked(string id)
  signal sectionToggled(string sectionKey)
  signal cursorRequested(int index)

  width: parent ? parent.width : implicitWidth
  implicitHeight: listView.height
  height: implicitHeight

  ListModel { id: rowModel }

  // Called by the panel *before* it swaps tabs. Two tabs share no row keys, so
  // diffing one against the other is a full teardown dressed up as a diff —
  // and it makes the model briefly hold rows from both. Emptying it first
  // means the incoming rows are simply inserted.
  function clear() {
    rowModel.clear()
  }

  function sync() {
    var next = root.rows || []
    var keys = []
    for (var i = 0; i < rowModel.count; i++) keys.push(rowModel.get(i).key)

    var ops = Model.reconcilePlan(keys, next)
    for (var o = 0; o < ops.length; o++) {
      var op = ops[o]
      if (op.op === "remove") rowModel.remove(op.index)
      else if (op.op === "move") rowModel.move(op.from, op.to, 1)
      else rowModel.insert(op.index, Model.rowRecord(op.row))
    }

    for (var n = 0; n < next.length; n++) {
      var record = Model.rowRecord(next[n])
      var current = rowModel.get(n)
      for (var f = 0; f < Model.ROW_FIELDS.length; f++) {
        var field = Model.ROW_FIELDS[f]
        if (current[field] !== record[field]) rowModel.setProperty(n, field, record[field])
      }
    }
  }

  onRowsChanged: sync()
  Component.onCompleted: sync()

  ListView {
    id: listView

    width: parent.width
    height: rowModel.count > 0 ? Math.min(contentHeight, root.maxHeight) : 0
    visible: rowModel.count > 0
    spacing: Style.spacing.sm
    clip: true
    boundsBehavior: Flickable.StopAtBounds
    interactive: contentHeight > height

    ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

    model: rowModel
    currentIndex: root.cursorIndex

    onCurrentIndexChanged: {
      if (currentIndex >= 0 && root.cursorFromKeyboard) Qt.callLater(keepCurrentVisible)
    }
    function keepCurrentVisible() {
      if (currentIndex >= 0 && root.cursorFromKeyboard) positionViewAtIndex(currentIndex, ListView.Contain)
    }

    delegate: Column {
      id: rowGroup

      required property var model
      required property int index

      width: ListView.view.width
      spacing: Style.spacing.sm

      SectionHeader {
        visible: rowGroup.model.sectionTitle !== ""
        height: visible ? implicitHeight : 0
        width: parent.width
        title: rowGroup.model.sectionTitle
        sectionKey: rowGroup.model.sectionKey
        tally: rowGroup.model.sectionTally
        toggle: rowGroup.model.sectionToggle
        first: rowGroup.model.firstSection
      }

      ResourceRow {
        width: parent.width
        row: rowGroup.model
        rowIndex: rowGroup.index
      }
    }
  }

  component SectionHeader: Item {
    id: header

    required property string title
    required property string sectionKey
    required property string tally
    required property string toggle
    property bool first: false

    readonly property bool stopping: toggle === "stop"

    implicitHeight: headerLabel.implicitHeight + (first ? 0 : Style.spacing.xxl)

    PanelSeparator {
      visible: !header.first
      anchors.top: parent.top
      anchors.topMargin: Style.spacing.lg
      foreground: root.foreground
    }

    PanelSectionHeader {
      id: headerLabel
      anchors.left: parent.left
      anchors.bottom: parent.bottom
      text: header.title.toUpperCase()
      textFormat: Text.PlainText
      foreground: root.foreground
      fontFamily: root.fontFamily
    }

    Row {
      anchors.right: parent.right
      anchors.rightMargin: Style.spacing.md
      anchors.bottom: parent.bottom
      spacing: Style.spacing.sm

      Text {
        anchors.verticalCenter: parent.verticalCenter
        text: header.tally
        textFormat: Text.PlainText
        color: root.dim
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
      }

      PanelActionButton {
        visible: header.toggle !== ""
        enabled: !root.busy
        iconText: header.stopping ? Model.Glyph.stop : Model.Glyph.play
        tooltipText: (header.stopping ? "Stop " : "Start ") + header.title
        foreground: root.foreground
        hoverColor: header.stopping ? Color.urgent : root.foreground
        fontFamily: root.fontFamily
        fontSize: Style.font.iconSmall
        size: Style.space(20)
        onClicked: root.sectionToggled(header.sectionKey)
      }
    }
  }

  component ResourceRow: CursorSurface {
    id: rowSurface

    required property var row
    required property int rowIndex

    readonly property bool isContainer: rowSurface.row.kind === "containers"
    readonly property var rowStats: rowSurface.isContainer ? root.stats[rowSurface.row.id] : null
    readonly property bool rowBusy: root.pendingId === rowSurface.row.id
    readonly property var actions: Model.actionsFor(rowSurface.row)
    readonly property bool showMeters: root.showStats && rowSurface.isContainer && rowSurface.row.up

    hasCursor: root.cursorActive && rowIndex === root.cursorIndex
    foreground: root.foreground
    implicitHeight: rowContent.implicitHeight + Style.spacing.xxl
    height: implicitHeight

    MouseArea {
      id: rowMouse
      anchors.fill: parent
      hoverEnabled: true
      acceptedButtons: Qt.LeftButton
      cursorShape: Qt.PointingHandCursor
      onContainsMouseChanged: if (containsMouse) root.cursorRequested(rowSurface.rowIndex)
      onClicked: root.rowClicked(rowSurface.row.id)
    }

    PanelToolTip {
      visible: rowMouse.containsMouse
      text: Model.copyTooltip(rowSurface.row.kind) + "  (c)"
      fontFamily: root.fontFamily
    }

    Column {
      id: rowContent
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      anchors.leftMargin: Style.spacing.xl
      anchors.rightMargin: Style.spacing.xl
      spacing: Style.spacing.xs

      Item {
        width: parent.width
        implicitHeight: Math.max(identity.implicitHeight, rowActions.implicitHeight)

        Rectangle {
          id: stateDot
          width: Style.space(7)
          height: width
          radius: width / 2
          anchors.left: parent.left
          anchors.verticalCenter: parent.verticalCenter
          color: rowSurface.row.failing ? Color.urgent
            : (rowSurface.row.up ? Color.accent : "transparent")
          border.width: !rowSurface.row.up && !rowSurface.row.failing ? 1 : 0
          border.color: root.dim

          SequentialAnimation on opacity {
            running: rowSurface.row.restarting
            loops: Animation.Infinite
            NumberAnimation { to: 0.25; duration: 600; easing.type: Easing.InOutQuad }
            NumberAnimation { to: 1.0; duration: 600; easing.type: Easing.InOutQuad }
            onRunningChanged: if (!running) rowSurface.opacity = 1
          }
        }

        Column {
          id: identity
          anchors.left: stateDot.right
          anchors.leftMargin: Style.spacing.xl
          anchors.right: metaLabel.visible ? metaLabel.left : rowActions.left
          anchors.rightMargin: Style.spacing.lg
          anchors.verticalCenter: parent.verticalCenter
          spacing: Style.spacing.xxs

          Row {
            width: parent.width
            spacing: Style.spacing.md

            Text {
              text: rowSurface.row.name
              textFormat: Text.PlainText
              width: Math.min(implicitWidth, parent.width - (healthGlyph.visible ? healthGlyph.implicitWidth + Style.spacing.md : 0))
              color: rowSurface.row.muted ? root.dim : root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
              elide: Text.ElideRight
            }

            Text {
              id: healthGlyph
              visible: rowSurface.row.unhealthy
              anchors.verticalCenter: parent.verticalCenter
              text: Model.Glyph.unhealthy
              color: Color.urgent
              font.family: root.fontFamily
              font.pixelSize: Style.font.iconSmall
            }
          }

          Text {
            width: parent.width
            text: rowSurface.row.subtitle
            textFormat: Text.PlainText
            visible: text !== ""
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            elide: Text.ElideRight
          }

          Text {
            width: parent.width
            visible: text !== "" && !rowSurface.row.up
            text: rowSurface.row.status
            textFormat: Text.PlainText
            color: rowSurface.row.failing ? Color.urgent : root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            elide: Text.ElideRight
          }
        }

        Text {
          id: metaLabel
          visible: rowSurface.row.meta !== ""
          anchors.right: rowActions.left
          anchors.rightMargin: Style.spacing.lg
          anchors.verticalCenter: parent.verticalCenter
          text: rowSurface.row.meta
          textFormat: Text.PlainText
          color: rowSurface.row.muted ? root.foreground : root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }

        Row {
          id: rowActions
          anchors.right: parent.right
          anchors.rightMargin: Style.spacing.md
          anchors.verticalCenter: parent.verticalCenter
          spacing: Style.spacing.xxs

          Repeater {
            model: rowSurface.actions

            delegate: PanelActionButton {
              required property var modelData

              enabled: !rowSurface.rowBusy && !root.busy
              iconText: modelData.glyph
              tooltipText: modelData.tooltip
              foreground: root.foreground
              hoverColor: modelData.danger ? Color.urgent : root.foreground
              fontFamily: root.fontFamily
              fontSize: Style.font.iconSmall
              size: Style.space(22)
              onClicked: root.actionRequested(rowSurface.row.kind, rowSurface.row.id, modelData.verb)
            }
          }
        }
      }

      Row {
        visible: rowSurface.showMeters
        width: parent.width
        spacing: Style.spacing.xxl
        leftPadding: stateDot.width + Style.spacing.xl
        topPadding: Style.spacing.xs

        Meter {
          width: (rowContent.width - stateDot.width - Style.spacing.xl - Style.spacing.xxl) / 2
          caption: "CPU"
          percent: rowSurface.rowStats ? rowSurface.rowStats.cpuPercent : -1
          value: rowSurface.rowStats ? rowSurface.rowStats.cpu : ""
        }

        Meter {
          width: (rowContent.width - stateDot.width - Style.spacing.xl - Style.spacing.xxl) / 2
          caption: "MEM"
          percent: rowSurface.rowStats ? rowSurface.rowStats.memPercent : -1
          value: rowSurface.rowStats ? rowSurface.rowStats.mem : ""
        }
      }
    }
  }

  component Meter: Item {
    id: meter

    property string caption: ""
    property real percent: -1
    property string value: ""

    readonly property bool known: percent >= 0
    readonly property real fraction: Math.max(0, Math.min(1, percent / 100))

    implicitHeight: Math.max(meterCaption.implicitHeight, meterValue.implicitHeight)
    height: implicitHeight

    Text {
      id: meterCaption
      anchors.left: parent.left
      anchors.verticalCenter: parent.verticalCenter
      text: meter.caption
      textFormat: Text.PlainText
      color: root.dim
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
    }

    Rectangle {
      id: track
      anchors.left: meterCaption.right
      anchors.leftMargin: Style.spacing.md
      anchors.right: meterValue.left
      anchors.rightMargin: Style.spacing.md
      anchors.verticalCenter: parent.verticalCenter
      height: Style.space(3)
      radius: height / 2
      color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.12)

      Rectangle {
        width: meter.known ? parent.width * meter.fraction : 0
        height: parent.height
        radius: parent.radius
        color: meter.percent >= 85 ? Color.urgent : Color.accent

        Behavior on width { NumberAnimation { duration: 220; easing.type: Easing.OutCubic } }
      }
    }

    Text {
      id: meterValue
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      text: meter.value || "—"
      textFormat: Text.PlainText
      color: root.dim
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
    }
  }
}
