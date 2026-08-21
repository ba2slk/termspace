# Checklist

Unit tests cover pure logic only. Whether a pty spawns, keys register, the canvas glides,
or off-screen panes freeze can only be known by launching the app.

**Anything that can be judged automatically is not left to human eyes.** Eye checks don't
reproduce, and in an environment where no window can be shown they can't happen at all. So
the renderer drives its own UI and judges the results itself.

```bash
npm test           # unit tests for the pure modules
npm run verify:app # launch the app and drive the UI in a self-check
```

Past run results are not recorded in this document. The moment they're written down they
start going stale, and the worst state is a table that says "pass" while the code has
changed. **Results always come from running the commands above.**

## What `npm run verify:app` checks

Each item has caught a real bug once. The parenthetical is the problem caught at the time;
the detailed incident records are in `engineering-notes.md`.

UI copy is asserted through the shared catalog (`src/shared/ui-strings.ts`), never as a
literal string, so every check passes under either locale. This document quotes the
English copy.

**Sessions and pty**
- The session list appears and sessions open (a session whose display name differed from
  its file name wouldn't open)
- All panes are created and terminals attach
- pty output reaches every pane (opening two sessions collided ids, and one shell never
  came up)
- **Saving from the bar rewrites the session's own file and adds none** (the save derived
  a file name from the display name, so any session whose `name:` differed from its file
  name — every hand-written one — was copied into a second file instead of overwritten.
  The seeded session in this check has the two disagree on purpose; with matching names
  the bug is invisible)

**When there are no sessions at all**
- **`Alt+S` works before any session is opened** (the sidebar, settings, and fullscreen
  keys were handled by the session, so on the first screen nobody was listening. Press it
  after opening a session and you'll never see the bug — which is why this check must come
  first)

**Navigation**
- `Alt`+arrows move focus
- The canvas scrolls to follow focus
- **→→ then ←← returns to the starting point** (spec §4.5, invariant 6)
- Vertical movement works

**Focus indication**
- The focused pane's border color differs from the rest
- The ring is present
- The other panes get a dimming overlay; the focused pane does not

**Spacing**
- The gaps between panes match the `--gap` token, measured between drawn boxes
  (`gapsMatch`), and the app-bar-to-pane and sidebar-to-pane distances are recorded
- Panes fit vertically inside the window (`panesFitVertically`) — the one number that
  catches a layout overflowing its own screen

**Overview map (`Alt+M`)**
- One card appears per pane, and the map fits within the screen
- The viewport indicator rectangle is present
- **The indicator rectangle is clearly thicker than the card borders, and has no fill**
  (a 1px line got lost among the card borders and was invisible; the computed border
  thickness snaps to dpr, so it's measured relative to the cards, not against a constant.
  The fill it once had brightened the cards under it, which read as a second highlight)
- **Rolling the wheel while the map is open moves the indicator in real time** (the
  canvas kept scrolling underneath the map while the marker was a snapshot, staying put
  and lying)
- Selection starts at the focused pane and moves with the arrow keys
- `Esc` closes without moving; `Enter` jumps to the selected pane
- **On a session too wide to fit, cards stop shrinking at `MIN_OVERVIEW_COLUMN_PX`** (a
  session of many columns scaled every card down to an unreadable sliver. The check adds
  columns until the fit scale would break the floor, then measures the narrowest card with
  `getBoundingClientRect`, and that the map keeps its own drawn width — flex shrank it back
  to the window, which carried the cards outside their own box)
- **The lens holds still and the strip slides under it** (the first design moved the
  selection across a still map, which read as "nothing happens" until the selection
  crossed a screen edge. Now every `→` press moves the world: the check asserts four
  presses give four moves of the map's rect while the lens's screen centre does not drift
  a pixel. Same for the wheel)
- **The wheel reaches the map at all** (the canvas claims wheel events in capture and stops
  propagation, so the map's own listener never ran and the strip sat still. The two
  listeners only meet on a real event path, so no unit test can see it)
