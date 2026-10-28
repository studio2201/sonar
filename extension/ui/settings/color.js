// SPDX-License-Identifier: GPL-3.0-or-later
// CSS color parser, sRGB relative luminance calculator, and suite-wide accent color synchronizer.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const DEFAULT_RGBA = Object.freeze({ red: 255, green: 0, blue: 0, alpha: 1.0 });

export const SUITE_COLOR_TARGETS = Object.freeze([
    Object.freeze(['coral@studio2201.github.io', 'org.gnome.shell.extensions.coral', 'border-color-rgba']),
    Object.freeze(['kelp@studio2201.github.io', 'org.gnome.shell.extensions.kelp', 'hint-color-rgba']),
    Object.freeze(['reef@studio2201.github.io', 'org.gnome.shell.extensions.reef', 'border-color-rgba']),
    Object.freeze(['seabed@studio2201.github.io', 'org.gnome.shell.extensions.seabed', 'border-color-rgba']),
    Object.freeze(['shoal@studio2201.github.io', 'org.gnome.shell.extensions.shoal', 'attention-color-rgba']),
    Object.freeze(['sonar@studio2201.github.io', 'org.gnome.shell.extensions.sonar', 'border-color-rgba']),
    Object.freeze(['tide@studio2201.github.io', 'org.gnome.shell.extensions.tide', 'border-color-rgba']),
]);

function clamp_byte(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(255, Math.round(n)));
}

function clamp_alpha(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 1.0;
    return Math.max(0.0, Math.min(1.0, n));
}

export function parse_rgba(input) {
    if (typeof input !== 'string') return { ...DEFAULT_RGBA };
    const s = input.trim();

    if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) {
        const hex = s.slice(1);
        if (hex.length <= 4) {
            const alpha = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1.0;
            return {
                red: clamp_byte(parseInt(hex[0] + hex[0], 16)),
                green: clamp_byte(parseInt(hex[1] + hex[1], 16)),
                blue: clamp_byte(parseInt(hex[2] + hex[2], 16)),
                alpha: clamp_alpha(alpha),
            };
        }
        const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1.0;
        return {
            red: clamp_byte(parseInt(hex.slice(0, 2), 16)),
            green: clamp_byte(parseInt(hex.slice(2, 4), 16)),
            blue: clamp_byte(parseInt(hex.slice(4, 6), 16)),
            alpha: clamp_alpha(alpha),
        };
    }

    const num = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[-+]?\\d+)?';
    const match = s.match(new RegExp(`^rgba?\\(\\s*(${num})\\s*,\\s*(${num})\\s*,\\s*(${num})(?:\\s*,\\s*(${num}%?))?\\s*\\)$`, 'i'));
    if (match) {
        let alpha = 1.0;
        if (match[4] !== undefined) {
            const raw_a = match[4];
            alpha = raw_a.endsWith('%') ? parseFloat(raw_a) / 100 : parseFloat(raw_a);
        }
        return {
            red: clamp_byte(parseFloat(match[1])),
            green: clamp_byte(parseFloat(match[2])),
            blue: clamp_byte(parseFloat(match[3])),
            alpha: clamp_alpha(alpha),
        };
    }

    return { ...DEFAULT_RGBA };
}

export function format_rgba(rgba) {
    const src = rgba && typeof rgba === 'object' ? rgba : DEFAULT_RGBA;
    const r = clamp_byte(src.red);
    const g = clamp_byte(src.green);
    const b = clamp_byte(src.blue);
    const a = clamp_alpha(src.alpha);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function is_dark_rgba(rgba) {
    const src = rgba && typeof rgba === 'object' ? rgba : DEFAULT_RGBA;
    const to_linear = (channel) => {
        const c = clamp_byte(channel) / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const luminance =
        0.2126 * to_linear(src.red) +
        0.7152 * to_linear(src.green) +
        0.0722 * to_linear(src.blue);
    return luminance <= 0.179;
}

export function text_color_for_css(css_color) {
    const parsed = parse_rgba(css_color);
    return is_dark_rgba(parsed) ? '#ffffff' : '#000000';
}

export function sync_color_across_suite(css_color, ext_base_dir = null, backend = null) {
    const normalized = format_rgba(parse_rgba(css_color));
    const base_dir = ext_base_dir || GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-shell', 'extensions']);
    const default_src = Gio.SettingsSchemaSource.get_default();
    let updated = 0;
    for (let i = 0; i < SUITE_COLOR_TARGETS.length; i += 1) {
        const [uuid, schema_id, key] = SUITE_COLOR_TARGETS[i];
        const schema_dir = GLib.build_filenamev([base_dir, uuid, 'schemas']);
        const compiled = GLib.build_filenamev([schema_dir, 'gschemas.compiled']);
        if (!GLib.file_test(compiled, GLib.FileTest.IS_REGULAR)) continue;
        try {
            const src = Gio.SettingsSchemaSource.new_from_directory(schema_dir, default_src, false);
            const schema = src.lookup(schema_id, true);
            if (!schema || !schema.has_key(key)) continue;
            const gs = backend
                ? new Gio.Settings({ settings_schema: schema, backend })
                : new Gio.Settings({ settings_schema: schema });
            if (gs.is_writable(key)) {
                gs.set_string(key, normalized);
                updated += 1;
            }
        } catch (_e) { /* skip unavailable extension schema */ }
    }
    Gio.Settings.sync();
    return updated;
}
