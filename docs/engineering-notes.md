# Engineering Notes

Code comments only go as far as "what is here and why". The path that led to that
conclusion — what symptom showed up where, and why the obvious approach wasn't it —
lives here. Put it in comments and everyone reading the code has to walk through
someone else's incident report every time.

The design decisions themselves are owned by `specs/2026-08-06-termspace-design.md`.
This document is the record of the incidents that produced those decisions.

---

## Rendering

**A frozen-then-thawed pane stayed an empty box.** A freshly attached WebGL renderer
starts from a blank screen and doesn't draw what's already in the buffer until the next
output arrives. That's why a pane you scrolled back to looked dead. Do a full redraw
once on attach and on thaw.

**A pane that had never been visible stayed awake forever.** The freeze candidates were
computed by subtracting from "what was visible last time". Subtract from the full set of
panes instead, so panes right after startup get caught too.

**The focused pane froze and typing produced nothing visible.** A pane that receives
keys is never frozen, even off screen. Type into a frozen one and the output piles up in
a queue — not on screen, not in selection or copy either.

**Holding `Alt+2` left panes white.** The session-jump key repeats about thirty times a
second, and each repeat is a full session switch. Two things then went wrong at once, and
only the pair produced the white pane.

The renderer budget was written as if `MAX_WEBGL_CONTEXTS` belonged to a session. It
belongs to the page. The session being left never gave its contexts back: a hidden host
is `display: none`, so its `ResizeObserver` never fires again and nothing else asked. The
arriving session then took up to twelve more on top. `setActive(false)` now hands them
back on the spot, and `main.ts` deactivates every other session before activating the
arriving one, so the release always precedes the acquire.

That alone made it worse. With the accounting fixed, each switch released and re-took a
dozen contexts, so sixty presses meant 341 creations in two seconds — the browser reclaims
lazily and cannot keep up, and past its own cap it force-releases the oldest. xterm never
sees that as a context loss, so the pane keeps a canvas nobody draws to: white, and white
for good. Giving a context back is now immediate, taking one waits 120ms for the view to
hold still. The same burst produces eleven creations, the same as switching once, and the
pane still draws through the DOM renderer while it waits.

Both halves are needed: the accounting alone overruns the browser's reclaim, and the
delay alone still lets two sessions hold contexts at the same time.

**A pane still went white on an ordinary switch, and on scroll.** Not held keys this time:
one switch, or a scroll that brought a pane in, and a pane already on screen turned white
with a small sad-face icon in its corner — Chromium's drawing for a canvas whose context is
lost. The ledger was right about live contexts and wrong about the browser's count.
`WebglAddon.dispose()` removes the canvas but never loses the context, and Chromium keeps
counting it against its per-page cap until garbage collection gets to it. Every pane
leaving the screen left one behind, so the page held twelve live contexts and a trail of
dead ones, the browser saw more than sixteen, and it force-lost the oldest live one — the
addon then waited for `webglcontextrestored`, which arrived once the garbage was
collected, and redrew. Detaching now loses the context explicitly through
`WEBGL_lose_context`, which frees the slot at once. Eight switches between a fourteen-pane
and a nine-pane session, screencast at device pixels: 13 white frames of 87 before, 0 of
83 after; the `webglcontextrestored` events on live canvases went from a dozen to none.
The self-check now also counts context loss on canvases still in the document during the
held-key burst, though at that check's size (eight contexts) the browser never evicts, so
it guards the invariant rather than reproduces the bug.

**A long scroll ended on a blank frame.** Fling to the far end of a wide canvas, or hold
Alt+→ across it, and the panes that arrived went dark for one frame and drew again; a
column at a time never did. The visible band is the viewport plus one viewport each side,
and a pane leaving the band gave its WebGL renderer back at once. Coming back it drew
through the DOM renderer until the view held still, then took a fresh WebGL renderer —
which starts empty and paints on the next animation frame, so the DOM rows had already
gone and the canvas had nothing yet: the blank frame. Four end-to-end round trips over an
eight-column, 5600px canvas cost 40 renderer attaches. The budget now keeps the renderer
of a pane out of view while there is room under the cap, and gives idle ones up least
recently seen first only when a visible pane needs the slot. Same four round trips: 0
attaches after the first sight of each pane. Freezing is unchanged — an idle renderer
sits on a frozen pane doing nothing — so the two axes stay separate as before.
**Thin strokes shimmered while the canvas glided.** The track moves by `translateX`, and
the offset was rounded to whole CSS pixels. At this machine's 1.67× scale a whole CSS
pixel is one and two-thirds device pixels, so two frames in three landed the composited
layers between device pixels and the compositor resampled them — box-drawing lines and
underscores swam, and a glide that stopped on such a frame stayed soft at rest. The offset
is now rounded in device pixels (`snapToDevicePixels`), which at 1× and 2× is what it was.
Screencast of the same six-notch fling, variance of the Laplacian over the pane area:
moving frames averaged 128 before and 143 after; the frame at rest went from 127 to 148.

**Then every switch stuttered.** Handing the contexts back on the way out is a rule about
the *cap*, and it was paying for the cap on every switch whether or not the page was
anywhere near it: two sessions of five panes need ten of the twelve slots, and each swap
between them tore down and rebuilt them all — 35 to 55ms per pair of panes, landing
120ms after the new session had already appeared, so the jerk arrived after the switch
looked finished.

The cap is now a page-wide ledger (`contextHolders` in `session-runtime`) rather than a
rule each session applies to itself. A session off screen keeps what it holds and asks
for nothing; the arriving one evicts from inactive sessions, least recently seen first,
and only for the slots it is actually short. Under the cap a switch now costs nothing at
all. The self-check still holds the key down, but the invariant it asserts moved with the
design: the page total stays under the cap, and the session left behind kept its contexts.

**A pane sat several columns short of its own right edge.** Opening a session left a band
of empty background down the right of every pane — a couple of hundred pixels in a wide
column. Clicking or resizing anything made it snap to the full width, which is what made
it look like a paint bug rather than a size one.