- **The canvas behind the scrim follows the lens as the strip is scrubbed, and a cancel
  puts it back** (the map is a place to look around from, so the session moves with it
  rather than only at the end. The check baselines at the wheel event itself — the arrow
  snaps scrub too, so measuring from the opening position would pass on their work alone —
  and asserts Esc returns the canvas to where it opened)
- **Enter lands the canvas on the region the lens framed** (revealing the pane instead
  picks its own scroll and throws away the view that was chosen. The check reads the
  scroll off the canvas track's transform and compares it with what the lens was pointing
  at, both in real pixels)
- **The map re-lays-out when the viewport changes** (nothing re-rendered on a sidebar
  toggle or a window resize, so the map stayed drawn for a width that was gone. Skipped
  rather than failed when the scale floor pins the width at both sizes, which is the case
  in a small window)

**Layout editing**
- Split down / new column to the right / close pane
- **A newly created pane receives keyboard focus** (it didn't, so typing right after a
  split vanished)
- `Alt+Shift+U I O P` moves panes — swaps are measured via top coordinates, horizontal
  moves via a round trip of the left coordinate, and focus must stay on the pane
  throughout the move

**Pane zoom**
- **`Alt+Z` lays the focused pane over the visible canvas, and `Alt+Z` again puts it
  back where it was** (measured as pixels against the canvas host, insets included: the
  class saying "zoomed" was never the promise, the box is. The restore is compared with
  the rect the pane held before the zoom, since the layout behind it never changed)
- **Holding the peek modifier while zoomed shows no label from the panes
  underneath** (asked of `elementFromPoint` at each label's centre: a pane sets no
  z-index, so its label at 4 climbed the track's ladder and drew over the zoom)
- **Canvas background covers the whole visible area behind the zoomed pane** (the box
  is rounded to whole pixels and the track's transform snaps to device ones, so the
  two can disagree by a fraction and the pane behind showed through that sliver)

**Renderer budget**
- Off-screen panes freeze (a pane that had never been visible stayed awake forever)
- Frozen panes hold no WebGL context
- **The focused pane never freezes, even off screen** (it froze, and typing produced no
  visible output)
- **Holding the session-jump key leaves no white pane** (a held `Alt+2` switches session
  thirty times a second; the page ran past the browser's cap, which force-releases the
  oldest and leaves that pane blank). Checked as an invariant — the visible session is
  drawn and the page total stays within the budget
- **A switch does not throw the contexts away** (rebuilding one costs tens of
  milliseconds per pane, which made stepping between sessions stutter): the session left
  behind still holds its contexts afterwards
- **The grid fills its pane** (the WebGL renderer rounds the cell to whole device pixels
  and the DOM renderer does not, so a pane fitted before its context arrived sat several
  columns short of its own right edge). Measured in pixels: the drawn screen against the
  host's width, allowing the one column that does not fit

**Wheel scrolling**
- Measures the distance of one notch (at 1:1 a 6000px canvas took sixty rolls)
- Rolling continuously increases the distance per notch
- **Vertical wheel over a terminal is not taken by the canvas** (it was intercepted and
  scrollback was unreachable)
- **Vertical scroll inside the terminal actually moves, and rolling repeatedly goes
  farther** (checking only "the canvas didn't move" is half a check — a state where
  neither the canvas nor the terminal moves passes that check as-is)
- **The terminal's own scrollbar is there only while the text is moving** (it overlays the
  last cells, and xterm reveals it on mouseover, which reads as a bar appearing at random
  under the pointer). Measured as untouchable at rest, opaque during a scroll, and gone
  again after the linger
- A horizontal component moves the canvas
- **Rolling the wheel over the title bar moves the canvas** (synthetic events only verify
  the wiring. Whether a real mouse reaches the window-drag region is an OS hit test, so a
  human has to look)
- **The canvas scrollbar is visible even when not scrolling** (it's the only indication
  that more exists off screen, and an indicator that hides says nothing)
- The scrollbar does not extend over the sidebar — it belongs to the canvas, not the
  window
- **The scrollbar is a thumb, not a readout: dragging it moves the canvas**, the same way
  it was dragged. Grabbed a few pixels below its own top, since the hit area has to reach
  past the 5px that is drawn — nobody can aim at 5px

