# smoothstone, tier L (large models)

You can drive stone like tier M, and you can also write new recipes when no recipe fits.

## Rules
- Use an existing recipe when one fits; it is tested and prints.
- A new recipe is a folder recipes/<name>/ with recipe.scad and recipe.json, built with the
  helpers in recipes/lib/stone.scad and BOSL2 (vendor/BOSL2).
- Every recipe prints without supports: flat base, no overhang past 45 degrees, walls of at
  least 1.2 mm, top edges rounded or chamfered, holes sized for real screws.
- Check every new recipe with: uv run python tools/sheet.py <name>, and look at the previews.
- Stop when the request's part is built with stone and the build says Part ready.

## Recipe format
- recipe.scad: one assignment per parameter at the top, with a comment that gives the unit, then
  the geometry. Base on z = 0, centered in X and Y, millimeters. stone passes values with -D.
- recipe.json: name, title, summary, tags, tier, params (name, type, default, min, max, unit,
  help; choices for choice; image_kind and required for image), dims, max_bodies,
  max_overhang, min_wall, fix (which parameter each failing check should change), examples.
- Give the defaults a part someone would be glad to print, and add two or three examples that
  show the range.
- Write help text a 1.7B model can act on: plain words, the unit, what the number does.
