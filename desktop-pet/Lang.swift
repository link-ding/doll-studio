// Interface language: English or Chinese (简体中文). Strings are written in place as pairs, L("Open", "打开").
// The choice is "system" (follow the Mac's preferred language), "en" or "zh", kept in the defaults; the web pages
// get it as window.DOLL_LANG (see AppDelegate.langScript) and switch live through window.setDollLang.

import Foundation

enum Lang {
    static let key = "language"

    // "system", "en" or "zh"
    static var setting: String {
        get { UserDefaults.standard.string(forKey: key) ?? "system" }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }

    static var isChinese: Bool {
        switch setting {
        case "zh": return true
        case "en": return false
        default: return Locale.preferredLanguages.first?.hasPrefix("zh") ?? false
        }
    }

    // for the web pages: "zh" or "en"
    static var code: String { isChinese ? "zh" : "en" }
}

func L(_ en: String, _ zh: String) -> String { Lang.isChinese ? zh : en }
