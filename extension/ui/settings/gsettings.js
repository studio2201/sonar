// SPDX-License-Identifier: GPL-3.0-or-later
// Typed wrapper (ExtensionSettings) around Sonar GSettings schema keys and GNOME theme state.

import Gio from 'gi://Gio';
import { format_rgba, parse_rgba } from './color.js';

export const COLOR_MODES = Object.freeze(['suite-accent', 'arcade-vu']);
export const CLICK_ACTIONS = Object.freeze(['play-pause', 'mute', 'none']);
const DEFAULT_BORDER_COLOR = 'rgb(255,0,0)';

const BOOL_DEFAULTS = Object.freeze({
    'enable-left-speaker': true,
    'enable-right-speaker': true,
    'show-peak-caps': true,
    'idle-hide': false,
    'show-border': true,
    'scroll-volume': true,
});

const UINT_BOUNDS = Object.freeze({
    'corner-size': [80, 240, 136],
    'corner-margin': [0, 24, 6],
    'column-count': [4, 12, 8],
    'sensitivity': [50, 200, 100],
    'background-opacity': [0, 100, 80],
    'brick-opacity': [20, 100, 100],
    'border-width': [0, 8, 2],
    'border-radius': [0, 32, 16],
});

const ENUM_SPEC = Object.freeze({
    'color-mode': [COLOR_MODES, 'suite-accent'],
    'click-action': [CLICK_ACTIONS, 'play-pause'],
});

export class ExtensionSettings {
    constructor(ext_settings, interface_settings = null) {
        this.ext = ext_settings;
        try {
            this.iface = interface_settings ?? new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        } catch (_e) {
            this.iface = null;
        }

        for (const [key, def] of Object.entries(BOOL_DEFAULTS)) {
            const prop = key.replace(/-/g, '_');
            this[prop] = () => (this.ext.settings_schema?.has_key(key) ? this.ext.get_boolean(key) : def);
            this[`set_${prop}`] = (v) => {
                if (this.ext.settings_schema?.has_key(key)) this.ext.set_boolean(key, Boolean(v));
            };
        }

        for (const [key, [min, max, def]] of Object.entries(UINT_BOUNDS)) {
            const prop = key.replace(/-/g, '_');
            this[prop] = () => {
                if (!this.ext.settings_schema?.has_key(key)) return def;
                const raw = this.ext.get_uint(key);
                return Math.max(min, Math.min(max, Number.isFinite(raw) ? raw : def));
            };
            this[`set_${prop}`] = (v) => {
                if (!this.ext.settings_schema?.has_key(key)) return;
                const n = Math.round(Number(v));
                const clamped = Math.max(min, Math.min(max, Number.isFinite(n) ? n : def));
                this.ext.set_uint(key, clamped);
            };
        }

        for (const [key, [allowed, def]] of Object.entries(ENUM_SPEC)) {
            const prop = key.replace(/-/g, '_');
            this[prop] = () => {
                if (!this.ext.settings_schema?.has_key(key)) return def;
                const raw = this.ext.get_string(key);
                return allowed.includes(raw) ? raw : def;
            };
            this[`set_${prop}`] = (v) => {
                if (!this.ext.settings_schema?.has_key(key)) return;
                const valid = allowed.includes(v) ? v : def;
                if (this.ext.get_string(key) !== valid) this.ext.set_string(key, valid);
            };
        }
    }

    border_color_rgba() {
        const raw = this.ext.settings_schema?.has_key('border-color-rgba')
            ? this.ext.get_string('border-color-rgba')
            : DEFAULT_BORDER_COLOR;
        return format_rgba(parse_rgba(raw || DEFAULT_BORDER_COLOR));
    }

    set_border_color_rgba(v) {
        if (!this.ext.settings_schema?.has_key('border-color-rgba')) return;
        const next = format_rgba(parse_rgba(v || DEFAULT_BORDER_COLOR));
        if (this.ext.get_string('border-color-rgba') !== next) {
            this.ext.set_string('border-color-rgba', next);
        }
    }

    is_dark() {
        if (!this.iface?.settings_schema) return true;
        if (this.iface.settings_schema.has_key('color-scheme')) {
            const scheme = this.iface.get_string('color-scheme');
            if (scheme === 'prefer-dark') return true;
            if (scheme === 'prefer-light') return false;
        }
        if (this.iface.settings_schema.has_key('gtk-theme')) {
            return this.iface.get_string('gtk-theme').toLowerCase().includes('dark');
        }
        return true;
    }

    reset_defaults() {
        for (const [key, def] of Object.entries(BOOL_DEFAULTS)) this[`set_${key.replace(/-/g, '_')}`](def);
        for (const [key, [, , def]] of Object.entries(UINT_BOUNDS)) this[`set_${key.replace(/-/g, '_')}`](def);
        for (const [key, [, def]] of Object.entries(ENUM_SPEC)) this[`set_${key.replace(/-/g, '_')}`](def);
        this.set_border_color_rgba(DEFAULT_BORDER_COLOR);
    }
}
