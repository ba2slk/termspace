# Session files

One YAML file in `~/.config/termspace/sessions/` is one session. The file name
is the session's id; the `name:` field is what the sidebar shows. They can
differ.

**The app only reads these files.** Splitting, resizing, or moving panes at
runtime never writes back — restart and you are back to what the file says.
The only writes are the explicit saves described below.

## The format

```yaml
name: dev
cwd: "~/dev/projects/app"     # unquoted ~ is null in YAML — quote it
shell: /usr/bin/zsh           # defaults to $SHELL, then /bin/sh

columns:                      # left to right
  - width: 720                # px; never shrinks with the window
    panes:
      - title: editor
        command: nvim .
      - title: shell
        height: 0.3           # vertical share within the column; omitted = equal

  - width: 900
    panes:
      - title: server
        cwd: ./backend        # relative to the session cwd
        command: uv run fastapi dev
```

`command` is **typed into the shell**, exactly as if you had pressed the keys
yourself — the shell is not replaced by the program. If the program dies, the
shell survives and you can rerun it right there.

For commands you don't want auto-running, use `prefill`: it is placed at the
prompt but Enter is never pressed — tmux `send-keys` without the `C-m`.

```yaml
      - title: cu
        prefill: cu down full && cu start full && cu logs be
```

A typo in the config doesn't kill the session. The broken pane becomes a card
saying what is wrong and which file to fix; everything else runs normally.

## The first run

If the sessions directory does not exist at all, the app creates it and writes
one session into it, `Welcome.yaml`. It is not opened for you; it sits in the
list as something to read and edit. Nothing rewrites it afterwards, so once it
is there it is yours to change or delete: emptying the directory does not bring
it back, only removing the directory itself does.

Its middle pane prints the main shortcuts for the platform and the language the
app started with; changing either later leaves the file as it was written.

## Files the app owns

Two small JSON files sit beside `sessions/`, in `~/.config/termspace/`. They are the
app's, not yours: it writes them, and nothing in them changes what a session *is*.

- `session-order.json` — the order the sidebar lists sessions in, which is also the
  order `Alt` + `1`–`9` open. Set by dragging a row. A session not yet dragged sorts by
  when its file was created.
- `session-archive.json` — the ids of the sessions you have archived. An archived
  session is out of the list, out of `Alt` + `1`–`9` and off the step ring, sitting in
  the dock at the sidebar's bottom until you restore it, which puts it back at the end
  of the list.

Both hold ids, and an id that no longer has a file is simply ignored — deleting a
session by hand leaves nothing to clean up, and cannot bring a deleted one back.
Deleting either file loses only the order or the archive: every session is still
whatever its own YAML says.

## Three ways to make one

**Start empty** — `+` in the sidebar header, right-click the sidebar, or ☰ →
new session. You get a one-pane session, open immediately. Split from there.

**Save the layout you already shaped** — the tedious part of writing a session
by hand is the layout: you don't know the right column widths and pane ratios
until you have tried them. So it works the other way around too:

1. Shape the layout with the split controls
2. `cd` each pane where you want it
3. ☰ → save current layout as a session; give it a name and a **base directory**

Column widths, pane ratios, and the directory each shell is standing in *right
now* land in a new YAML file. It records where you are, not where you started —
otherwise the moving around you just did would be lost.

If the name exists, the button turns into an explicit **overwrite**. Once a
session has a file, `Alt+Shift` + `S` (the title bar's save button) re-saves it
in place without asking, keeping the previous version beside it as
`<id>.yaml.bak`.

**By hand** — files the app wrote are ordinary YAML and can be edited the same
way. ☰ → edit session file (or right-click a session in the sidebar) splits a
pane and opens the file in `$EDITOR`, falling back to `$VISUAL`, then `vi`.

## What a save captures

The **base directory** becomes `cwd` at the top of the file — the session's
anchor. Panes under it are written as relative paths, so moving a project
folder means editing one line.

Commands running at save time are captured too, with two rules:

- Panes with a `prefill` are not captured. Prefill means "don't auto-run", and
  overwriting it with whatever is running would reverse that decision.
- An idle shell keeps its original `command`. Dropping to the shell for a
  moment doesn't erase what that pane is for.
- Unless it has been `cd`-ed away: an idle pane sitting somewhere other than
  where it started is saved with no `command`. Its old command belongs to the
  old directory, and pairing it with the new one would describe something that
  never ran.

## Shell integration

Saving reads what each pane is running from `/proc`, which is blind to aliases:
run `qatn` and the file gets the several hundred characters it expands into.

For bash and zsh, the shell can be asked instead. `Ctrl` + `,` › Shell
integration shows one line to add to your rc file.

bash — `~/.bashrc`:

```bash
[ -f ~/.config/termspace/shell-integration.bash ] && . ~/.config/termspace/shell-integration.bash
```

zsh — `~/.zshrc`:

```bash
[ -f ~/.config/termspace/shell-integration.zsh ] && . ~/.config/termspace/shell-integration.zsh
```

After that a saved session records the line you actually submitted — the alias
name, and the same for anything recalled with ↑ or completed with Tab. The zsh
hook also reports the working directory as `OSC 7`, which is where the cwd of a
saved pane comes from on macOS: there is no `/proc` to read it from.

Panes already open keep the shell they started with, so reopen the session
after adding the line.

Termspace never edits your rc file; you add that line and it stays yours.
Without it nothing changes, and fish keeps reading `/proc` for now.

## Signals a pane can send

Panes go off screen by design, so a program that finishes there has to be able
to say so. Termspace reads the sequences terminals have long agreed on:

| | |
|---|---|
| `BEL` | the bell. Marks the pane in the overview and its session in the list |
| `OSC 9`, `OSC 777` | a notification sent on purpose. Also reaches the desktop |
| `OSC 0`, `OSC 2` | the window title. Shown under the command in the overview |
| `OSC 7` | the working directory, used when saving a layout |

Nothing is drawn on the pane itself — a dot in the session list and a marked
card in the overview, and looking at the pane clears both.

The bell never reaches the desktop: bash rings it for an ambiguous tab
completion. Only `OSC 9` and `OSC 777` do, and only if you were not watching
that pane — which is not the same as having the window open, since the other
panes are off screen and the sessions behind this one keep running.
`Ctrl` + `,` → Desktop notifications turns it off.
