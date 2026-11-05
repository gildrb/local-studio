# Local patches to gpui-pre 0.3.9

This is the crates.io release of `gpui-pre` 0.3.9, vendored unchanged except
for the patches below. `apps/native/Cargo.toml` points `[patch.crates-io]` here.

Local Studio's native app needs both patches to apply Settings → Appearance the
way the web app does.

## Per-window content zoom (`Window::zoom`, `Window::set_zoom`)

The web app's interface font size sets the root font size, so the whole
rem-based UI scales together, like page zoom. The native app lays out in
logical pixels, so the window itself has to zoom.

- `src/window.rs`: a `zoom` field (default `1.0`) and
  `Window::zoom()` / `Window::set_zoom(f32)`.
  - `scale_factor` is the platform scale × zoom, so drawing stays at device
    resolution.
  - `viewport_size` and `mouse_position` are the platform values ÷ zoom
    (`apply_platform_geometry`, also used by `bounds_changed`).
  - `dispatch_event` maps every platform input position (and pixel scroll
    deltas) ÷ zoom first (`unzoom_input`).
  - Values handed to or read from the platform in window points are converted:
    `visual_viewport_bounds` and `fully_visible_bounds` insets ÷ zoom;
    `show_window_menu` and `set_input_region` × zoom.
  - `zoom_bounds` / `unzoom_bounds` helpers.
- `src/platform.rs`: `PlatformInputHandler::{bounds_for_range,
selected_bounds, element_bounds}` return bounds × zoom, and
  `character_index_for_point` takes its point ÷ zoom, so IME candidate windows
  and text-input queries use platform points.

Accessibility bounds already go through `scale_factor`, so they need no change.

## Glyph stem darkening switch (`App::set_glyph_dilation`)

