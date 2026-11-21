# Design

The first version of the interface was rejected as generic: gradients, glass panels, pills and chips,
and status text that contradicted itself. This is the record of the rework, the rules it follows, and
the critique rounds that produced it.

## Rules

1. **The artwork is the colour.** It is shown as supplied: no tint, no grain overlay, no motion.
   The interface around it is flat ink, so the two never compete.
2. **Solid surfaces only.** No blur, gradients, glows or drop shadows. Depth comes from four ink
   tones (`--bg`, `--surface`, `--raised`, `--line`) taken from the navy of the artwork's sky. The
   darkest is `#0f1226`, not black.
3. **One typeface.** Inter at 13px for the interface and 15px for reading. Hierarchy comes from
   weight (400, 500, 600) and three text tones, not from a second font or large sizes.
4. **One accent, for state.** The peach of the sunset (`#f9a593`) marks only things that are
   happening now: loading, a running step, the streaming cursor, focus. At rest the interface has no accent.
   Primary buttons are light-on-ink instead.
5. **One object per job.** The home screen is a single block: greeting, model state, composer and
   starter tasks. Model state has one home (the sidebar foot). A tool call is one line; its detail opens on demand.
6. **Numbers on the right.** Counts, times and progress (`2/5`, `4m`) are right-aligned in tabular
   figures, so lists scan in a straight line.
7. **Text over the artwork must stay readable.** Nothing is typeset directly on the artwork. Text
   sits on a solid surface.
8. **Motion explains a change.** 120ms for hover and press, 220ms for things that enter, open or
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

## Known gaps

- Not yet reviewed with a screen reader.
- Only tested in Chromium at 1440px and 390px wide.
- The logo is a flat first draft.
