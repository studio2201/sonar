// SPDX-License-Identifier: GPL-3.0-or-later
// Single bottom-corner 8-bit triangular pixel speaker widget (Left or Right channel).

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { parse_rgba } from '../ui/settings/color.js';
import {
    compute_triangle_columns,
    is_point_in_corner_triangle,
    resolve_brick_rgb_unit,
} from '../ui/speaker_style.js';

export class CornerSpeaker {
    constructor(is_right, settings, audio_stream, media_ctrl) {
        this.is_right = Boolean(is_right);
        this._settings = settings;
        this._audio = audio_stream;
        this._media = media_ctrl;
        this._menu_bundle = null;
        this._style_cache = null;

        this.actor = new St.DrawingArea({
            style_class: 'sonar-corner-speaker',
            reactive: true,
            can_focus: false,
            track_hover: true,
        });

        this._repaint_id = this.actor.connect('repaint', (area) => this._on_repaint(area));
        this._btn_id = this.actor.connect('button-press-event', (_a, ev) => this._on_button_press(ev));
        this._scroll_id = this.actor.connect('scroll-event', (_a, ev) => this._on_scroll(ev));

        Main.layoutManager.addChrome(this.actor, {
            affectsStruts: false,
            trackFullscreen: true,
        });
        this._menu_bundle = this._media.build_context_menu(this.actor);
        this.sync_geometry();
    }

    sync_geometry() {
        if (!this.actor) return;
        this._style_cache = null;
        const enabled = this.is_right
            ? this._settings.enable_right_speaker()
            : this._settings.enable_left_speaker();
        const mon = Main.layoutManager.primaryMonitor;
        if (!enabled || Main.overview.visible || !mon) {
            this.actor.hide();
            return;
        }

        const style = this._get_style(this._settings.corner_size());
        const size = style.size;
        const margin = style.margin;
        this.actor.set_size(size, size);

        const x = this.is_right
            ? mon.x + mon.width - size - margin
            : mon.x + margin;
        const y = mon.y + mon.height - size - margin;
        this.actor.set_position(x, y);
        this._media.sync_menu(this._menu_bundle);

        this.actor.opacity = (style.idle_hide && !this._audio.is_active) ? 28 : 255;
        this.actor.show();
        this.actor.queue_repaint();
    }

    _get_style(size_hint) {
        const size = size_hint || this._settings.corner_size();
        if (this._style_cache && this._style_cache.size === size) return this._style_cache;
        const cols = this._settings.column_count();
        const border_css = this._settings.border_color_rgba();
        const border_rgba = parse_rgba(border_css);
        const show_border = this._settings.show_border();
        this._style_cache = {
            size,
            margin: this._settings.corner_margin(),
            cols,
            layout: compute_triangle_columns(size, cols, this.is_right),
            is_dark: this._settings.is_dark(),
            bg_alpha: Math.max(0, Math.min(1, this._settings.background_opacity() / 100)),
            brick_op: this._settings.brick_opacity(),
            color_mode: this._settings.color_mode(),
            border_rgba,
            show_caps: this._settings.show_peak_caps(),
            bdr_width: show_border ? this._settings.border_width() : 0,
            bdr_radius: this._settings.border_radius(),
            idle_hide: this._settings.idle_hide(),
        };
        return this._style_cache;
    }

    queue_frame() {
        if (!this.actor || !this.actor.visible) return;
        const style = this._get_style(this.actor.width);
        this.actor.opacity = (style.idle_hide && !this._audio.is_active) ? 28 : 255;
        this.actor.queue_repaint();
    }

    _is_event_inside_triangle(event) {
        const [gx, gy] = event.get_coords();
        const [ax, ay] = this.actor.get_transformed_position();
        const style = this._get_style(this.actor.width);
        return is_point_in_corner_triangle(gx - ax, gy - ay, style.size, this.is_right, style.cols);
    }