The web app's "Font smoothing" setting toggles `-webkit-font-smoothing:
antialiased`. When it is off, macOS applies CoreGraphics' color-dependent stem
darkening. gpui-pre emulates that darkening as glyph "dilation", but only
honors the `AppleFontSmoothing` user default, which it reads once.

- `src/app.rs`: a shared `glyph_dilation` cell (default `true`) and
  `App::set_glyph_dilation(bool)` / `App::glyph_dilation()`. Changing it
  refreshes every window.
- `src/window.rs`: `paint_glyph` uses dilation `0` while the cell is `false`.
  Dilation is part of the glyph atlas key, so the change takes effect on the
  next frame.

## Font family aliases (`TextSystem::set_font_family_alias`)

The web app's font settings override the `--font-sans`, `--font-mono` and
`--font-composer` CSS variables, and every element styled with them follows.
The native app names its fonts by alias family names instead, and points each
alias at the user's family list followed by the default family.

- `src/text_system.rs`: a `family_aliases` map and
  `TextSystem::set_font_family_alias(alias, families)`. `font_id` resolves an
  aliased family to the first family in its list that loads, like a CSS
  `font-family` list. Changing an alias clears the font id cache and advances
  the font generation, as `add_fonts` does, so line layouts are rebuilt.

## Paint recording (`Window::set_paint_recording`, `Window::recorded_paints`)

The theme editor's Inspect picker and usage spotlight need to know which theme
color each painted region uses. The web app probes CSS variables; the native
app records the solid colors each frame paints and maps them back to tokens.

- `src/window.rs`: `paint_recording` plus double-buffered `recording_paints` /
  `recorded_paints`. While on, `paint_quad` records solid fills and borders,
  `paint_glyph` records glyph runs (adjacent same-color glyphs on a line merge),
  and `paint_svg` records icons, each with its bounds, content-masked bounds,
  final color and corner radius (`RecordedPaint`, `RecordedPaintKind`). `draw`
  publishes the list when the frame finishes. Off by default, so nothing is
  recorded or allocated unless the editor asks.
- `Window::paint_recording_mark()` returns how many paints the current frame
  has recorded so far, so an overlay painted last (the editor's inspector) can
  exclude its own paints from the list it hit-tests.

## Paint-time scale (`Window::with_paint_scale`)

The web app's SnapShot capture card arrives with `starting:scale-95`, a CSS
`scale` transform that eases from 95% to 100%. gpui has no transform for a
subtree, so the card scales its painted output instead.

- `src/scene.rs`: a `paint_scales` stack on `Scene` (`push_paint_scale` /
  `pop_paint_scale`). `insert_primitive` maps each new primitive through the
  stack, innermost first: bounds, vertices and content masks scale around the
  origin, and corner radii, border widths, shadow blur and underline thickness
  scale by the factor. A scaled mask is intersected with the mask that was
  current when the scale was pushed, so ancestor clipping stays unscaled.
  Sprites keep their atlas tiles and are drawn into the scaled bounds.
  `replay` inserts recorded primitives without mapping them again.
- `src/window.rs`: `Window::with_paint_scale(origin, factor, f)` pushes the
  scale (in device pixels) for everything `f` paints. Layout and hit testing are
  unchanged.

## Backdrop blur (`Styled::backdrop_blur`, `Styled::backdrop_saturate`)

The web app's glass surfaces (`surface-glass`, `alert-glass`, `dialog-glass`,
`dropdown-glass`, the composer, the mini-player pill, toasts) use CSS
`backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturation))` on
top of a translucent background. The native app needs the same primitive in the
renderer, not a CPU approximation.

- `src/scene.rs`: a `BackdropBlur` primitive (`order`, bounds, content mask,
  corner radii, `blur_radius` in device pixels, `saturate`), carried in
  `Scene::backdrop_blurs`, a new `Primitive::BackdropBlur` /
  `PrimitiveKind::BackdropBlur` (ordered first within a draw order, so the
  element's own background and content painted in the same explicit layer stay
  above the blur) and `PrimitiveBatch::BackdropBlurs`. Batches sort and merge
  like the other primitives, so a frame with no blur primitives costs nothing.
- `src/window.rs`: `Window::paint_backdrop_blur(bounds, corner_radii,
blur_radius, saturate)` inserts the primitive at the current stacking context;
  `blur_radius` follows the CSS convention (twice the Gaussian sigma).
- `src/style.rs`: `Style::backdrop_blur` / `Style::backdrop_saturate` fields;
  `Style::paint` paints the filter before drop shadows and the background, so
  the element's own translucent fill lands on top of the blurred backdrop.
- `src/styled.rs`: `Styled::backdrop_blur(px)` and `Styled::backdrop_saturate(f)`.
- Metal renderer (`gpui-pre-apple`, vendored at `vendor/gpui-pre-apple`): when a
  `BackdropBlurs` batch is reached, the main render pass ends, a blit copies the
  batch's padded region (union bounds outset by the 3-sigma kernel support) from
  the drawable into a reusable source texture, a `backdrop_blur_downsample`
  pass blurs horizontally into a temp texture at 1x/2x/4x downsample (chosen
  from sigma), and a `backdrop_blur_composite` pass blurs vertically and
  composites into the drawable with the quad SDF rounded-corner coverage,
  straight-alpha blending and the CSS `saturate()` luma mix. Both intermediate
  textures are viewport-sized, recreated on resize; the linear clamp-to-edge
  sampler is created once. Shaders live in `shaders.metal`; `build.rs` now
  prefers the patched `../gpui-pre` sibling for the cbindgen shader header
  (falling back to the bundled snapshot) and exports the new types.
- wgpu renderer (`gpui-pre-wgpu`, vendored at `vendor/gpui-pre-wgpu`): the same
  algorithm with WGSL entry points `vs/fs_blur_downsample` and
  `vs/fs_blur_composite` in `shaders_storage.wgsl` (the WebGL instance-transport
  shader variant has no blur entry points, and the blur pipelines are `None`
  there, so `backdrop_blur` degrades to no-op instead of failing). The frame is
  copied with `copy_texture_to_texture`; region/kernel parameters and per
  primitive composite instances go through the regular instance-buffer
  transport, prepared per batch in `prepare_blur_batches`. `render_frame` now
  takes the target `Texture` (it creates its own view) so the copy can read it.
  Standalone checks gain `[patch.crates-io]`/`[dev-dependencies]` entries so
  `cargo check`/the naga WGSL validation tests run against the patched
  `gpui-pre`; both are ignored when the crate builds as a dependency.
