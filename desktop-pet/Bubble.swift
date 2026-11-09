// Speech bubble shown above the pet when a coding agent finishes or needs the user.
// Click it to dismiss; it also hides on its own after a while.

import Cocoa

@MainActor
final class Bubble {
    private let panel: NSPanel
    private let view = BubbleView()
    private var hideTimer: Timer?

    init() {
        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: BubbleView.width, height: 80),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.contentView = view
        setDesktop(false)
        view.onClick = { [weak self] in self?.hide() }
    }

    var isVisible: Bool { panel.isVisible }

    // Over every window while the pet floats; in wallpaper mode it belongs to the desktop like the character does,
    // just above the desktop icons (so it can still be clicked) and under the windows of other apps.
    func setDesktop(_ on: Bool) {
        if on {
            panel.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) + 1)
            panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        } else {
            panel.level = .floating
            panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        }
    }

    func show(title: String, project: String, body: String, attention: Bool, above pet: NSRect) {
        view.set(title: title, project: project, body: body, attention: attention)
        panel.setContentSize(view.fittingSize)
        place(above: pet)
        panel.orderFrontRegardless()
        hideTimer?.invalidate()
        hideTimer = Timer.scheduledTimer(withTimeInterval: attention ? 20 : 10, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.hide() }
        }
    }

    // Centered over the pet's top edge, kept on screen; the tail points at the pet.
    func place(above pet: NSRect) {
        let s = panel.frame.size
        var o = NSPoint(x: pet.midX - s.width / 2, y: pet.maxY - 8)
        if let vf = (NSScreen.screens.first { $0.frame.intersects(pet) } ?? NSScreen.main)?.visibleFrame {
            o.x = min(max(o.x, vf.minX + 4), vf.maxX - s.width - 4)
            o.y = min(o.y, vf.maxY - s.height - 4)
        }
        if o != panel.frame.origin { panel.setFrameOrigin(o) }
        view.tailX = min(max(pet.midX - o.x, 24), s.width - 24)
    }

    func hide() {
        hideTimer?.invalidate()
        panel.orderOut(nil)
    }
}

final class BubbleView: NSView {
    static let width: CGFloat = 270
    static let tail: CGFloat = 10

    var onClick: (() -> Void)?
    var tailX: CGFloat = width / 2 { didSet { if oldValue != tailX { needsDisplay = true } } }
    private var attention = false
    private let dot = NSView()
    private let title = NSTextField(labelWithString: "")
    private let body = NSTextField(wrappingLabelWithString: "")

    // a "done" bubble is white; one that needs the user is orange (same as the settings preview)
    static let doneFill = NSColor.white, doneStroke = NSColor(red: 0.894, green: 0.902, blue: 0.925, alpha: 1)
    static let alertFill = NSColor(red: 1, green: 0.702, blue: 0.361, alpha: 1), alertStroke = NSColor(red: 0.93, green: 0.6, blue: 0.25, alpha: 1)
    static let alertText = NSColor(red: 0.165, green: 0.09, blue: 0.016, alpha: 1)

    init() {
        super.init(frame: .zero)
        appearance = NSAppearance(named: .aqua) // the bubble is always light
        dot.wantsLayer = true
        dot.layer?.cornerRadius = 3.5
        title.font = .systemFont(ofSize: 11.5, weight: .semibold)
        title.lineBreakMode = .byTruncatingTail
        body.font = .systemFont(ofSize: 13, weight: .medium)
        body.maximumNumberOfLines = 4
        body.preferredMaxLayoutWidth = Self.width - 28
        let head = NSStackView(views: [dot, title])
        head.spacing = 6
        head.alignment = .centerY
        let stack = NSStackView(views: [head, body])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 4
        stack.edgeInsets = NSEdgeInsets(top: 11, left: 14, bottom: 12 + Self.tail, right: 14)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            dot.widthAnchor.constraint(equalToConstant: 7),
            dot.heightAnchor.constraint(equalToConstant: 7),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor),
            stack.topAnchor.constraint(equalTo: topAnchor),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor),
            widthAnchor.constraint(equalToConstant: Self.width),
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    // The title and project share the top line ("Claude Code finished · doll-studio"); the message goes below.
    func set(title t: String, project p: String, body b: String, attention a: Bool) {
        title.stringValue = p.isEmpty ? t : "\(t) · \(p)"
        title.textColor = a ? NSColor(red: 0.353, green: 0.204, blue: 0.035, alpha: 1) : NSColor(red: 0.369, green: 0.384, blue: 0.427, alpha: 1)
        body.stringValue = b
        body.isHidden = b.isEmpty
        body.textColor = a ? Self.alertText : NSColor(red: 0.102, green: 0.106, blue: 0.133, alpha: 1)
        dot.layer?.backgroundColor = (a ? Self.alertText : NSColor(red: 0.118, green: 0.62, blue: 0.388, alpha: 1)).cgColor
        attention = a
        needsDisplay = true
        layoutSubtreeIfNeeded()
    }

    override func draw(_ dirtyRect: NSRect) {
        let r = bounds.insetBy(dx: 1, dy: 1)
        let x0 = r.minX, x1 = r.maxX, y0 = r.minY + Self.tail, y1 = r.maxY, rad: CGFloat = 14
        let p = NSBezierPath()
        p.move(to: NSPoint(x: x0 + rad, y: y0))
        p.line(to: NSPoint(x: tailX - 8, y: y0))
        p.line(to: NSPoint(x: tailX, y: r.minY))
        p.line(to: NSPoint(x: tailX + 8, y: y0))
        p.line(to: NSPoint(x: x1 - rad, y: y0))
        p.appendArc(withCenter: NSPoint(x: x1 - rad, y: y0 + rad), radius: rad, startAngle: 270, endAngle: 360)
        p.line(to: NSPoint(x: x1, y: y1 - rad))
        p.appendArc(withCenter: NSPoint(x: x1 - rad, y: y1 - rad), radius: rad, startAngle: 0, endAngle: 90)
        p.line(to: NSPoint(x: x0 + rad, y: y1))
        p.appendArc(withCenter: NSPoint(x: x0 + rad, y: y1 - rad), radius: rad, startAngle: 90, endAngle: 180)
        p.line(to: NSPoint(x: x0, y: y0 + rad))
        p.appendArc(withCenter: NSPoint(x: x0 + rad, y: y0 + rad), radius: rad, startAngle: 180, endAngle: 270)
        p.close()
        (attention ? Self.alertFill : Self.doneFill).setFill()
        p.fill()
        (attention ? Self.alertStroke : Self.doneStroke).setStroke()
        p.lineWidth = 1
        p.stroke()
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { onClick?() }
}