**Getting back to the focused pane**
- **`Alt+G` brings the focused pane fully inside the viewport** — measured with
  `getBoundingClientRect()` against the host's box, not with scroll numbers
- **Clicking the focused pane does the same** (focus moves already scroll; the pane that
  was focused already was the one case where clicking did nothing)
- **Dragging across the focused pane leaves the canvas alone** — a drag is a text
  selection, and moving the canvas under the pointer would tear it
- Skipped rather than failed when the canvas is no wider than the window, since then the
  pane can never be off screen

**Clipboard**
- IPC round trip
- **Select → `Ctrl+Shift+C` → clipboard** (WebGL draws to a canvas, so the DOM selection
  was empty. Nothing was being copied)
- **Copy on select** — does releasing the mouse button alone, with no shortcut, reach the
  clipboard

**File drop**
- A drag over the terminal is accepted, dropping a file types its quoted path, the drop
  does not navigate the page, and the app is still alive afterwards (a drop is a
  navigation event by default — one unhandled case replaces the whole renderer with the
  dropped file)

**Shell integration (automated half)**
- The hook's OSC sequences, emitted with `printf`, survive the output path and reach main
  (`shellHookKeptOutput`, `shellHookReceived`) — the sequences must pass through the
  batching untouched and must not leak onto the screen. What `printf` cannot prove — the
  real hook running from a real `~/.bashrc` — stays in the by-eye list below

**Save as session**
- The ☰ menu has the item, and the dialog appears
- The button reads "Save" for a new name and switches to "Overwrite" for an existing one
- The saved file appears in the list as a new session and the app can read it back
  (checking only that the file was written misses the "written but unreadable" state)
- **The dialog has a base-directory field** — it's the anchor for the
  whole session; without it every save falls back to `~`. The check records the filled-in
  value, not just the field's presence
- **The base directory typed in comes out as the file's `cwd`** — verified by reading the
  file back. There are paths that accept the value on screen and drop it on write, so
  looking only at the dialog passes
- **A command running at save time is written to the file** — start `sleep 300`, save,
  then check that pane's `command`. Without this, reproducing the screen loses what the
  spot was for
- **Catches the dialog existing only in the DOM while occupying no space on screen** (all
  queries pass while the user sees nothing)

**New session and the right-click menu**
- The sidebar header's `+` is present **even when the list is not empty** (the button
  used to appear only on an empty list, so with even one session there was no way to
  create another)
- Right-clicking a row and right-clicking empty space offer different commands
- The row's right-click menu has **"Edit session file"** (a way to
  hand-edit the file must exist inside the app. The sidebar is the only place that has
  the session file right in front of it)
- An empty session cannot be created under an existing name (no overwrite option is
  offered)
- Creating one opens it immediately
- **"Delete session" in the right-click menu appears in red** (it's the
  only warning before the dialog)
- **Deleting a session asks first, then moves the file to the trash** (a hand-written
  file must not vanish forever on a single click. It's only because there's a way back
  that this can live in a right-click menu)
