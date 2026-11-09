// Controls shared by the popover and the settings window: a segmented picker in the popover's style, and the
// wallpaper background swatches.

import SwiftUI

struct SoftSegments<V: Hashable>: View {
    let options: [(String, V)]
    @Binding var selection: V
    var height: CGFloat = 28

    var body: some View {
        HStack(spacing: 2) {
            ForEach(options, id: \.1) { name, value in
                let on = selection == value
                Button { selection = value } label: {
                    Text(name)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(on ? Theme.text : Theme.muted)
                        .frame(maxWidth: .infinity, minHeight: height)
                        .background(RoundedRectangle(cornerRadius: 7).fill(on ? Color.white : .clear)
                            .shadow(color: .black.opacity(on ? 0.12 : 0), radius: 1, y: 1))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(3)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color(hex: 0xECEEF3)))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.line))
    }
}

// One swatch per background, then "+", which adds pictures of the user's. Pictures can also be dropped on the
// swatches, and a picture's swatch has "Show in Finder" and "Remove" on a right click.
struct BackgroundSwatches: View {
    @ObservedObject var model: SettingsModel
    var size: CGFloat = 32
    var spacing: CGFloat = 8
    // swatches per row; the rest wrap onto more rows
    var perRow = 8

    var body: some View {
        let cell = GridItem(.fixed(size + 6), spacing: spacing)
        LazyVGrid(columns: Array(repeating: cell, count: perRow), alignment: .leading, spacing: spacing) {
            ForEach(WallpaperBackground.all, id: \.id) { bg in
                let on = model.wallpaperBackground == bg.id
                Button {
                    if bg.id == WallpaperBackground.picture { model.chooseWallpaperPicture() }
                    else { model.wallpaperBackground = bg.id }
                } label: {
                    swatch(bg)
                        .frame(width: size, height: size)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.border))
                        .padding(3)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(on ? Theme.accent : .clear, lineWidth: 2))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(bg.id == WallpaperBackground.picture ? L("Add pictures… (or drop them here)", "添加图片…（也可以直接拖到这里）") : bg.name)
                .accessibilityLabel(bg.name)
                .accessibilityAddTraits(on ? .isSelected : [])
                .contextMenu {
                    if let file = bg.file {
                        Button(L("Show in Finder", "在访达中显示")) { NSWorkspace.shared.activateFileViewerSelecting([file]) }
                        Button(L("Remove", "移除")) { model.removeWallpaperPicture(bg.id) }
                    }
                }
            }
        }
        .dropDestination(for: URL.self) { urls, _ in
            let pictures = urls.filter { UserPictures.isImage($0) }
            guard !pictures.isEmpty else { return false }
            model.addWallpaperPictures(pictures)
            return true
        }
    }

    // a scene: a small gingham check in its colours with its symbol; the desktop picture and a picture: just the symbol
    @ViewBuilder func swatch(_ bg: WallpaperBackground) -> some View {
        if let thumb = bg.thumbnail {
            Image(nsImage: thumb).resizable().scaledToFill()
        } else {
            pattern(bg)
        }
    }

    func pattern(_ bg: WallpaperBackground) -> some View {
        Canvas { ctx, sz in
            ctx.fill(Path(CGRect(origin: .zero, size: sz)), with: .color(Color(hex: bg.base)))
            guard bg.isScene else { return }
            let step = sz.width / 4, tint = Color(hex: bg.accent).opacity(bg.base < 0x808080 ? 0.12 : 0.22)
            for i in stride(from: 0, to: 4, by: 2) {
                ctx.fill(Path(CGRect(x: CGFloat(i) * step, y: 0, width: step, height: sz.height)), with: .color(tint))
                ctx.fill(Path(CGRect(x: 0, y: CGFloat(i) * step, width: sz.width, height: step)), with: .color(tint))
            }
        }
        .overlay(Image(systemName: bg.symbol).font(.system(size: size * 0.4, weight: .semibold)).foregroundStyle(Color(hex: bg.symbolColor)))
    }
}
