// Entry point. With a subcommand the binary works as a command-line tool and exits:
//   DollPet notify <claude|codex|test> [--then <program> [args…]] [json]
//       send an agent event to the running pet (and pass it on to <program>)
//   DollPet connect|disconnect <claude|codex>   edit the agent's config
// Otherwise it starts the app.

import Cocoa

let args = Array(CommandLine.arguments.dropFirst())
switch args.first {
case "notify":
    Bridge.notify(arguments: Array(args.dropFirst()))
    exit(0) // always succeed: a failing hook would get in the agent's way
case "connect", "disconnect":
    guard args.count > 1, let agent = Bridge.Agent(rawValue: args[1]) else {
        print("Usage: DollPet connect|disconnect claude|codex")
        exit(2)
    }
    do {
        try Bridge.edit(agent, connect: args[0] == "connect")
        print(args[0] == "connect" ? "Connected \(agent.rawValue)" : "Disconnected \(agent.rawValue)")
        exit(0)
    } catch {
        FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
        exit(1)
    }
default:
    break
}

let app = NSApplication.shared
let delegate = MainActor.assumeIsolated { AppDelegate() }
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