- After deletion it disappears from the list (checking only the file misses the "deleted
  but still listed" state)
- **Even with a single column, the width handle exists and dragging it actually widens
  the column** (the vertical rule was copied to the horizontal axis, skipping the last
  column, so a fresh empty session had no handles at all)
- **A row's pane count follows splits and closes** — the sidebar is the only place that
  claims to know a session's shape without showing it
- **Dragging a session row changes the list order**, a plain click still opens a session,
  and the order survives pressing refresh and restarting the app
- **Narrowing the list spends the width on names, not on the `Alt+N` chord**: the chord
  is hover-only, and it used to hold its column even while invisible, so names ellipsised
  against a gap showing nothing. A row with no room left drops the chord instead

**Copy notification**
- Selecting by drag shows the "Copied · N chars" toast, which disappears shortly after

**Close confirmation**
- Closing is blocked while sessions are running, and the dialog shows **what would die**
  (name and pane count)
- Focus is on Cancel (the irreversible option must not be the default)
- Cancelling keeps the app running
- The window button, `☰` quit, and `Alt+F4` all arrive through the same path (blocking
  them separately misses one)

**Resizing**
- After a resize, **the size the pty knows and the size the terminal knows are equal**
  (asked directly via `stty size`). If they disagree the screen freezes broken — the
  program inside has no way to know it's wrong, so redrawing produces the same breakage
- Widening a column repeatedly **stops at the width that fills the screen**. Widths are
  absolute values on the canvas, so the neighboring column doesn't push back — without a
  cap the scroll range just grows forever
- Making the window narrower than a column and then pressing widen **does not shrink the
  column**. The cap only prevents growing further. Widening the window again must bring
  the original width back intact
- A column widened to that cap **is still whole on screen**. Columns grow to the right,
  so without the canvas following along the far half sits past the viewport border and
  has to be scrolled to. Measured against the host's own box, not the pane's classes —
  the canvas is a transform, so a clipped pane still reports a rectangle
- **The bottom pane of a column resizes too.** The seam a height change moves is the one
  below the pane, and the last one has none, so it borrows the seam above instead —
  Alt+I means "taller" wherever focus sits
- **Dragging a handle held against the right border keeps widening the column** with the
  pointer standing still. Otherwise the reach of a drag is however far the pointer can
  travel before the screen stops it, which is nothing at all for the last column. The
  column has to be below the cap first — at the cap, refusing is the correct answer, and
  the check shrinks it before looking. Reported `skipped` in an occluded window: the pull
  is one step per frame

**Korean input**
- When a composition commits, the character reaches the pty **exactly once**. IMEs differ
  in event order, so all five orderings are exercised. `cat` is running and its echo is
  counted, so the check sees what actually reached the pty, not what the app claims to
  have sent
- One of the five is the double-input bug itself: a keydown carrying a real key code
  mid-composition. Without the guard in `ime-double-commit` that ordering echoes the
  syllable twice, and the other four still pass — which is why it had gone unnoticed
- **The composition overlay is measured, not assumed**: it paints in the palette's
  colors (`imeBoxFollowsTheme`), shows the composition underline, sits on top of the
  terminal, and lands at the cursor's offset — an overlay in the wrong color or under
  the canvas passes every "does it exist" query

**Settings (`Ctrl+,`)**
- It opens
- The palette list shows all 19 built-ins, and picking one **actually changes the
  terminal colors** (a palette that's only listed but never applied is the same as not
  having it)
- A color swatch sits next to each name
- **The pane background follows the palette too** (checking only the terminal colors
  misses the inner padding staying a different color, looking like a black border inside
  the rounded corners)
- The terminal scrollbar is as thick as `--scroll-w` (xterm 6 draws its own
  scrollbar from the overviewRuler option, so the ::-webkit-scrollbar rules were being
  ignored wholesale — you have to measure the drawn width, not check that the rule
  exists)
- **The font list has something to pick** (accepting only monospace fonts dropped Korean
  fonts entirely — fontconfig marks a Latin monospace with Korean layered on as dual)
- Icon and emoji fonts are absent from the list (their glyphs are all the same width so
  they report as monospace, but rendering a terminal with them shows no characters at
  all)
- 0/1 settings appear as on/off toggles, not sliders, and clicking actually flips them
- **Custom focus border paints the focused pane's border that colour, and White puts the
  token's colour back** (the border is set through a runtime custom property with the
  token as its fallback, so reading the class or the setting proves nothing — only the
  pane's computed `border-top-color` says which of the two actually won)
- The colour field is inert unless the mode is Custom (in the other two modes it names a
  colour nothing reads)
- **Interface size grows the title bar in pixels while the canvas track's width does not
  move** (a column's width is an absolute pixel count and has to mean the same thing at
  every scale, so anything that scaled the canvas along with the chrome would be wrong,
  not merely different)
- The palette, font and interface-size controls are found by `data-setting`, not by
  their position among the selects (adding the language row put a new select first and
  silently pointed the palette checks at it)
- **Opening settings collapses any open dropdown** (a menu was floating on top of the
  settings)
- **Picking a session in the sidebar while settings is open closes settings and shows
  that session** (the settings panel covers only the canvas; the sidebar stays beside it.
  If it didn't close, the chosen session would open behind the panel — the screen
  unchanged while keystrokes go to a different session)

**Shortcuts tab (`Ctrl+,` › Shortcuts)**
- Every action has a row, and the rows are drawn with real width and height (a list that
  is present but collapsed passes every DOM query and shows nothing)
- Clicking a chord starts recording, and the next key press lands in that row
- **The rebound chord works on the live app straight away, and the old one stops working**
  (the whole point of the tab: the settings screen writes a file, but the keymap is read
  by the renderer — a saved binding that never reaches it would look right and do nothing)
- Restoring the defaults puts the original chord back
- **The action-search field is typable, keeps what was typed, and survives Hangul
  composition** — the field lives inside a screen that captures keydown for recording,
  so ordinary typing is exactly what a regression would eat first

**Scrollback search (`Ctrl+Shift+F`)**
- The search bar appears over the focused pane and the match count (`3/17`) is correct
- Highlight decorations are drawn in actual pixels
- `Enter` advances to the next match, and closing with `Esc` leaves no highlights behind
- **The bar closes when pane focus moves** (an open menu once swallowed keydown at the
  window capture phase, so the check's synthetic Enter never reached the input — which is
  why the check order closes menus first)

**App bar and menu**
- The app bar and window buttons are present
- The `☰` menu opens and has all its items
- The menu closes after running a command
- **The `☰` menu has no split item** (an action used dozens of times a day was buried
  inside a menu)

**Split controls**
- The app bar has a split button and a direction arrow
- One press of the button splits downward
- Pressing the arrow shows all four directions
- Split up and new column to the left actually work (code from the era of down/right only
  was ignoring the direction)

**Session switching**
- `Alt+1`–`Alt+9` jump directly in list order
- Pressing the current session's number again **returns to the previous session**
- `Alt+Shift+<` and `Alt+Shift+>` step to the session before or after this one, **among
  those already running**, and wrap at both ends (the point is switching without
  remembering a number; a step that opened a cold session would spawn a shell per press)
- **The session you return to shows exactly the view you left** (scrolling to the focused
  pane drags the whole canvas when you left while looking at a different pane)
- Hovering a row reveals `Alt+N` and the power button
- **Collapsing and expanding with `Alt+S` keeps the view where it was** (re-measuring was
  handled by the same function as session switching, so its "scroll to focused pane" ran
  too, dragging the canvas on every press)
- `Alt+S` opens the list and `Esc` closes it
- While the list is up, shortcuts don't leak to the session behind it (a hidden session's
  pane got closed)
