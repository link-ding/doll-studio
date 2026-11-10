// Connecting coding agents: connect adds DollPet to Claude Code's hooks
// (~/.claude/settings.json, Stop and Notification) or as Codex's notify program (~/.codex/config.toml); disconnect
// takes it out again. Each runs `DollPet notify <claude|codex>` (main.js, runNotify), which hands the event to the
// running pet.
//
// Entries that run any DollPet (this app, or the macOS one: both are called DollPet) are DollPet's, so connecting
// replaces an older one, e.g. after the app moved. Before a change the file is backed up as <file>.dollpet-backup,
// plus a dated copy in <userData>/Backups (the last ten of each file). Files are replaced in one step and keep their
// permissions; a settings file that is a symlink is written through.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CHAIN = '--then';

// home: where ~/.claude and ~/.codex are; command: the argv that starts DollPet (with the app folder in development);
// backups: the folder for dated copies; L: (en, zh) => text
function makeAgents({ home = os.homedir(), command, backups, L }) {
  const claudeSettings = path.join(home, '.claude', 'settings.json');
  const codexConfig = path.join(home, '.codex', 'config.toml');
  // what marks a command as DollPet's: the name, and in development the app folder (command[1])
  const ownMarks = ['DollPet', ...command.slice(1)];
  const isOurs = s => typeof s === 'string' && ownMarks.some(m => m && s.includes(m));

  // a shell command line: Claude Code runs hooks through a shell (bash on Windows too, so forward slashes)
  const shellArg = a => {
    const s = process.platform === 'win32' ? a.replace(/\\/g, '/') : a;
    return /^[\w./:@%+=-]+$/.test(s) ? s : '"' + s.replace(/(["\\$`])/g, '\\$1') + '"';
  };
  const claudeCommand = () => [...command, 'notify', 'claude'].map(shellArg).join(' ');

  const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

  function backup(text, file) {
    const real = (() => { try { return fs.realpathSync(file); } catch { return file; } })();
    let mode = null;
    try { mode = fs.statSync(real).mode & 0o777; } catch {}
    const dest = file + '.dollpet-backup';
    fs.writeFileSync(dest, text);
    if (mode != null) try { fs.chmodSync(dest, mode); } catch {}
    // the dated history is a bonus: failing to keep it doesn't stop the change
    try {
      const suffix = '-' + path.basename(file);
      fs.mkdirSync(backups, { recursive: true });
      const kept = fs.readdirSync(backups).filter(f => f.endsWith(suffix)).sort();
      if (kept.length && read(path.join(backups, kept[kept.length - 1])) === text) return;
      const d = new Date(), p = n => String(n).padStart(2, '0');
      const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
      fs.writeFileSync(path.join(backups, stamp + suffix), text, { mode: 0o600 });
      for (const old of kept.slice(0, Math.max(0, kept.length - 9))) fs.rmSync(path.join(backups, old), { force: true });
    } catch {}
  }

  function write(text, file) {
    const target = (() => { try { return fs.realpathSync(file); } catch { return file; } })();
    let mode = null;
    try { mode = fs.statSync(target).mode & 0o777; } catch {}
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = target + '.dollpet-tmp';
    fs.writeFileSync(tmp, text);
    if (mode != null) try { fs.chmodSync(tmp, mode); } catch {}
    fs.renameSync(tmp, target);
  }

  // ---------- Claude Code ----------

  const isOurClaudeGroup = g => (Array.isArray(g?.hooks) ? g.hooks : [])
    .some(h => typeof h?.command === 'string' && h.command.endsWith(' notify claude') && isOurs(h.command));

  function claudeConnected() {
    const root = (() => { try { return JSON.parse(read(claudeSettings)); } catch { return null; } })();
    const groups = root?.hooks?.Stop;
    return Array.isArray(groups) && groups.some(isOurClaudeGroup);
  }

  function editClaude(add) {
    const text = read(claudeSettings);
    let root = {};
    if (text && text.trim()) {
      try { root = JSON.parse(text); } catch { root = null; }
      if (!root || typeof root !== 'object' || Array.isArray(root)) {
        throw new Error(L('~/.claude/settings.json is not valid JSON, so it was left unchanged.', '~/.claude/settings.json 不是有效的 JSON，没有改动它。'));
      }
      backup(text, claudeSettings);
    } else if (!add) {
      return;
    }
    const hooks = root.hooks && typeof root.hooks === 'object' ? root.hooks : {};
    for (const event of ['Stop', 'Notification']) {
      const groups = (Array.isArray(hooks[event]) ? hooks[event] : []).filter(g => !isOurClaudeGroup(g));
      if (add) groups.push({ hooks: [{ type: 'command', command: claudeCommand(), timeout: 10 }] });
      if (groups.length) hooks[event] = groups; else delete hooks[event];
    }
    if (Object.keys(hooks).length) root.hooks = hooks; else delete root.hooks;
    write(JSON.stringify(root, null, 2) + '\n', claudeSettings);
  }

  // ---------- Codex ----------

  const tomlString = s => '"' + [...s].map(c => {
    const n = c.codePointAt(0);
    if (c === '"') return '\\"';
    if (c === '\\') return '\\\\';
    if (c === '\n') return '\\n';
    if (c === '\t') return '\\t';
    if (c === '\r') return '\\r';
    if (n < 0x20 || n === 0x7f) return '\\u' + n.toString(16).toUpperCase().padStart(4, '0');
    return c;
  }).join('') + '"';
  const notifyLine = argv => 'notify = [' + argv.map(tomlString).join(', ') + ']';

  // `key = ["a", 'b', …]` on one line; null for anything else (multi-line array, non-string item, trailing junk)
  function tomlStringArray(line) {
    const eq = line.indexOf('=');
    if (eq < 0) return null;
    const s = line.slice(eq + 1);
    let i = 0;
    const space = () => { while (s[i] === ' ' || s[i] === '\t') i++; };
    space();
    if (s[i++] !== '[') return null;
    const items = [];
    for (;;) {
      space();
      const c = s[i++];
      if (c === undefined) return null;
      if (c === ']') break;
      if (c === ',' && items.length) continue;
      let out = '';
      if (c === "'") {
        for (;;) { const d = s[i++]; if (d === undefined) return null; if (d === "'") break; out += d; }
      } else if (c === '"') {
        for (;;) {
          const d = s[i++];
          if (d === undefined) return null;
          if (d === '"') break;
          if (d !== '\\') { out += d; continue; }
          const e = s[i++];
          const simple = { '"': '"', '\\': '\\', n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', e: '\x1b' };
          if (e in simple) { out += simple[e]; continue; }
          if (e === 'u' || e === 'U') {
            const n = e === 'u' ? 4 : 8, hex = s.slice(i, i + n);
            if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== n) return null;
            out += String.fromCodePoint(parseInt(hex, 16));
            i += n;
            continue;
          }
          return null;
        }
      } else {
        return null;
      }
      items.push(out);
    }
    space();
    if (i < s.length && s[i] !== '#') return null;
    return items;
  }

  const isNotifyLine = l => /^\s*notify\s*=/.test(l);
  const isOurCodexLine = l => {
    if (!isNotifyLine(l)) return false;
    const argv = tomlStringArray(l);
    if (!argv) return l.includes('DollPet') && l.includes('"codex"');
    const end = argv.indexOf(CHAIN) < 0 ? argv.length : argv.indexOf(CHAIN);
    const own = argv.slice(0, end);
    return own.includes('codex') && own.some(isOurs);
  };

  function codexConnected() {
    const text = read(codexConfig);
    return !!text && text.split('\n').some(isOurCodexLine);
  }

  function editCodex(add) {
    const text = read(codexConfig) ?? '';
    const lines = text ? text.split('\n') : [];
    let firstTable = lines.findIndex(l => l.trim().startsWith('['));
    if (firstTable < 0) firstTable = lines.length;
    let at = 0, chained = [];
    const i = lines.slice(0, firstTable).findIndex(isNotifyLine);
    if (i >= 0) {
      at = i;
      if (isOurCodexLine(lines[i])) {
        const argv = tomlStringArray(lines[i]);
        const m = argv ? argv.indexOf(CHAIN) : -1;
        if (m >= 0) chained = argv.slice(m + 1);
      } else {
        if (!add) return;
        const argv = tomlStringArray(lines[i]);
        if (!argv || !argv.length) {
          throw new Error(L(`Codex already has a notify setting DollPet can't read (~/.codex/config.toml line ${i + 1}). DollPet left it in place.`,
            `Codex 已经有一个 DollPet 读不懂的 notify 设置（~/.codex/config.toml 第 ${i + 1} 行），DollPet 没有改动它。`));
        }
        chained = argv;
      }
      lines.splice(i, 1);
    } else if (!add) {
      return;
    }
    if (add) lines.splice(at, 0, notifyLine([...command, 'notify', 'codex', ...(chained.length ? [CHAIN, ...chained] : [])]));
    else if (chained.length) lines.splice(at, 0, notifyLine(chained));
    if (text) backup(text, codexConfig);
    let out = lines.join('\n');
    if (out && !out.endsWith('\n')) out += '\n';
    write(out, codexConfig);
  }

  return {
    connected: agent => (agent === 'claude' ? claudeConnected() : codexConnected()),
    edit: (agent, on) => (agent === 'claude' ? editClaude(on) : editCodex(on)),
    // exposed for tests
    tomlStringArray, notifyLine, claudeCommand,
  };
}

module.exports = { makeAgents };
