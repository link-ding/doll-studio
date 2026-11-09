// The user's own wallpaper pictures. Each one is copied into Application Support/DollPet/Pictures when it is
// added, so moving, renaming or deleting the original doesn't lose it, and each is a background of its own
// (WallpaperBackground.all lists them after the rooms, with a thumbnail of the picture as the swatch).
//
// A file is named "<milliseconds since 1970>-<original name>": the number keeps the order they were added in and
// two pictures with the same name apart; the swatch and the settings show the original name.

import Cocoa
import ImageIO
import UniformTypeIdentifiers

enum UserPictures {
    static let idPrefix = "picture:"

    static var folder: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("DollPet/Pictures", isDirectory: true)
    }

    // the pictures, oldest first (read again after a change)
    private static var cached: [URL]?
    static var all: [URL] {
        if let cached { return cached }
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil,
                                                                   options: [.skipsHiddenFiles])) ?? []
        let list = files.filter { isImage($0) }.sorted { $0.lastPathComponent < $1.lastPathComponent }
        cached = list
        return list
    }

    static func id(_ url: URL) -> String { idPrefix + url.lastPathComponent }
    static func url(for id: String) -> URL? {
        guard id.hasPrefix(idPrefix) else { return nil }
        let name = String(id.dropFirst(idPrefix.count))
        return all.first { $0.lastPathComponent == name }
    }

    // the original file name, without the number in front
    static func originalName(_ url: URL) -> String {
        let name = url.lastPathComponent
        guard let dash = name.firstIndex(of: "-"), name[..<dash].allSatisfy(\.isNumber) else { return name }
        return String(name[name.index(after: dash)...])
    }
    // what the swatch and the settings show: the original name without its extension
    static func displayName(_ url: URL) -> String { (originalName(url) as NSString).deletingPathExtension }

    static func isImage(_ url: URL) -> Bool {
        (try? url.resourceValues(forKeys: [.contentTypeKey]).contentType)?.conforms(to: .image) ?? false
    }

    // Copies a picture into the folder. The same file added again (same name and size) is not copied twice: the
    // one already there is returned.
    static func add(_ source: URL) throws -> URL {
        let fm = FileManager.default
        // one of these already (dropped from the folder after "Show in Finder")
        if let same = all.first(where: { $0.standardizedFileURL == source.standardizedFileURL }) { return same }
        let size = (try? source.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? -1
        if let same = all.first(where: {
            originalName($0) == source.lastPathComponent && (try? $0.resourceValues(forKeys: [.fileSizeKey]).fileSize) == size
        }) { return same }
        try fm.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent("\(Int64(Date().timeIntervalSince1970 * 1000))-\(source.lastPathComponent)")
        try fm.copyItem(at: source, to: url)
        cached = nil
        return url
    }

    // to the Trash, not deleted outright
    static func remove(_ url: URL) {
        try? FileManager.default.trashItem(at: url, resultingItemURL: nil)
        thumbs[url.lastPathComponent] = nil
        cached = nil
    }

    // A small picture for the swatch, made once (ImageIO reads only what it needs, so a large photo stays quick).
    private static var thumbs: [String: NSImage] = [:]
    static func thumbnail(_ url: URL) -> NSImage? {
        if let t = thumbs[url.lastPathComponent] { return t }
        guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
              let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, [
                  kCGImageSourceCreateThumbnailFromImageAlways: true,
                  kCGImageSourceCreateThumbnailWithTransform: true,
                  kCGImageSourceThumbnailMaxPixelSize: 160] as CFDictionary)
        else { return nil }
        let image = NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
        thumbs[url.lastPathComponent] = image
        return image
    }
}