- **Rolling the wheel over the sidebar previews sessions without opening them**: the
  preview appears, holds while the wheel keeps moving, the settled row's session opens,
  and the rows rolled past stay cold — a step that opened every session it passed would
  spawn a shell per notch

**Screenshots**
- While the check runs, the window is saved as PNGs (`/tmp/termspace-*.png`; the
  directory can be overridden with `VITE_SHOT_DIR`)
- A misaligned layout can't be caught by DOM queries. There was a real state where every
  element existed and every class matched, yet left and right were swapped — attaching
  the sidebar after the canvas flipped the grid cells and put the terminal in the 220px
  cell. That can only be seen.
- Whether a frozen-then-thawed pane redraws is also verified by image. A newly attached
  WebGL renderer wouldn't draw content already in the buffer on its own, leaving an empty
  box.

### When the window is occluded

What the scroll checks need is not "focus" but "frames". Chromium stops compositing
entirely when the window is covered by another, and then `requestAnimationFrame` never
fires and inertia can't be measured. So instead of a proxy (`document.hasFocus()`), the
check counts how many frames arrive over 200ms directly — using focus as a stand-in
skipped everything even with the window pinned on top and fully visible.

If no frames arrive, the wheel and spacing checks are skipped. The check pins the window
on top while running so it isn't occluded (`debug:focus`), but the window manager may
refuse.

### Window focus