It was a size one. The WebGL renderer rounds the cell to whole device pixels and the DOM
renderer does not: with a 14px font measuring 8.4px per cell, one says 8.4 and the other
says 8. Panes are fitted on mount, when only the DOM renderer exists, and the WebGL
context arrives 120ms later — after the fit, and with a narrower cell. Nothing refitted,
so the grid stayed at the DOM renderer's column count and drew it in WebGL's smaller
cells. Six columns of pane went unused, and the pty was told the wrong width to match.

The measurement itself was never wrong, which is what made this slow to find:
`charSizeService.width` reads the same 8.4 throughout. Only `dimensions.css.cell.width`
moves, and only when the renderer is swapped. Attaching and detaching a renderer now
refits, since they are the two moments the cell changes size under a grid nobody resized.

**Chromium throttles timers in background windows.** pty output keeps arriving while
you're looking at another window, and on return the backlog gets drawn all at once.
Inertial scrolling stalls on top of that. `backgroundThrottling: false`.

**xterm 6 does not use the browser scrollbar.** It draws its own scrollbar, taken from
VS Code, so `::-webkit-scrollbar` rules are ignored wholesale. The rules were written
down and believed to have thinned the bar, when in fact they did nothing. The width comes
from the `overviewRuler` option instead; the sheet keeps only the corner radius and the
visibility rules described below.

