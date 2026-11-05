// Storage-buffer instance transport. Concatenated after `shaders.wgsl` on backends
// with storage buffer support; `shaders_webgl.wgsl` is the WebGL2 counterpart that
// decodes the same records from a texture instead.
//
// All buffers share `@group(1) @binding(0)` because each pipeline binds only the
// buffer its own entry points read.

@group(1) @binding(0) var<storage, read> b_quads: array<Quad>;
@group(1) @binding(0) var<storage, read> b_shadows: array<Shadow>;
@group(1) @binding(0) var<storage, read> b_path_vertices: array<PathRasterizationVertex>;
@group(1) @binding(0) var<storage, read> b_path_sprites: array<PathSprite>;
@group(1) @binding(0) var<storage, read> b_underlines: array<Underline>;
@group(1) @binding(0) var<storage, read> b_mono_sprites: array<MonochromeSprite>;
@group(1) @binding(0) var<storage, read> b_poly_sprites: array<PolychromeSprite>;

fn load_quad(instance_id: u32) -> Quad {
    return b_quads[instance_id];
}

fn load_shadow(instance_id: u32) -> Shadow {
    return b_shadows[instance_id];
}

fn load_path_vertex(vertex_id: u32) -> PathRasterizationVertex {
    return b_path_vertices[vertex_id];
}

fn load_path_sprite(instance_id: u32) -> PathSprite {
    return b_path_sprites[instance_id];
}

fn load_underline(instance_id: u32) -> Underline {
    return b_underlines[instance_id];
}

fn load_mono_sprite(instance_id: u32) -> MonochromeSprite {
    return b_mono_sprites[instance_id];
}

fn load_poly_sprite(instance_id: u32) -> PolychromeSprite {
    return b_poly_sprites[instance_id];
}

// --- backdrop blur --- //

struct BlurRegion {
    region_origin: vec2<f32>,
    ds_size: vec2<f32>,
    downsample_factor: f32,
    spacing: f32,
    sigma: f32,
    pad: f32,
}

struct BlurComposite {
    bounds: Bounds,
    content_mask: Bounds,
    corner_radii: Corners,
    region_origin: vec2<f32>,
    inv_downsample_factor: f32,
    spacing: f32,
    sigma: f32,
    saturation: f32,
}

@group(1) @binding(0) var<storage, read> b_blur_regions: array<BlurRegion>;
@group(1) @binding(0) var<storage, read> b_blur_composites: array<BlurComposite>;

fn load_blur_region(instance_id: u32) -> BlurRegion {
    return b_blur_regions[instance_id];
}

fn load_blur_composite(instance_id: u32) -> BlurComposite {
    return b_blur_composites[instance_id];
}

struct BlurVarying {
    @builtin(position) position: vec4<f32>,
    @location(0) @interpolate(flat) blur_id: u32,
    @location(1) clip_distances: vec4<f32>,
}

// Gaussian blur along one axis. `position` and `spacing` are in texel units;
// `direction` selects the pass (horizontal first, then vertical).
fn blur_along(position: vec2<f32>, direction: vec2<f32>, spacing: f32, sigma: f32) -> vec4<f32> {
    let texel_size = 1.0 / vec2<f32>(textureDimensions(t_sprite, 0));
    var color = textureSample(t_sprite, s_sprite, position * texel_size);
    var total = 1.0;
    for (var i: u32 = 1u; i < 4u; i = i + 1u) {
        let x = f32(i) * spacing;
        let weight = exp(-(x * x) / (2.0 * sigma * sigma));
        let offset = direction * x;
        color = color + textureSample(t_sprite, s_sprite, (position + offset) * texel_size) * weight;
        color = color + textureSample(t_sprite, s_sprite, (position - offset) * texel_size) * weight;
        total = total + 2.0 * weight;
    }
    return color / total;
}

@vertex
fn vs_blur_downsample(@builtin(vertex_index) vertex_id: u32, @builtin(instance_index) instance_id: u32) -> BlurVarying {
    let unit_vertex = vec2<f32>(f32(vertex_id & 1u), 0.5 * f32(vertex_id & 2u));
    let region = load_blur_region(instance_id);
    var out: BlurVarying;
    // Output pixels are written at the region origin at reduced resolution.
    out.position = to_device_position(unit_vertex, Bounds(region.region_origin, region.ds_size));
    out.blur_id = instance_id;
    out.clip_distances = vec4<f32>(1.0);
    return out;
}

@fragment
fn fs_blur_downsample(input: BlurVarying) -> @location(0) vec4<f32> {
    let region = load_blur_region(input.blur_id);
    // Map the output pixel back to the framebuffer pixels it represents.
    let source_position = region.region_origin +
        (input.position.xy - region.region_origin) * region.downsample_factor;
    return blur_along(source_position, vec2<f32>(1.0, 0.0), region.spacing, region.sigma);
}

@vertex
fn vs_blur_composite(@builtin(vertex_index) vertex_id: u32, @builtin(instance_index) instance_id: u32) -> BlurVarying {
    let unit_vertex = vec2<f32>(f32(vertex_id & 1u), 0.5 * f32(vertex_id & 2u));
    let composite = load_blur_composite(instance_id);
    var out: BlurVarying;
    out.position = to_device_position(unit_vertex, composite.bounds);
    out.blur_id = instance_id;
    out.clip_distances = distance_from_clip_rect(unit_vertex, composite.bounds, composite.content_mask);
    return out;
}

@fragment
fn fs_blur_composite(input: BlurVarying) -> @location(0) vec4<f32> {
    // Alpha clip, since we don't have `clip_distance`.
    if (any(input.clip_distances < vec4<f32>(0.0))) {
        return vec4<f32>(0.0);
    }

    let composite = load_blur_composite(input.blur_id);
    let temp_position = composite.region_origin +
        (input.position.xy - composite.region_origin) * composite.inv_downsample_factor;
    var color = blur_along(temp_position, vec2<f32>(0.0, 1.0), composite.spacing, composite.sigma);
    // CSS `saturate()`: interpolate between luminance and the color.
    let luma = dot(color.rgb, vec3<f32>(0.213, 0.715, 0.072));
    color = vec4<f32>(luma + (color.rgb - luma) * composite.saturation, color.a);
    // Antialiased coverage of the rounded bounds, like the backdrop's own clip.
    let coverage = saturate(0.5 - quad_sdf(input.position.xy, composite.bounds, composite.corner_radii));
    return blend_color(color, coverage);
}