The clipboard can only be measured properly while the window is active. Without focus, two
things collapse at once — Wayland ignores clipboard writes from a client that isn't the
active window, and inertial scrolling stalls on throttled timers. Then wheel, clipboard,
and spacing measurements all show FAIL at once while the code is perfectly fine.

So the check pulls the window to the front at startup and before those two checks. If it
couldn't get focus, it records that fact first as a note on the `windowFocused*` entries
and **skips the clipboard checks entirely** (`clipboardChecks` reports skipped). A FAIL
produced under unmeasurable conditions doesn't mean the app is broken — it means the
conditions weren't met, and writing both with the same word makes the check untrustworthy.

This state actually occurs when the user is using the computer alongside the check. Leave
the window alone and wait, and measurements proceed normally.

**The same goes for screenshots.** When the window isn't in front, Chromium composites no
new frames, and `capturePage` returns the last frame drawn as-is. So the screenshot shows
a screen from seconds ago — there was a real case where the DOM showed a dialog occupying
its space while the image showed nothing. In such runs, `shot_*` is annotated with
"(window occluded — frame may be stale)".

### What the check does not touch in the user's environment

- Redirects `XDG_CONFIG_HOME` to a temporary folder — no check entries slip into the
  user's session list, and the check runs under the same conditions regardless of what
  the user has configured
- Skips the single-instance lock — the check runs even while the app is in use
- Restores the clipboard to its original contents
- Never edits `~/.bashrc`. The shell-integration check emits the hook's sequences with
  `printf` instead of installing the hook, so what the real hook does is a by-eye item
  below

## Runtime environment notes

On this machine (Ubuntu, Wayland), AppArmor blocks unprivileged user namespaces
(`kernel.apparmor_restrict_unprivileged_userns = 1`), so Electron demands a setuid
`chrome-sandbox`. During development, launch with:

```bash
ELECTRON_DISABLE_SANDBOX=1 npm run dev
```

For the proper fix, see the "sandbox" section of the README.

Two harmless warnings appear in the log. Neither affects terminal behavior.

- `vaInitialize failed` — hardware video acceleration (VA-API). The terminal doesn't use
  it.
- `'--ozone-platform=wayland' is not compatible with Vulkan` — a Vulkan backend warning.
  WebGL attaches normally.

## What a human must check by eye

These can't be replaced by automated judgment. They're matters of impression, not values.

- [ ] Do the panels look like they "float" above the background — through borders and
      gaps, not brightness contrast
- [ ] Is the focus indication recognizable without being noisy — bright border + ring +
      dimming the rest. If neighboring panes are too dark to read, lower "Dim other
      panes" in `Ctrl+,`
- [ ] Is the app bar quiet — buttons faint at rest, sharpening on hover
- [ ] Does scroll acceleration feel right in the hand (default 4x; adjustable in
      `Ctrl+,`)
- [ ] Do the 16 ANSI colors avoid clashing with this background (`ls --color`,
      `git diff`, `htop`)
- [ ] Do fullscreen apps like nvim/htop survive resizing without breaking
- [ ] Does the Korean IME display (characters mid-composition) look natural

### Renaming (no self-check covers these)

- [ ] Right-click a session row › Rename session, type a new name and press Enter. The row
      and the title bar show it, and in `~/.config/termspace/sessions/` the file itself has
      moved to `<new-id>.yaml` — new `name:`, comments intact, the old file gone, and
      `<new-id>.yaml.bak` holding the file as it stood before the rename. The session keeps
      running throughout, and the name survives a restart
- [ ] Rename to a name another session already uses: nothing is written and the reason
      appears as a toast
- [ ] Type a Korean name with the IME: the Enter that ends composition only ends
      composition — a second Enter commits
- [ ] In the `Alt+M` overview, press `F2` on the selected card and type a title. Letters
      appear as typed (both English and Korean), Enter commits, and the session file has the
      new title without pressing save. Escape leaves the card as it was

### Update check (no self-check covers this)

