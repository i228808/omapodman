import QtQuick
import qs.Ui
import qs.Commons
import "Model.js" as Model

// The panel's four tabs, laid out as equal columns across the full width so
// the strip reads as one control rather than a row of loose chips. The active
// tab is marked by an accent rule along its bottom edge; the keyboard cursor
// and the mouse both light a tab the same way, through CursorSurface.
Item {
  id: root

  property string current: "containers"
  // { containers: 12, images: 43, volumes: 30, networks: 8 }
  property var counts: ({})
  property bool alerting: false
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family

  readonly property color dim: Qt.darker(foreground, 1.5)
  readonly property int columnWidth: Math.floor(width / Model.TABS.length)

  signal selected(string key)

  width: parent ? parent.width : implicitWidth
  implicitHeight: Style.space(32)
  height: implicitHeight

  Row {
    anchors.fill: parent

    Repeater {
      model: Model.TABS

      delegate: Item {
        id: tab

        required property var modelData
        required property int index

        readonly property bool isCurrent: root.current === tab.modelData.key
        readonly property int count: {
          var value = root.counts ? root.counts[tab.modelData.key] : undefined
          return value === undefined || value === null ? -1 : Number(value)
        }
        // Only the containers tab has anything that can go wrong.
        readonly property bool urgent: root.alerting && tab.modelData.key === "containers"

        // The last column absorbs whatever the integer division dropped, so
        // the strip always ends exactly on the panel's right edge.
        width: tab.index === Model.TABS.length - 1
          ? root.width - root.columnWidth * (Model.TABS.length - 1)
          : root.columnWidth
        height: parent.height

        CursorSurface {
          anchors.fill: parent
          anchors.bottomMargin: Style.space(2)
          hasCursor: tabMouse.containsMouse
          current: tab.isCurrent
          foreground: root.foreground
        }

        Row {
          anchors.centerIn: parent
          spacing: Style.spacing.md

          Text {
            anchors.verticalCenter: parent.verticalCenter
            text: tab.modelData.glyph
            textFormat: Text.PlainText
            color: tab.urgent ? Color.urgent : (tab.isCurrent ? root.foreground : root.dim)
            font.family: root.fontFamily
            font.pixelSize: Style.font.iconSmall
          }

          Text {
            anchors.verticalCenter: parent.verticalCenter
            text: tab.modelData.label
            textFormat: Text.PlainText
            color: tab.isCurrent ? root.foreground : root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            font.bold: tab.isCurrent
          }

          Text {
            anchors.verticalCenter: parent.verticalCenter
            visible: tab.count >= 0
            text: tab.count
            textFormat: Text.PlainText
            color: tab.urgent ? Color.urgent : root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }
        }

        Rectangle {
          anchors.left: parent.left
          anchors.right: parent.right
          anchors.bottom: parent.bottom
          anchors.leftMargin: Style.spacing.md
          anchors.rightMargin: Style.spacing.md
          height: Style.space(2)
          radius: height / 2
          color: tab.urgent ? Color.urgent : Color.accent
          opacity: tab.isCurrent ? 1 : 0

          Behavior on opacity { NumberAnimation { duration: 120 } }
        }

        MouseArea {
          id: tabMouse
          anchors.fill: parent
          hoverEnabled: true
          cursorShape: Qt.PointingHandCursor
          onClicked: root.selected(tab.modelData.key)
        }
      }
    }
  }
}
