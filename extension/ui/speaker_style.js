// SPDX-License-Identifier: GPL-3.0-or-later
// Pure 8-bit triangular pixel-brick geometry, hit-testing, and dB-to-brick spectrum math.

import { parse_rgba } from './settings/color.js';

export const MIN_DB = -68;
export const MAX_DB = -4;

export function db_to_unit(db, sensitivity_pct = 100) {
    const val = Number(db);
    if (!Number.isFinite(val) || val <= MIN_DB) return 0;
    const raw = (val - MIN_DB) / (MAX_DB - MIN_DB);
    const scale = Math.max(0.5, Math.min(2.0, (Number(sensitivity_pct) || 100) / 100));
    return Math.max(0, Math.min(1, raw * scale));
}

export function parse_gst_level_structure(struct_str) {
    if (typeof struct_str !== 'string' || !struct_str.startsWith('level,')) return null;
    const m = struct_str.match(/peak=\(GValueArray\)<\s*([-+0-9.eE]+)\s*(?:,\s*([-+0-9.eE]+))?/);
    if (!m) return null;
    const l = parseFloat(m[1]);
    const r = m[2] !== undefined ? parseFloat(m[2]) : l;
    return { left_db: Number.isFinite(l) ? l : MIN_DB, right_db: Number.isFinite(r) ? r : MIN_DB };
}

export function parse_gst_spectrum_structure(struct_str, cols = 8) {
    if (typeof struct_str !== 'string' || !struct_str.startsWith('spectrum,')) return null;
    const ch_matches = [...struct_str.matchAll(/<([^<>]+)>/g)];
    const extract = (s) => {
        const nums = [...s.matchAll(/\(float\)\s*([-+0-9.eE]+)/g)].map((x) => parseFloat(x[1]));
        return nums.length > 0 ? nums : null;
    };
    const channels = ch_matches.map((m) => extract(m[1])).filter(Boolean);
    if (channels.length === 0) return null;
    const ch0 = channels[0];
    const ch1 = channels.length > 1 ? channels[1] : ch0;
    return {
        left_bands: resample_bands(ch0, cols),
        right_bands: resample_bands(ch1, cols),
    };
}

export function resample_bands(bands, cols = 8) {
    const n = Math.max(4, Math.min(12, Number(cols) | 0 || 8));
    const out = new Array(n).fill(MIN_DB);
    if (!Array.isArray(bands) || bands.length === 0) return out;
    const usable = bands.length;
    for (let i = 0; i < n; i += 1) {
        const start = Math.floor((i * usable) / n);
        const end = Math.max(start + 1, Math.floor(((i + 1) * usable) / n));
        let sum = 0, count = 0;
        for (let j = start; j < end && j < usable; j += 1) {
            const v = Number(bands[j]);
            if (Number.isFinite(v)) {
                sum += v;
                count += 1;
            }
        }
        out[i] = count > 0 ? sum / count : MIN_DB;
    }
    return out;
}

export function compute_triangle_columns(size_px, col_count, is_right = false) {
    const size = Math.max(80, Math.min(240, Number(size_px) || 136));
    const cols = Math.max(4, Math.min(12, Number(col_count) || 8));
    const pad = 6;
    const inner = Math.max(24, size - pad * 2);
    const gap = Math.floor((inner - 3 * (cols - 1)) / cols) >= 4 ? 3 : 2;
    const col_w = Math.max(3, Math.floor((inner - gap * (cols - 1)) / cols));
    const brick_gap = 2;
    const brick_h = Math.max(3, Math.floor(col_w * 0.58));
    const step_h = brick_h + brick_gap;
    const max_total_bricks = Math.max(cols, Math.floor(inner / step_h));
    const layout = [];

    for (let i = 0; i < cols; i += 1) {
        const max_bricks = Math.max(2, Math.round(max_total_bricks * ((cols - i) / cols)));
        const x = is_right
            ? size - pad - (i + 1) * col_w - i * gap
            : pad + i * (col_w + gap);
        layout.push({
            band_index: i,
            x,
            width: col_w,
            brick_h,
            brick_gap,
            step_h,
            base_y: size - pad,
            max_bricks,
        });
    }
    return layout;
}

export function is_point_in_corner_triangle(local_x, local_y, size_px, is_right = false, col_count = 8) {
    const s = Math.max(80, Math.min(240, Number(size_px) || 136));
    if (local_x < 0 || local_y < 0 || local_x > s || local_y > s) return false;
    const layout = compute_triangle_columns(s, col_count, is_right);
    for (let i = 0; i < layout.length; i += 1) {
        const col = layout[i];
        if (local_x >= col.x - 3 && local_x <= col.x + col.width + 3) {
            const total_h = col.max_bricks * col.brick_h + (col.max_bricks - 1) * col.brick_gap + 8;
            const top_y = Math.max(0, col.base_y - total_h);
            return local_y >= top_y - 2 && local_y <= s;
        }
    }
    return false;
}

export function resolve_brick_rgb_unit(
    brick_idx, max_bricks, color_mode, border_color_or_rgba, is_peak_cap = false, brick_opacity_pct = 100,
) {
    const ratio = max_bricks > 1 ? brick_idx / (max_bricks - 1) : 0;
    const op_scale = Math.max(0.2, Math.min(1.0, (Number(brick_opacity_pct) || 100) / 100));
    if (color_mode === 'arcade-vu') {
        if (is_peak_cap || ratio >= 0.78) return [1.0, 0.22, 0.22, op_scale];
        if (ratio >= 0.48) return [0.98, 0.72, 0.42, op_scale];
        return [0.18, 0.76, 0.49, op_scale];
    }
    const c = (border_color_or_rgba && typeof border_color_or_rgba === 'object')
        ? border_color_or_rgba
        : parse_rgba(border_color_or_rgba);
    const r = c.red / 255, g = c.green / 255, b = c.blue / 255;
    const alpha = (Number.isFinite(c.alpha) ? c.alpha : 1.0) * op_scale;
    if (is_peak_cap) {
        return [Math.min(1, r + 0.38), Math.min(1, g + 0.38), Math.min(1, b + 0.38), alpha];
    }
    const boost = 0.72 + 0.28 * ratio;
    return [Math.min(1, r * boost), Math.min(1, g * boost), Math.min(1, b * boost), alpha];
}