- [ ] **Update chip.** Run the previous release (`~/Applications/Termspace.AppImage`
      before `install:local`, or an older AppImage from the releases page). Within a few
      seconds of startup the title bar's left group ends in a chip naming the new
      version. Clicking it opens that release's GitHub page in the browser. Close the
      chip: it stays hidden; Settings › Updates › Check now still reports the version and
      offers the page. Why manual: the only path is a live request to GitHub, which a
      self-check must not depend on

### Shell integration (bash and zsh)

The OSC round trip itself is automated — the check emits the hook's sequences with
`printf` (see "Shell integration (automated half)" above). What remains here is the part
that needs the line from `Ctrl+,` › Shell integration in your own rc file, which the
check will never edit — `~/.bashrc` for bash, `~/.zshrc` for zsh.

- [ ] With the line added and a session reopened, `Ctrl+,` shows the integration as
      loaded
- [ ] Run an alias, then save the layout: the session file records the alias, not what
      it expanded into
- [ ] Recall a command with ↑ or finish one with Tab, then save: the recalled line is
      what gets recorded — this is the case keystroke tracking could never cover
- [ ] `echo $?` after a failing command still prints its status. The hook runs a `DEBUG`
      trap on every command, and a careless one would clobber it
- [ ] Nothing appears on screen from the hook itself, in Termspace or in another terminal
      reading the same `~/.bashrc`
- [ ] The `DEBUG` trap items above are bash's. For zsh, run the alias and the recall
      cases against the `~/.zshrc` line and confirm the same two records

## macOS (real hardware)

CI builds the mac app and runs the unit tests, but it never opens a window. Everything
below needs a real Mac and a person in front of it. Each line says what "pass" means.

- [ ] **First launch.** The Gatekeeper path in the README works as written: the block
      appears, one of the three routes clears it, and the app opens afterwards. Pass =
      the route the tester chose leaves a launchable app
- [ ] **Cmd bindings and Option.** Focus, split, resize, overview and session switching
      fire on `Cmd`, and `Option` + a letter still types the special character in the
      shell (`Option` + `a` → `å`) instead of triggering an app action. Pass = both
      halves hold
- [ ] **Non-conventional placements.** `Cmd` + `G` (scroll back to the focused pane) and
      `Cmd` + `U` `I` `O` `P` (resize) have no mac convention behind them. Pass = each
      fires its app action and collides with nothing the tester expected that key to do
- [ ] **Trackpad scrolling.** Two-finger scroll and the inertia after lifting feel
      continuous, over the canvas and inside a terminal's scrollback. Pass = no steps,
      stalls or runaway drift in either place
- [ ] **Trackpad session drag.** A row in the session list can be dragged to a new place
      with a trackpad press-and-slide, and Ctrl + click on a row opens the context menu
      without dragging it. Pass = the order changes on release, and the Ctrl + click
      leaves the row where it was
- [ ] **Korean IME.** Composition in a terminal pane draws the in-progress syllable in
      place and commits once. Pass = what appears matches what was typed, with no
      duplicated or stranded jamo
- [ ] **Retina text.** Terminal glyphs are sharp on a Retina display, not upscaled from a
      1x buffer. Pass = crisp at the default font size, and after `Cmd` + `+` / `-`
- [ ] **Traffic lights.** Hover shows the glyphs and each button does its job; the
      buttons sit vertically centered in the title bar with roughly 6px of clearance
      before the first one. Pass = no overlap or crowding, checked at a larger interface
      scale too
- [ ] **Application menu.** Edit → Copy and Paste work in a terminal pane *and* in a
      settings text field, and `Cmd` + `Q` `W` `H` `M` quit, close, hide and minimize.
      Pass = all six behave
- [ ] **Keybindings capture.** The Shortcuts screen cannot record `Cmd` + `C` or
      `Cmd` + `V` as a chord, because the application menu owns them first. Pass = the
      limitation is confirmed as documented, with no crash and no half-recorded binding
- [ ] **zsh integration.** With the `~/.zshrc` line installed, a saved session captures
      the command that was running, and records the directory a pane was `cd`'d into
      (mac has no `/proc`, so this comes from the hook's `OSC 7`). Pass = both observed
