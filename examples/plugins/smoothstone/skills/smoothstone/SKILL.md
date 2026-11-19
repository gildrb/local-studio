---
name: smoothstone
description: Make 3D printable parts that look designed, from a text request or a picture, by choosing and setting tested parametric recipes with the stone CLI. Works for small local models (tier S), mid models (M) and large models (L), and keeps its state on disk so it survives context compaction. Use when someone asks for a printable part, an STL, a 3D model for a printer, or something to 3D print from a photo or drawing.
---

# smoothstone

The person's request is the text after `</skill>` at the end of this message. Keep it in mind
the whole time: every step below works toward that one part.

1. Run `stone status` with the bash tool.
2. Do what its NEXT line says. When NEXT shows `<what to make>`, write the person's request
   there, for example `stone new "a wall hook for a 20 mm rod"`. Never run a NEXT line that
   still has `<` and `>` in it.
3. Keep going, one stone command per bash call, until stone says the part is ready. Run every
   command in the foreground and read its output before the next one: never run stone in the
   background, and use only the bash tool (there is no wait or jobs tool).

If bash prints `stone: command not found`, tell the person to install smoothstone
(https://github.com/baney75/smoothstone), then stop. Never install it yourself.

stone turns a request into a print-ready STL. The model picks a recipe and sets its numbers;
stone builds the part with OpenSCAD, checks that it prints (watertight, one piece, flat base,
walls, overhangs, size), and keeps every step in a job folder. Every stone message ends with one
line, NEXT: <command>, and `stone status` repeats it, so a model that loses its context goes on
from where it was.

## Pick your tier and follow that card

- Tier S, about 3B parameters and under: tiers/S.md
- Tier M, about 4B to 30B: tiers/M.md
- Tier L, frontier models: tiers/L.md

Set the tier with STONE_TIER=S|M|L or `tier = "S"` in stone.toml. stone status prints the
card's rules on every call, so they come back after a compaction.

## Pictures

`stone new "<request>" --image photo.png` (or `stone image photo.png`) traces outlines for
keychains, cookie cutters and signs, and makes a height map for lithophanes and reliefs.

## Start

stone status
