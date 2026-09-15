import QtQuick
import qs.Ui
import qs.Commons
import "Model.js" as Model

// The `?` sheet. Omarchy is a keyboard-first shell, so the panel says out
// loud what it listens for rather than leaving it to the tooltips. The list
// itself lives in Model.SHORTCUTS, which the README quotes too.
Item {
  id: root

  property bool opened: false
  property color foreground: Color.foreground
  property color background: Color.popups.background
  property string fontFamily: Style.font.family

  readonly property color dim: Qt.darker(foreground, 1.5)

  signal dismissed()

  visible: opened

  Rectangle {
    anchors.fill: parent
    color: Qt.rgba(root.background.r, root.background.g, root.background.b, 0.97)

    MouseArea {
      anchors.fill: parent
      onClicked: root.dismissed()
    }

    Column {
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      anchors.leftMargin: Style.spacing.md
      anchors.rightMargin: Style.spacing.md
      spacing: Style.spacing.lg

      Row {
        width: parent.width
        spacing: Style.spacing.md

        Text {
          anchors.verticalCenter: parent.verticalCenter
          text: Model.Glyph.keyboard
          textFormat: Text.PlainText
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.icon
        }

        Text {
          anchors.verticalCenter: parent.verticalCenter
          text: "KEYBOARD"
          textFormat: Text.PlainText
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          font.bold: true
          font.letterSpacing: 1.2
        }
      }

      Repeater {
        model: Model.shortcutGroups()

        delegate: Column {
          required property var modelData

          width: parent.width
          spacing: Style.spacing.xs
          topPadding: Style.spacing.xs

          PanelSectionHeader {
            text: modelData.title.toUpperCase()
            textFormat: Text.PlainText
            foreground: root.foreground
            fontFamily: root.fontFamily
          }

          Repeater {
            model: modelData.entries

            delegate: Item {
              required property var modelData

              width: parent.width
              implicitHeight: entryText.implicitHeight + Style.spacing.xs
              height: implicitHeight

              Text {
                id: entryKeys
                anchors.left: parent.left
                anchors.verticalCenter: parent.verticalCenter
                width: Style.space(90)
                text: modelData.keys
                textFormat: Text.PlainText
                color: Color.accent
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
              }

              Text {
                id: entryText
                anchors.left: entryKeys.right
                anchors.leftMargin: Style.spacing.md
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                text: modelData.text
                textFormat: Text.PlainText
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                elide: Text.ElideRight
              }
            }
          }
        }
      }

      Text {
        width: parent.width
        topPadding: Style.spacing.md
        horizontalAlignment: Text.AlignHCenter
        text: "press ? or esc to go back"
        textFormat: Text.PlainText
        color: root.dim
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
      }
    }
  }
}
