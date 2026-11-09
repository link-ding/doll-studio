// Shared look for the native windows (menu bar popover, settings): the same light palette and accent as the
// editor page (index.html). Keep the two in step.

import SwiftUI

enum Theme {
    static let accent = Color(hex: 0xE0245E)
    static let text = Color(hex: 0x1A1B22)
    static let text2 = Color(hex: 0x3D404A)
    static let muted = Color(hex: 0x5E626D)
    static let dim = Color(hex: 0x6B6F7A)
    static let line = Color(hex: 0xE4E6EC)
    static let border = Color(hex: 0xDADDE5)
    static let card = Color(hex: 0xF5F6FA)
    static let tile = Color(hex: 0xF3F4F8)
    static let side = Color(hex: 0xFAFAFC)
    static let stage = Color(hex: 0xF4F0FF)
    static let green = Color(hex: 0x0B7A50)
    static let switchOff = Color(hex: 0xD3D6DE)
    static let attention = Color(hex: 0xFFB35C)
    static let attentionText = Color(hex: 0x2A1704)

    // one colour per quick toggle in the popover, so what is on reads at a glance
    static let violet = Color(hex: 0x6D4AFF)
    static let blue = Color(hex: 0x1F6FEB)
    static let teal = Color(hex: 0x0A8F62)
    static let orange = Color(hex: 0xE8590C)
    static let rose = Color(hex: 0xC2255C)
}

extension Color {
    init(hex: UInt32) {
        self.init(.sRGB, red: Double(hex >> 16 & 0xFF) / 255, green: Double(hex >> 8 & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255, opacity: 1)
    }
}

// An on/off switch in the accent colour (the system switch follows the user's accent instead).
struct PillSwitch: ToggleStyle {
    var color = Theme.accent

    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 10) {
            configuration.label
            Spacer(minLength: 0)
            Capsule()
                .fill(configuration.isOn ? color : Theme.switchOff)
                .frame(width: 38, height: 22)
                .overlay(alignment: configuration.isOn ? .trailing : .leading) {
                    Circle().fill(.white).shadow(color: .black.opacity(0.2), radius: 1, y: 1).padding(2)
                }
                .animation(.easeOut(duration: 0.15), value: configuration.isOn)
        }
        .contentShape(Rectangle())
        .onTapGesture { configuration.isOn.toggle() }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityValue(configuration.isOn ? L("On", "开") : L("Off", "关"))
    }
}

// Small bordered button used across the popover and settings.
struct SoftButton: ButtonStyle {
    var prominent = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: prominent ? .semibold : .medium))
            .foregroundStyle(prominent ? Color.white : Theme.text)
            .padding(.horizontal, 10)
            .frame(height: 26)
            .background(RoundedRectangle(cornerRadius: 7).fill(prominent ? Theme.accent : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 7).stroke(prominent ? Theme.accent : Theme.border))
            .opacity(configuration.isPressed ? 0.75 : 1)
            .contentShape(Rectangle())
    }
}

// Uppercase section caption.
struct Caption: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .semibold))
            .tracking(0.6)
            .foregroundStyle(Theme.dim)
    }
}

// A model's placeholder thumbnail: a pastel dot on a checkerboard.
struct ModelThumb: View {
    var size: CGFloat = 46
    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.28)
            .fill(Theme.card)
            .overlay(Circle().fill(Color(hex: 0xC9B6F7)).frame(width: size * 0.48, height: size * 0.48))
            .overlay(RoundedRectangle(cornerRadius: size * 0.28).stroke(Theme.line))
            .frame(width: size, height: size)
    }
}

extension RecentModel {
    static let ago: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return f
    }()

    var agoText: String {
        Self.ago.locale = Locale(identifier: Lang.isChinese ? "zh_CN" : "en_US")
        return Self.ago.localizedString(for: lastUsed, relativeTo: Date())
    }
}