**Every pane left a dead band right of the grid.** The fit addon subtracts
`overviewRuler.width` for the scrollbar and reads 0 as "use the default 14", so it cannot
be told to reserve nothing; the grid ended up 14px short of a bar drawn far thinner. The
option still sizes the drawn bar, so it stays (at the token's 3px) and `applySize` counts
the columns itself from the host width and the cell width, through the same private seam
the addon reads — the bar overlays the last cells instead, leaving only the sub-cell
remainder any terminal leaves. The option costs a second canvas per
terminal for the ruler that stays empty, so the self-check, which counts canvases to count
WebGL contexts, excludes that one by class. The ruler also draws a 1px border whether or
not it has marks, which showed as a light line down every pane's right edge until
`overviewRulerBorder` was set to the terminal background. A bar over text should not be
there when nothing is moving, and xterm reveals it on mouseover with no option to stop it,
so the pane shows it only while a scroll is running and outranks those rules with
`!important`.

**Switching palettes exposed a colored band inside panes.** The body's inner padding was
painted in the panel background color, so as soon as the terminal background differed it
looked like a black border inside the rounded corners. Removing the padding would press
the text against the edge, so the pane background was matched to the terminal background.

**Every glyph edge carried a colour fringe.** On Linux an opaque xterm canvas gets the
browser's subpixel (LCD) text antialiasing, and next to Ghostty with the same font and
palette the strokes read tinted and soft. `allowTransparency: true` makes the WebGL
glyph atlas greyscale — that is what the option changes here, not see-through panes.
Alone it left strokes thinner still (xterm.js #4212 is open on this), so on Linux the
app also asks Chromium for full hinting at whole-pixel positions
(`font-render-hinting=full`, `disable-font-subpixel-positioning`); mac and Windows draw
text through their own engines and ignore both. Measured against Ghostty by the share
of fully lit pixels per glyph, Latin lands within 1–2 points and Hangul about 9 behind.
Panes past the WebGL cap draw through the DOM renderer, which the atlas option does not
reach; with the switches on, a DOM pane and a WebGL pane came out identical at device
pixels (edge chroma spread 0.076 vs 0.078), and `bench:render` showed no frame-time
difference from the opaque build across 6, 12 and 18 streaming panes. The `subpixel`
value of the `textRendering` setting is the previous look, untouched, for eyes used to
it — a restart applies it, since the atlas mode is fixed when a terminal opens and the
hinting is a command-line switch.

**Thirteen streaming panes ran at eight frames a second.** Not this change: `main` does
the same. Twelve WebGL panes streaming `yes` hold above 100 fps; the thirteenth falls to
the DOM renderer, whose refresh rebuilds a row of elements per line and stalls the
renderer thread for about 100 ms each time — the focused pane and the keyboard stall
with it. Rare in practice, since panes past the cap mostly sit at a prompt, but a build
log or agent streaming out there drags the whole window. Left as is for now; the
cheapest fix would coalesce a DOM pane's output through the freeze queue and flush it a
few times a second.

---

## Layout

**The sidebar and the canvas swapped sides.** The grid cells were left to DOM order, and
a single `append` put the terminal into the 220px cell. Set `grid-column` explicitly.
Every element existed and every class matched, so DOM queries couldn't catch it — which
is why a screenshot was needed.

**There was 12px between the sidebar and the first column.** The grid `gap` and the
canvas's inner padding were adding up. Set the grid gap to 0, and lay a fixed strip
(`.canvas-gutter`) on the canvas's left so 6px holds even while scrolling.

**Mid-scroll, panes ran right up to the window frame.** The gutter existed only on the
left, and the canvas's own trailing inset only shows at the far end of the scroll range;
anywhere in between, the track was clipped by the canvas's own right edge. A mirrored
band (`.canvas-gutter--right`) makes the seam the same on both sides at any offset.

**The last column had no width handle.** The vertical rule (below the last pane there's
no one to take space from) had been copied straight to the horizontal axis. Column
widths are absolute px and the canvas is horizontally infinite, so the last column's
right edge is a perfectly good handle. A session with a single column — a freshly
created empty session is exactly that — had no handle at all.

**Capping column width with `Math.min` made the widen key shrink the screen.**
Vertically, sibling panes hit their minimum height and things stop by themselves; but
widths are absolute px with nothing to push against, so the cap has to be explicit.
Simply clamping, though, drags a column already over the cap down to it on the first
keystroke. This isn't a rare hand-written-session case: any window narrower than the
default width (640px) triggers it — the self-check window (638px) hit it and produced
`700 → 626px`. Widening the window back doesn't restore the clipped width, so a value
the user wrote down silently disappears. Set the ceiling to `max(cap, current width)`:
**the cap only prevents growing further and never touches the width you have.** The
minimum already behaves that way (shrinking at 240px does nothing) — having both ends
follow the same rule also means one explanation covers both.

**`Alt+S` dragged the canvas along.** "It became visible again" (scroll to the focused
pane) and "only the width changed" (just remeasure) were handled by one function.
Collapsing the sidebar is the latter but was calling the former. Split off `relayout()`.

**The wheel didn't work over the title bar.** A `-webkit-app-region: drag` region is
hit-tested by the window manager as the title bar, so mouse events never reach the
renderer. With a listener on the whole bar, it responded only over the `no-drag` cluster
of buttons, making the active area feel patchy. Synthetic events skip that hit test, so
the self-check passed — the kind of bug only visible to the user with a real mouse. Put
one `no-drag` block around the title and left the areas on either side as drag surface.

**The gap between the title bar and panes looked like twice 6px.** The box-to-box gap
was exactly 6px, but the slack above and below the controls inside the bar stacked on
top, reading as 12px. Bottom-align the bar and push the slack upward so the controls sit
against the bar's lower edge.

**The horizontal scrollbar touched the pane outlines.** A 5px bar inside a 6px bottom
inset can't help but touch. Widened only the canvas's bottom inset to 12px to give the
bar its own room (`CANVAS_BOTTOM`). When the bar later thinned to 3px the inset stayed,
and the 4px above the bar became 6px over 3px below — a gap that read as a gap. The
inset is 10px now: 4px clear above, 3px of bar, 3px of floor, as the proportions were.

**A failed pointer capture killed the drag.** Capture is only a convenience so events
keep coming when the cursor leaves the window, but the exception propagated and the drag
never even started.

---

**A dark bar appeared in the middle of the window and stayed.** Reported 2026-08-15:
typing in a pane cut off by the window's right edge, and once the text passed that
edge an 8px strip in the canvas colour stood down the full height at about a third of
the window in, over the terminal text, and no scroll or focus move removed it. Pixel
sampling of the screenshot put the strip at exactly `.canvas-gutter--right`, only 318px
left of where it belonged. The canvas host was `overflow: hidden`, which clips but is
still a scroll container the browser may scroll on its own: xterm parks its textarea
on the cursor cell, and when the caret leaves the visible box Chromium reveals it by
scrolling the nearest scrollable ancestor — the host — while the app's own scroll model
(a transform on the track) knew nothing of it, so nothing put it back. `overflow: clip`
clips without being scrollable at all, by the browser or by script. The self-check
now writes `scrollLeft = 300` to the host and expects to read back 0.

## Input

**Copy was completely broken.** WebGL draws to a canvas, so `window.getSelection()` is
always empty. Switched to xterm's selection API + the Electron clipboard.

**Paste executed multiple lines.** Writing straight to the pty skips bracketed paste
wrapping, so the shell runs a command at every newline. Go through `term.paste()`.

**The canvas intercepted vertical wheel over a terminal.** The entire scrollback became
unreachable. The canvas takes the event only for a horizontal component, Shift, or
outside a panel.

**Vertical scrolling felt different from horizontal.** xterm's `smoothScrollDuration` is
a tween that plays one input over a fixed time, so repeated flicks don't build speed and
nothing glides after you let go. Two different physics running on the same screen,
one per direction. `wheel-physics` is shared by both.

**`Alt+S` did nothing when no session existed.** Sidebar, settings, and fullscreen were
handled by `session-runtime`, but those three keys make sense without a session. Nobody
was listening. The kind of bug you can never see if you only ever press it after opening
a session.

**A black box sat on top of the character being composed.** xterm covers a composing
character with an overlay drawn as `#FFF` on `#000`, regardless of palette. On a themed
terminal a black block appears on the line you're typing, and its edge looks like a line
cutting across the row above. The box width is measured in single cells, but a Hangul
syllable is two cells wide, so the glyph can stick out of the box. Make it use the
terminal's own background and foreground, and put the underline on the text rather than
the box (`text-decoration`). The position itself was correct — verified by checking that
the cursor row and the overlay row matched.

**A white line flickered above the composing character.** That line was the cursor.
Confirmed by measuring a screenshot at the pixel level: the line's color was `#E6E0C2`,
exactly the palette's `cursor` value — the glyph and underline are the foreground
`#DDD8BB`, so the only thing the terminal paints in the cursor color is the cursor. The
width was exactly one cell too: the left cell of the overlay's two.

The composition overlay draws that cell in place of the terminal, so it should fully
cover the cursor beneath — but it misses by 1px. The overlay is a DOM box positioned at
fractional CSS coordinates; the cursor is raster on a WebGL canvas, snapped to integer
device pixels. At a fractional scale factor (166.67% on this machine) the two coordinate
systems drift by about 1px, and the cursor flickers through the gap. Cover further on
all sides with a 1px ring in the background color (`box-shadow`).

I got the hypothesis wrong three times, and all three were about *why it misaligns* —
overlay size mismatch, the helper textarea's caret (`opacity: 0`, so never visible in
the first place), drift accumulating with row number (visible at the very top of the
screen, so ruled out). By contrast, *what is visible* never wavered once the color
pinned it down. So the fix was hung on the established fact, not on root-causing:
wherever the rounding happens, it's enough for the overlay to cover the cell without
remainder. It's also why Ghostty doesn't have this symptom — it's native, so there is no
DOM-on-top-of-canvas structure at all.

(First written as: "this bug cannot be caught by automated tests — the self-check can't
produce composition events." That turned out to be half wrong. Composition *events* are
ordinary DOM events, driven today by both `ime-double-commit.dom.test.ts` and the
self-check's five-ordering IME check; what cannot be scripted is a real IME producing
them.)

**Hangul double input.** Separate from the white line above. It was path (1) below, and
it is now guarded in `ime-double-commit`. The earlier reading — that only one copy
reaches the pty, so it had to be a drawing artifact — was wrong; the `cat` test simply
never hit the trigger. Driving a real xterm from a DOM test settled it: a keydown
carrying a real key code mid-composition sends the syllable, and the `compositionend`
behind it sends the same range a second time. `CompositionHelper`'s own duplicate guard
reads `_dataAlreadySent`, which only `_handleAnyTextareaChanges` ever fills, so on this
path it is empty and the guard passes. The fix swallows that one `compositionend` in the
capture phase, before xterm's listener runs — the text has already gone out, so the
second send is the one to drop. What stayed true from the first investigation is that
composition events are not untestable: they are ordinary DOM events, and only the *IME*
producing them cannot be scripted.

The original notes, kept because the reasoning is what mattered:

The position calculation of
`xterm .composition-view` is the prime suspect — xterm's own CSS carries
`/* TODO: Composition position got messed up somewhere */`. It's intermittent and I
haven't pinned down reproduction conditions. Also noted, without acting on it, that this
machine's IME setup is inconsistent: `GTK_IM_MODULE` and `XMODIFIERS` point at fcitx
while what's actually running is ibus.

Reading the code, I confirmed two paths that could double-send. Both are inside xterm.
Path (1) is the one that fired.
(1) If a keydown during composition arrives with a real key code instead of keyCode 229,
`CompositionHelper.keydown` sends immediately via `_finalizeComposition(false)`, and the
following `compositionend` calls `_finalizeComposition(true)` again with no guard.
(2) If the composition commit also arrives as an `input` event of type `insertText`,
`_inputEvent` sends once more, independently of the `compositionend` send. Either way,
what shape the events take during composition depends on the IME↔Chromium path, and the
fcitx/ibus mismatch above is a candidate for the intermittency. To pin down which path
it is, `ime-trace` was added: per pane it records the textarea's keydown, composition*,
and input events plus the data going out to the pty in a ring buffer, and if the same
Hangul goes out twice within 150ms it dumps the whole flow to the console
(`[ime-trace]`). In the installed build, open the console via "개발자 도구" (developer
tools) in the command menu to see it.

---

## Sessions and Settings

**Stepping between sessions could not use the arrow keys.** With `Alt+1`..`Alt+9` as the
only way across, full screen made you remember numbers. The obvious chord for "previous /
next session" is `Ctrl+Alt+Shift+Arrow`, and it never arrives: GNOME binds it to
`move-to-workspace-up/down`, so the window manager takes the key before Chromium sees it.
`Alt+Arrow`, `Alt+Shift+Arrow` and `Ctrl+Alt+Arrow` are already the app's own, which
leaves the arrows spent. `Alt+Shift+<` / `Alt+Shift+>` is what shipped — free at every
level, and the same physical keys under a Hangul layout because chords match on `code`.
The ring holds only what is running, so the key never spawns a shell.

**pane ids started from 0 in every session.** `pty-host` uses paneId as a global key and
sessions stay alive across switches, so A's output was drawn in B and B's keys went into
A's pty.

**A hidden session responded to shortcuts.** Each session has its own window listener,
and `stopPropagation` cannot block other listeners on the same node (that's
`stopImmediatePropagation`'s job). Each one decides via `setActive` whether it's its
turn.

**`cwd: ~` parsed as null in YAML.** An unquoted `~` is null. The session started in
some arbitrary place instead of home.

**Korean fonts were missing from the list wholesale.** fontconfig's spacing has four
levels (proportional 0 / dual 90 / mono 100 / charcell 110), but only `:spacing=100` was
accepted. A font that layers Hangul on top of a Latin monospace inevitably has two
widths and is marked dual. Accept 90 and up, but since icon and emoji fonts come along
with it, add `:lang=en` as well.

**A session opened behind the window while settings were up.** The settings view covers
only the canvas; the sidebar stays alongside. The result was a state where the screen
showed settings but the keys went to the new session.

**"Save this layout" wrote a second file instead of overwriting.** There was one
save command, and it went through the dialog, which derives a file name from the
display name typed into it. That is the right rule for a session being named for
the first time and the wrong one for a session that already has a file: a
session's id is its file name and its `name:` is a separate field, and every
hand-written session has the two disagree. Saving `work.yaml` whose name is
`작업 공간` created `작업-공간.yaml` and left the original untouched — with no
warning, because the overwrite warning fires on the derived name being taken, and
it wasn't.

Splitting the command in two fixed it. **Save** writes by id, which the renderer
already holds as the key its runtime is filed under, so nothing is derived and
the mismatch cannot arise. **Save as…** keeps the dialog and its derivation,
where deriving is what the user is asking for. The dialog had always contained
both behaviours — it turned into an overwrite when the name was taken — but that
is a rule you have to already know to use, and it was reachable only from inside
the `☰` menu.

**The save is unprompted, and that is affordable only because of the `.bak`.**
`saveSession` copies the previous generation aside before writing. Without it, a
bar button one click from a hand-written session would be a way to lose it.

**Nothing on screen changes when a layout is saved**, so the toast has to carry
what happened *and* when it takes effect — the file is read at startup, and the
running session is not re-arranged to match. A dirty marker on the row was the
alternative and was dropped: it needs a comparison against the file on every
resize to stay honest, to say something the toast can say once.

**Where the terminal palettes come from.** The color values themselves are close to
facts, but a curated collection can be protected as a compilation. They were taken from
each creator's own repository, not from aggregator sites, and the licenses were checked.
The values were not copied by eye — each repository's own exported terminal palette was
carried over, because being off by one cell while still calling it "that theme" is
exactly the failure mode.

**Two sessions created in the same tick sorted alphabetically instead of by write
order.** `applyOrder` falls back to creation time for any id not yet in the order file,
and breaks a tie on that time with `id.localeCompare`. The tie-break has to be
deterministic for two reasons at once: `readdir` order is not stable across
filesystems, and the very first listing writes whatever order it resolves into the
order file — an unstable tie-break would freeze in whichever arrangement happened to
win that race, not necessarily the one just shown.

The visible cost is a first-run one: session files that share a birthtime (a batch
copy of a dotfiles session directory onto a new machine) start alphabetical rather
than in write order, until the user drags a row — the first drag replaces the
fallback with a real order and the alphabetical start is gone for good.

It also broke the self-check before it was ever seen by a user. `checkHeldSessionJump`
holds `Alt+2` and expects the "verify" session at row 2, but three fixtures written in
one tick can share a birthtime on a fast filesystem, and `selfcheck-broken` sorts
before `spare` alphabetically — enough to bump verify off row 2. The fixture id was
renamed with a leading "z" so the alphabetical fallback agrees with the write order
instead of fighting it.

**The pane count beside a session never moved.** It was read from the session's YAML,
which a split never touches, so the number stayed at whatever the file said however many
panes were on screen. It comes from the running session now, and the self-check splits a
pane and reads the row back — the only way to tell a live count from a stale one.

**A narrow session list spent its width on the `Alt+N` chord instead of names.** The
chord is hover-only, but it still held its column while invisible: every name ellipsised
against a gap showing nothing. It is out of flow now, and a row with nothing left beside
the count drops it. Only a real layout shows this, since happy-dom measures every box as
zero, so the assertion lives in the self-check rather than a DOM test.

---

## Self-Check

**Nothing can be measured while the window is occluded.** Chromium stops compositing an
occluded window, so rAF never fires and inertia doesn't run. Wayland ignores clipboard
writes from a client that isn't the active window. Values in that state are
"unmeasurable", not "broken", and writing both with the same word makes the check
untrustworthy. The verdict comes from the number of frames arriving over 200ms, not from
`document.hasFocus()` (keyboard focus) — even with the window pinned on top and fully
visible, `hasFocus()` returns false.

**Screenshots can be stale too.** On an occluded window, `capturePage` returns the last
frame that was drawn. In the DOM the window sat there perfectly intact, while the image
showed a screen from seconds earlier.

**Events fired at a parent don't travel down to children.** The vertical scroll listener
was on `.terminal-host`, but the check was firing at `.pane__body`. It touched nothing
and reported "doesn't move".

**`term.clear()` leaves the line the cursor is on.** It only empties the scrollback, so
characters that `cat` echoed back without a newline keep accumulating. Count without
knowing that, and a value growing 1, 2, 3, 4 reads as "it goes in twice".

**`press()` only filled `code`.** Shortcut matching looks at `code` (physical key
position), but the windows listening for Esc look at `event.key`. The window didn't
close, the settings screen didn't open, and the failure came out as the unrelated
"there is no on/off button".

**The handle element is replaced during a drag.** Even one pixel of progress triggers a
relayout, so the reference grabbed at the start is detached from the document and later
events never reach the listener. A real mouse keeps reaching it thanks to pointer
capture; synthetic events don't.

**Putting the check folder under `/tmp` breaks the trash.** It's usually a different
filesystem from home, so "delete session" runs under conditions unlike real use and
produces failures that don't exist. Moved it under home.

**An element being in the DOM does not mean it's visible on screen.** If the stacking
order or the size is off, every query passes while the user sees nothing. The save
dialog actually ended up that way.

**An open menu swallows every keydown at the window capture phase.** While open, the
command-menu calls `stopPropagation` in a capture listener so shortcuts don't leak into
the session. Leaving the split dropdown open for a screenshot and moving on to the next
check, the synthetic Enter/Esc fired at an input had its capture descent cut off at the
window and never reached the target. Events fired at the window itself run through all
listeners on that same node, so only half of them died — which is what made it a maze.
What a check opens, the check closes.

**Misreading screenshots — without knowing the dpr you measure proportions wrong.** The
overview card width looked different from the model, but in fact the Wayland scale
(1.71) had been assumed to be 2. The unfamiliar vertical line crossing a card wasn't a
bug either — it was the right edge of the viewport marker. Attaching a
`getBoundingClientRect` comparison check before judging by eye is faster —
overviewCardsAsStyled and overviewProportional exist for exactly that.

---

## Build and Environment

**`@xterm/addon-canvas` has no xterm 6-compatible release.** The fallback is xterm's
built-in DOM renderer.

**electron-vite 5.0.0 does not support vite 8.** Pinned vite 7.3.6.

**AppArmor blocks unprivileged user namespaces.** The `chrome-sandbox` inside an
AppImage sits on squashfs and cannot be setuid. Append `--no-sandbox` only when
detected, and point at the proper fix (registering a profile).

**A running AppImage cannot be overwritten (ETXTBSY).** Write next to it and rename
into place: the running process holds on to the old file and the next launch gets the
new one.

**EPIPE killed main.** If the terminal that launched the app closes first, the pipe
breaks, and Electron puts the exception thrown by later writes into an error dialog.
It only means there's nowhere left to write logs, so pass over it silently.

**Running `npm run dev` with the installed build open did nothing.** The single-instance
lock lives in Electron's `userData` (`~/.config/termspace`), and the side that fails to
get the lock ends with `app.quit()`. No window, no message, exit 0 — from the terminal
it's indistinguishable from the build producing nothing. Leave a one-line reason before
exiting, and have the lock holder bring its own window to the front on
`second-instance`. When two copies must run side by side, move `XDG_CONFIG_HOME` —
`userData` lives under it, so the lock and settings follow along.

**A saved session recorded 300 characters of `ssh` where the user typed four.** The
capture reads `/proc/<tpgid>/cmdline`, and an alias is text the shell substitutes
before exec — by the time a process exists, the alias name has never existed
anywhere the kernel can see. Worse, the alias body was a compound command, so
`/proc` showed only the one component in the foreground and the surrounding
`echo` banners vanished from the session entirely.

Reverse-mapping the expansion back to an alias was tried on paper and dropped: the
captured argv is not a prefix of the alias body but a member of it, so matching
needs a shell parser plus tilde and variable expansion — and it still cannot tell
someone who typed the alias from someone who typed the expansion. It fails
silently, which is worse than the ugly value.

Reconstructing the line from keystrokes fails too, and fails exactly where it is
needed: ↑ and Tab put the resulting text in the shell's buffer without it ever
passing through the app.

So the shell is asked. A `DEBUG` trap reads `history 1`, which holds the line as
submitted, before alias expansion. `$BASH_COMMAND` is the trap's obvious-looking
field and is the wrong one — it carries the expansion. The trap also fires once
per component of a compound command, so the first emit for a given `$HISTCMD` is
the only real one.

The hook goes in a file under the app's own config directory and the user adds one
line to `~/.bashrc` themselves. Editing someone's rc file is how `conda init` and
the nvm installer became cautionary tales, and a copy-paste line costs the user
one minute, once.

**The hook reported another shell's command, and one save wrote it into every
pane.** A `DEBUG` trap fires for `PROMPT_COMMAND`'s own commands as well as for
submitted lines, and `$HISTCMD` is identical in both. Gating on `$HISTCMD` — the
obvious way to collapse a compound alias, and correct in a shell with no prompt
framework — therefore let the `PROMPT_COMMAND` firing through and suppressed the
real one. What that firing sees in `history 1` is the *previous* entry, and on a
fresh shell that is the last line of the shared `~/.bash_history`: the same value
in every pane. Saving a layout then stamped one unrelated command over a
hand-written session.

The fix is what bash-preexec does: `PROMPT_COMMAND` raises a flag and the first
trap firing afterwards is the submitted line. The flag is down while
`PROMPT_COMMAND` itself runs, and goes down again after the first emit, so a
compound alias still reports once.

Two things let this ship. The hook had no automated test, because it is bash and
the rest of the module is not — `shell-integration.test.ts` now runs it under a
real pty, with a seeded shared history and a `PROMPT_COMMAND`, which are exactly
the conditions the bug needed. And a save could destroy a file with no way back;
`saveSession` now keeps one generation as `<id>.yaml.bak`.

**A self-check that cannot measure must not wait forever.** `animationRuns()`
resolved only from inside a `requestAnimationFrame` callback, so an occluded
window — one the user's own app happens to cover — never settled it and the whole
run reported nothing at all after four minutes. It now has a deadline, and the
deadline answers "unmeasurable" rather than passing on the frames gathered so
far: a throttled window collects enough to satisfy a count long before it can
time a glide. Checks that only fail for want of frames re-ask before calling it a
failure.

**Every frame of a resize showed an empty terminal.** Dragging a window edge, or
a pane's gap, made the panes shimmer — fast, and no worse with twenty panes than
with one, which already ruled out cost.

The resize path resized the xterm grids on every tick: 104 `ResizeObserver`
ticks over one drag produced 371 `term.resize()` calls, 3.8ms of the frame on
average and 21ms at the peak. But the flicker was not the time. xterm's WebGL
renderer answers a resize with `_refreshCharAtlas()` and `_clearModel(false)`,
and only repaints on the next animation frame — so a grid resized once per frame
is empty every other frame.

Pixels and grids now settle on different clocks. The boxes follow the pointer
live; the grids follow 90ms after the size stops moving, which drops the same
drag to 26 resizes. It is the debounce `PTY_RESIZE_DEBOUNCE_MS` already applied
one layer down, moved up to where the redraw actually happens. Nothing shows
through the gap while the grid lags: `.panel` clips and `.pane` is painted in the
terminal's own background.

**Alt+P widened a column off the right of the screen.** The column grew, the far
half went past the viewport border, and reading it meant scrolling. The obvious
reading — grow leftward from the right edge instead — is not available: a
column's x is the sum of the widths before it, so "grow leftward" can only mean
taking width off the neighbours, and absolute widths are the property the whole
canvas is built on.

The scroll follows the pane instead, which from the viewer's side looks exactly
like growing leftward from the right edge. `scrollToReveal` already anchors a
pane's right edge to the viewport's, and `applyResize` now calls it; nothing in
the layout moved. Drags are deliberately left out — the canvas sliding under a
held pointer is worse than the clipping it would fix.

The same widening seen from the other side is not a bug. Dragging the seam
between two columns widens the one on its left and pushes the right-hand column
along, whole, at its own width; every handle belongs to the column on its left
(`renderHandles`). Coming from tmux or a tiling editor, where a seam trades
width between its two sides, that reads as the right-hand column shrinking. It
has not: scroll right and it is untouched.

**The bottom pane of a column could not be resized from the keyboard.**
`resizePane` moved the seam *below* the pane, and the last pane in a column has
none, so Alt+I and Alt+O were dead keys there — the self-check knew it and moved
focus up to avoid the case. Mouse drags never hit it because a seam handle
belongs to the pane above it.

The fix reads `dy` the way `resizeColumn` already reads `dx`: what the pane
gains, not which way a seam moves. A column widens wherever it sits; a pane now
grows wherever it sits, borrowing the seam above when there is nothing below.
The clamping maths is symmetric, so only the choice of partner changed.

**A session's startup command echoed once above its own prompt.** Every pane
opened by a session file drew the command bare on line one, then a prompt with
the same command below it. The line was the tty's own echo: the command reached
the shell while its rc file was still running, so the kernel echoed it in
canonical mode, and readline echoed it again when it finally read the buffered
line.

The trigger was our shell integration. `pendingCommand` waits for a quiet
`PROMPT_SETTLE_MS` after the pty's first output, on the theory that the quiet
moment is a finished prompt. The hook's `OSC 1173;A` is now the first thing a
pty says — measured at +61ms, with the prompt 111ms behind it — and it is
stripped before the terminal ever sees it. An invisible byte armed the timer,
the timer fired mid-startup, and the shell had not yet turned echo off. The
settle timer now arms only on output that would actually be drawn.

**A drag could not widen the last column at all.** Its right edge sits at the
end of the canvas, so at full scroll the handle lands about 3px inside the
viewport border (`CANVAS_EDGE` 6, half a `PANE_GAP`, half of `HANDLE_HIT`).
Pushing right moved the cursor those 3px and then the screen stopped it;
`clientX` stopped changing, the delta went to zero, and the column held still.
Shrinking worked the whole time, which is what made it read as a broken key
rather than a wall. Unmaximising the window only moves the wall further out.
The width cap was never the cause — the gesture cannot reach it.

The fix gives the gesture somewhere to go: held inside 24px of the border, each
frame widens the column by 8px and scrolls the canvas by the same 8px, so the
handle stays under a pointer that is no longer moving. The two numbers being
equal is what makes it work — widening lengthens the canvas by exactly the
distance the scroll consumes, so the loop makes its own room and cannot outrun
the canvas. It stops when the column stops changing width, which is the only
thing keeping the canvas from sliding on past the cap.

This reverses the note above about keeping drags away from scrolling. That was
about movement nobody asked for. Pushing into the border is the request, and it
is the same answer a file manager gives. Arming happens on the first move, never
on the press, so grabbing a handle that already sits at the border does nothing
until you push.

Only the right border has a zone. Shrinking runs into `MIN_COLUMN_WIDTH` long
before it runs out of screen, so a symmetric left-hand zone would never fire.

**The self-check for it failed twice before it was measuring the right thing.**
First it jumped the pointer from the handle to the border in one event, and that
single delta widened the column to the cap before any frame ran — the loop then
correctly refused, and the check read `held == reached`. Then, once it scrolled
to the end instead, it left the canvas parked there; the panes the later checks
read were off screen and frozen, which surfaced as a renderer budget failure two
checks away. A check that moves the canvas has to put it back.

**Making the keymap editable meant deleting the keymap.** `resolveAction` was a
ladder of modifier tests — `if (altKey && shiftKey && !ctrlKey)` and so on — and
there is no way to rebind a condition. It became one lookup from a chord string
to an action id, over a table the settings screen edits. The 39 existing tests
were the safety net: they call `resolveAction` with one argument, so the
bindings parameter defaults to `DEFAULT_BINDINGS` and every one of them still
asserts the shipped behaviour. Not one had to change.

The nine session jumps are one row, not nine. `Alt+1`..`Alt+9` normalize to a
single code, `Digit#`, before the lookup, and the index comes from the digit
that was actually pressed. Nine separate rows would allow `Alt+1` and `Ctrl+4`
to coexist, which is a state nobody wants and every screen would have to explain.

Chords match on `code`, so a rebound key survives a layout change — but `code`
is also why the chip has to be formatted rather than printed: `Alt+KeyU` means
nothing to a reader, `Alt+U` does.

**Nothing is refused.** Binding `Ctrl+C` to copy takes SIGINT away from every
shell in the app, and the tab says so under the row — then saves it. The rule
that would block it cannot know whether this user's shell uses that key, and a
settings screen that argues with you about your own keyboard is worse than one
that lets you break it and tells you how.

**Only the difference is written.** `keybindings.yaml` holds rows that differ
from the defaults and nothing else; back to stock, the file is deleted. A file
listing every row would pin a user to the 1.7 defaults forever — a chord
improved in a later version would never reach anyone who had opened the tab once.

Two things drifted the moment keys became editable: the `☰` menu's hints and the
sidebar's `Alt+N` badges were hardcoded strings in the string catalog. They now
come from the live bindings, which is also why `t.appBar.splitDown` became a
function of the chord. The self-check found the button by that title, so it now
finds it by a data attribute instead.

**Hangul could not be typed into the shortcut search.** The field filtered on
every `input` event by redrawing the panel — and the redraw built a new
`<input>`, so the element the IME was composing into vanished mid-syllable.
Latin text never showed it: one keystroke is one finished character, and the
value was copied into the replacement. Hangul needs several keystrokes to
assemble one syllable, and the composition died on the first of them.

Now the search field and the bar around it are built once and outlive every
redraw; only the list is replaced. Filtering also waits for `compositionend`
rather than acting on half-built jamo, which would otherwise blank the list on
every keystroke and only settle when the syllable landed.

The self-check drives a real composition sequence at the field and asserts the
node is the same one afterwards. Asserting the text survived is not enough — the
old code copied the value into the replacement, so that alone passed while the
bug was live.

## The Icon

**The first icon had no source.** Six PNGs went into `build/` and nothing else, so
changing one colour meant redrawing all of it. `build/icon.svg` is now the source and
`scripts/make-icons.mjs` (`npm run icons`) produces the PNGs; the packager and the
launcher installer both read only the output.

Each size is rendered from the vector rather than downscaled from one large raster.
Shrinking 512 to 32 smears the tile's corner radius into a grey fringe.

**The tile gradient came out as visible steps.** `#1e1e1e` to `#050505` is 25 tonal
values, and stretched over 228px each one lands as a 9px band. Counter-intuitively a
wider range bands less, but nothing subtle enough to want here survives it. The tile is
flat, and the light lives on the marks instead.

**A gradient running edge to edge across the ring reads as a bevel, not a relief.**
One direction of falloff is a flat plane tilted toward the light. A convex surface
catches the light along its crest and loses it toward both edges, so the ramp has to
be dark-bright-dark, with the last stop lifting the shaded edge again — the bounce
that keeps glazed white from going dead there.

**The planet's outline needed a radial gradient.** Its thickness runs outward from the
centre at every point on the circle, and that is the one axis no linear gradient can
follow the whole way round — laying a narrow bright stroke over a wider dim one only
ever produced a crest, never a section. The stroke spans radius 51 to 61, so every stop
lives in the last sixth of the gradient. A radial gradient knows nothing about where
the light is, so the far side is darkened by a linear pass over the top of it.

**The gap and the shadow say different things.** A hard black gap where the ring
crosses the planet says which form is on top; it cannot say how far above, and alone it
reads as cut paper. Soft shadows say the distance but not the order. Both are drawn,
and the gap's width sets the shadows': at 14px it swallows the first 7px of anything
underneath, so the contact blur went to 7 and the cast shadow to an 11px offset to
clear it.

## Settings

**The language cannot be applied without a restart, so the screen says so.** Every
view builds its strings when it is constructed and holds the finished text, so
there is no later moment at which a new catalogue would take. Making it live
would mean a rebuild path through the bar, the sidebar, every menu and both
sheets — a lot of machinery for a setting nobody changes twice.

That leaves getting the choice to the renderer before its first module runs. It
cannot come over IPC: `t` is resolved at import time, long before a reply could
land. It cannot come from the preload either, which is sandboxed and has no
filesystem. It arrives in the page URL, the same route the self-check's scope
already took, which means main reads the settings file synchronously — the only
reason `loadSettingsSync` exists.

**Interface size scales the chrome and nothing else.** `zoom` on the whole page
was the obvious move and is wrong here: `getBoundingClientRect()` comes back in
the zoomed space while a mouse event's `clientX` does not, so every drag, the
column resize and the menu placement would be off by the scale factor. The
canvas is also the one place where scaling would change meaning rather than
appearance — a column is an absolute pixel count, and 640px has to be 640px at
any interface size.

So the scale multiplies the UI type tokens and `--ctl-h`, and stops there.
`--gap`, `--edge` and `--hit` are canvas geometry mirrored in
`layout-geometry.ts` and stay fixed. The self-check asserts both halves: the
title bar's height grows, and the canvas track's width does not.

**A self-check that finds a control by position breaks when a row is added.**
The palette and font checks took the first and second `.settings__select` on the
sheet. Adding the language row above them handed the palette's assertions a list
of locale codes, and the failure read as a missing theme rather than a moved
control. They are found by `data-setting` now — the same fix the shortcut hints
needed when the menu started printing live chords.

**Terminal signals are read in main, not through xterm's parser.** xterm.js has
`onBell` and `registerOscHandler`, and using them would have been two lines. But
a pane off screen is frozen and its output sits in a queue in the renderer
(`FROZEN_QUEUE_LIMIT`), so a bell would only arrive once the pane was drawn —
and the off-screen pane is the entire reason the bell matters here. The scan
happens where the pty is read instead, on the same chunk the shell-integration
scanner has already been through.

That forced a different shape. `shell-integration-osc` owns its sequences and
strips them out; these belong to the terminal at large and xterm has to receive
them byte for byte, so `terminal-signals` never touches the data path. It
watches a chunk and forwards it unchanged, keeping the parse state in a carry
rather than holding output back for a terminator — a scanner that buffers is a
scanner that can stall a pane.

**The bell does not reach the desktop, and that is deliberate.** bash rings it
for an ambiguous tab completion, so forwarding every bell would have meant a
desktop notification for pressing Tab twice. Only `OSC 9` and `OSC 777` are
forwarded — those are a program deciding it has something to say — and only
while the window is unfocused. The bell is shown inside the app, where it costs
nothing to ignore.

**OSC 7 also removed a Linux-only path.** `cwdOf` read `/proc/<pid>/cwd`, which
is both platform-bound and blind to a subshell. A shell that reports OSC 7 now
answers for itself and `/proc` is the fallback — still needed, since nothing is
reported before the first prompt.

**A notification asked the wrong question.** OSC 9 and OSC 777 were forwarded to
the desktop only while `win.isFocused()` was false, which is what every other
terminal does and is wrong here. Panes sit off screen by design and the sessions
behind the current one keep running, so a focused window is no evidence that
anyone saw *this* pane. The common case in this app — window open, looking at
another pane — silently swallowed every notification.

The first diagnosis was also wrong and worth recording. A probe showed a window
opened with `showInactive()` reporting `isFocused() === true`, which read as
Wayland breaking Electron's focus tracking. It is not: Wayland ignores
`showInactive` and hands the new window real focus, so the value was right.
Opening a second window to steal focus produced a proper `blur` and
`isFocused() === false`. Focus tracking was never the fault.

The renderer now names the one pane being watched — focused, and only while its
session is on screen — and main sends a notification unless the pane that rang
is that one. `setActive` runs before `currentName` is updated in `showOnly`, so
the report is made twice on a session switch; the first one is for the session
being left.

**A mark that outlived being looked at.** The sidebar dot was cleared in one
place only: the focus change inside `setLayout`. That covers a pane rung beside
the one being used, and misses the case the mark exists for. A session off
screen rings in the pane that already holds its focus, so arriving there clicks
nothing, no focus change happens, and the dot stayed yellow over a pane in plain
sight. `setActive(true)` now clears the focused pane the same way — arriving is
a look. `noteAttention` already refuses to mark the focused pane of an active
session, so the two rules meet rather than overlap.

**Wayland refuses to raise a window that asks.** Clicking a notification has to
bring the window forward, and every polite way of doing that — `show()`,
`focus()`, `moveTop()`, `setAlwaysOnTop(true)` then off again — was tried and
silently ignored under Wayland's focus-stealing prevention. The compositor only
trusts a *new* surface with focus. So `activateWindow` unmaps the window and
maps it again: `hide()`, then `show()` + `focus()` after 60ms. The delay exists
because an immediate remap can reuse the surface the compositor has not yet
dropped, which lands back in the untrusted case; 60ms was the shortest interval
that raised the window reliably on this machine. Other platforms take the plain
`show()`/`focus()` path — the workaround is the exception, not the rule.
The remap is skipped when the window already has focus: clicking a notification
for a pane in the focused window otherwise unmapped and remapped it, which reads
as a flash. With focus already in hand there is no prevention left to beat, so
only the pane travel runs.
