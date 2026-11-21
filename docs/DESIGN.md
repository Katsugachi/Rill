# Design

The first version of the interface was rejected as generic: gradients, glass panels, pills and chips,
and status text that contradicted itself. This is the record of the rework, the rules it follows, and
the critique rounds that produced it.

## Rules

1. **The artwork is the colour.** The home screen shows a short looping clip, one for light mode and
   one for dark, with no tint or overlay. Everything else is neutral, so the two never compete. A chat
   is plain paper, and the clip pauses there. Under `prefers-reduced-motion` a still frame is shown instead.
2. **Solid surfaces only.** No blur, gradients, glows or drop shadows. Light mode is the default:
   paper white with neutral greys (`--bg`, `--side`, `--surface`, `--raised`, `--line`). Dark mode is
   the same structure in neutral grey (`#212121`), chosen in Settings.
3. **One typeface, five sizes, each with one job.** Inter at 12px (counts, times, labels), 14px
   (controls and lists), 16px (messages and the input), 18px (titles) and 32px (the greeting, the only
   large text). Weight (400, 500, 600) and three text tones do the rest.
4. **Spacing on an 8px grid.** Gaps are 4, 8, 12, 16, 24 or 32px. Controls are 32px high. Text inside
   a block shares one left edge.
5. **One accent, for state.** The orange of the sunset (`#e0623c`, lighter in dark mode) marks only
   things that are happening now: loading, a running step, the streaming cursor, focus. At rest the
   interface has no accent. Primary buttons are ink on paper instead.
6. **Few controls.** The composer has two: attach and send. Options that are rarely changed live in
   Settings. Panels open when asked for, not on their own.
7. **One object per job.** The home screen is a single block: greeting, model state, composer and
   starter tasks. Model state has one home (the sidebar foot). A tool call is one line; its detail opens on demand.
8. **Numbers on the right.** Counts, times and progress (`2/5`, `4m`) are right-aligned in tabular
   figures, so lists scan in a straight line.
9. **Text over the artwork must stay readable.** Nothing is typeset directly on the artwork. Text
   sits on a solid surface.
10. **Motion explains a change.** 120ms for hover and press, 220ms for things that enter, open or
   move. One easing curve. `prefers-reduced-motion` turns it off.

## What keeps people oriented

- **Progress is visible and honest.** A plan shows one bar segment per step, so length and position
  read at a glance, with the count beside it. The same count appears in the sidebar and the composer while it runs.
- **Your message never disappears.** If the model is not loaded, the message is shown straight away
  with download progress under it, and the answer follows.
- **The next action is always one thing.** "Load model", "Resume", "Stop": each state offers a single
  clear control.
- **Starter tasks are real examples** of the four things Rill does (plan, maths, research, checklist), and
  they disappear once you type.

## Critique rounds

**Round 0 (the rejected version).** Gradient text and buttons, a glowing logo, glass blur everywhere,
a tint that dulled the artwork, a serif and a sans mixed, suggestion cards, a status pill reading
"Model not loaded" beside "Demo mode", a cursor left behind after a reply finished, and toasts that
covered the composer hint.

**Round 1.** Rebuilt on the rules above. Problems found in screenshots: the greeting, set directly on
the artwork, was hard to read against the halftone; hidden "Copy" rows still took up space and made
message spacing uneven; the lone "Steps" button was misaligned with the card text.
Fixes: the greeting moved into the composer block; the meta row no longer takes space; alignment corrected.

**Round 2.** Status bugs: a plan card read "Not started" while its summary was being written, and the
composer still said `Plan 0/4` at `4/4`. Both now refresh at every change of state. Added tests for the
status text and for leftover streaming indicators.

**Round 3.** Phones: creating a plan opened the panel over the chat with no way to see why. On phones
the plan card in the thread is now enough and the panel opens only when asked; it is full width, with a
scrim. The download size shown now matches what the browser reports.

**Round 4 (owner feedback).** The navy interface did not sit well with the artwork. Switched to paper
white by default with a neutral grey dark mode. The artwork now appears on the home screen only. Removed:
the "Think first" toggle in the composer, the panel button, the chat title bar, token statistics under
replies, the labels on starter tasks, one starter task, and the panel opening by itself when a plan is made.

**Round 5 (owner feedback).** Spacing was uneven and every line of text was close to the same size.
Introduced the five-step type scale and the 8px grid above, and aligned the greeting, input and starter
tasks to one left edge. Removed the line describing the model on the home screen: download progress
now appears only while a load is running or after one fails. Removed the logo.

**Round 6 (owner feedback).** The landscape image was replaced by two owner-supplied clips: clouds for
light mode and a lighthouse at night for dark mode. Black borders in the files were cropped, and the
clips were re-encoded to 0.9 MB and 1.8 MB. The dark clip is anchored right so the lighthouse stays in frame.

## Known gaps

- Not yet reviewed with a screen reader.
- Only tested in Chromium at 1440px and 390px wide.
- No logo yet.
- The lighthouse clip does not loop seamlessly: the beam and the ship jump when it restarts.