    _on_button_press(event) {
        if (!this._is_event_inside_triangle(event)) return Clutter.EVENT_PROPAGATE;
        const btn = event.get_button();
        if (btn === 3) {
            this._media.sync_menu(this._menu_bundle);
            this._menu_bundle?.menu.toggle();
            return Clutter.EVENT_STOP;
        }
        if (btn === 1) {
            if (this._menu_bundle?.menu.isOpen) {
                this._menu_bundle.menu.close();
                return Clutter.EVENT_STOP;
            }
            return this._media.handle_left_click();
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _on_scroll(event) {
        if (!this._is_event_inside_triangle(event)) return Clutter.EVENT_PROPAGATE;
        return this._media.handle_scroll(event);
    }

    _on_repaint(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const style = this._get_style(Math.min(w, h));
        const { layout, size, is_dark, bg_alpha, brick_op, color_mode, border_rgba, show_caps, bdr_width, bdr_radius } = style;

        const levels = this.is_right ? this._audio.right_levels : this._audio.left_levels;
        const peaks = this.is_right ? this._audio.right_peaks : this._audio.left_peaks;

        if (bg_alpha > 0.01 || bdr_width > 0) {
            this._draw_corner_housing(cr, layout, size, is_dark, bg_alpha, bdr_width, bdr_radius, border_rgba);
        }

        for (let i = 0; i < layout.length; i += 1) {
            const col = layout[i];
            const lvl = levels[i] ?? 0;
            const pk = peaks[i] ?? 0;
            const lit_bricks = Math.min(col.max_bricks, Math.round(lvl * col.max_bricks));
            const peak_brick = Math.min(col.max_bricks - 1, Math.floor(pk * col.max_bricks));

            for (let b = 0; b < col.max_bricks; b += 1) {
                const by = col.base_y - (b + 1) * col.brick_h - b * col.brick_gap;
                const is_lit = b < lit_bricks;
                const is_cap = show_caps && pk > 0.04 && b === peak_brick && b >= lit_bricks;

                if (is_lit || is_cap) {
                    const [r, g, bl, a] = resolve_brick_rgb_unit(
                        b, col.max_bricks, color_mode, border_rgba, is_cap, brick_op,
                    );
                    cr.setSourceRGBA(r, g, bl, a);
                    cr.rectangle(col.x, by, col.width, col.brick_h);
                    cr.fill();
                } else if (bg_alpha > 0.05) {
                    const slot_c = is_dark ? 1.0 : 0.0;
                    cr.setSourceRGBA(slot_c, slot_c, slot_c, (is_dark ? 0.08 : 0.10) * bg_alpha);
                    cr.rectangle(col.x, by, col.width, col.brick_h);
                    cr.fill();
                }
            }
        }
        cr.$dispose();
    }

    _draw_corner_housing(cr, layout, size, is_dark, bg_alpha, bdr_width, bdr_radius, border_rgba) {
        const r_bg = is_dark ? (24 / 255) : (246 / 255);
        const g_bg = is_dark ? (24 / 255) : (246 / 255);
        const b_bg = is_dark ? (28 / 255) : (250 / 255);

        if (bg_alpha > 0.01) {
            cr.setSourceRGBA(r_bg, g_bg, b_bg, bg_alpha);
            for (const col of layout) {
                const total_h = col.max_bricks * col.brick_h + (col.max_bricks - 1) * col.brick_gap + 8;
                const top_y = Math.max(0, col.base_y - total_h);
                cr.rectangle(col.x - 2, top_y, col.width + 4, size - top_y);
            }
            cr.fill();
        }

        if (bdr_width > 0) {
            cr.setSourceRGBA(border_rgba.red / 255, border_rgba.green / 255, border_rgba.blue / 255, border_rgba.alpha);
            for (const col of layout) {
                const total_h = col.max_bricks * col.brick_h + (col.max_bricks - 1) * col.brick_gap + 8;
                const top_y = Math.max(0, col.base_y - total_h);
                cr.rectangle(col.x - 2, top_y, col.width + 4, bdr_width);
            }
            cr.fill();

            const rad = Math.max(0, Math.min(24, bdr_radius));
            const half = bdr_width / 2;
            cr.setLineWidth(bdr_width);
            cr.newPath();
            if (this.is_right) {
                cr.moveTo(size - half, 4);
                cr.lineTo(size - half, size - half - rad);
                if (rad > 0) cr.arc(size - half - rad, size - half - rad, rad, 0, Math.PI / 2);
                cr.lineTo(0, size - half);
            } else {
                cr.moveTo(half, 4);
                cr.lineTo(half, size - half - rad);
                if (rad > 0) cr.arc(half + rad, size - half - rad, rad, Math.PI, Math.PI / 2);
                cr.lineTo(size, size - half);
            }
            cr.stroke();
        }
    }

    destroy() {
        if (this._menu_bundle?.menu) {
            try { this._menu_bundle.menu.destroy(); } catch (_e) { /* ignore */ }
            this._menu_bundle = null;
        }
        if (this.actor) {
            if (this._repaint_id) this.actor.disconnect(this._repaint_id);
            if (this._btn_id) this.actor.disconnect(this._btn_id);
            if (this._scroll_id) this.actor.disconnect(this._scroll_id);
            try { Main.layoutManager.removeChrome(this.actor); } catch (_e) { /* ignore */ }
            try { this.actor.destroy(); } catch (_e) { /* ignore */ }
            this.actor = null;
        }
    }
}
