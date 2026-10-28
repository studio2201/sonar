// SPDX-License-Identifier: GPL-3.0-or-later
// Volume scroll control, MPRIS play/pause & mute actions, and right-click PopupMenu for Sonar.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';

export class MediaVolumeController {
    constructor(extension, settings) {
        this._extension = extension;
        this._settings = settings;
        this._mixer = null;
        try {
            this._mixer = Volume.getMixerControl();
        } catch (_e) {
            this._mixer = null;
        }
    }

    handle_scroll(event) {
        if (!this._settings.scroll_volume()) return Clutter.EVENT_PROPAGATE;
        const dir = event.get_scroll_direction();
        let delta = 0;
        if (dir === Clutter.ScrollDirection.UP) {
            delta = 1;
        } else if (dir === Clutter.ScrollDirection.DOWN) {
            delta = -1;
        } else if (dir === Clutter.ScrollDirection.SMOOTH) {
            const [, dy] = event.get_scroll_delta();
            if (Math.abs(dy) > 0.05) delta = dy < 0 ? 1 : -1;
        }
        if (delta === 0) return Clutter.EVENT_PROPAGATE;
        this._adjust_volume(delta);
        return Clutter.EVENT_STOP;
    }

    _adjust_volume(step_dir) {
        const stream = this._mixer?.get_default_sink?.();
        if (!stream || !this._mixer) return;
        const norm = this._mixer.get_vol_max_norm();
        const step = Math.max(1, Math.round(norm * 0.04));
        const next = Math.max(0, Math.min(norm, stream.volume + step_dir * step));
        stream.volume = next;
        stream.push_volume();
        if (next > 0 && stream.is_muted) stream.change_is_muted(false);
    }

    handle_left_click() {
        const action = this._settings.click_action();
        if (action === 'none') return Clutter.EVENT_PROPAGATE;
        if (action === 'mute') {
            this._toggle_mute();
            return Clutter.EVENT_STOP;
        }
        this._mpris_play_pause();
        return Clutter.EVENT_STOP;
    }

    _toggle_mute() {
        const stream = this._mixer?.get_default_sink?.();
        if (!stream) return;
        stream.change_is_muted(!stream.is_muted);
    }

    _mpris_play_pause() {
        Gio.DBus.session.call(
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            'org.freedesktop.DBus',
            'ListNames',
            null,
            null,
            Gio.DBusCallFlags.NONE,
            2000,
            null,
            (conn, res) => {
                try {
                    const reply = conn.call_finish(res);
                    const [names] = reply.deep_unpack();
                    const players = names.filter((n) => n.startsWith('org.mpris.MediaPlayer2.'));
                    if (players.length === 0) {
                        this._toggle_mute();
                        return;
                    }
                    this._select_and_toggle_player(conn, players, 0);
                } catch (_e) {
                    this._toggle_mute();
                }
            },
        );
    }

    _select_and_toggle_player(conn, players, idx) {
        if (idx >= players.length) {
            this._call_play_pause(conn, players[0]);
            return;
        }
        const bus_name = players[idx];
        conn.call(
            bus_name,
            '/org/mpris/MediaPlayer2',
            'org.freedesktop.DBus.Properties',
            'Get',
            new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'PlaybackStatus']),
            null,
            Gio.DBusCallFlags.NONE,
            1000,
            null,
            (_c, res) => {
                try {
                    const reply = conn.call_finish(res);
                    const [val] = reply.deep_unpack();
                    if (val?.deep_unpack?.() === 'Playing') {
                        this._call_play_pause(conn, bus_name);
                        return;
                    }
                } catch (_e) { /* try next */ }
                this._select_and_toggle_player(conn, players, idx + 1);
            },
        );
    }

    _call_play_pause(conn, player) {
        conn.call(
            player,
            '/org/mpris/MediaPlayer2',
            'org.mpris.MediaPlayer2.Player',
            'PlayPause',
            null,
            null,
            Gio.DBusCallFlags.NONE,
            2000,
            null,
            null,
        );
    }

    build_context_menu(actor) {
        const menu = new PopupMenu.PopupMenu(actor, 0.5, St.Side.BOTTOM);
        Main.uiGroup.add_child(menu.actor);
        menu.actor.hide();

        const vu_item = new PopupMenu.PopupSwitchMenuItem(
            'Classic 8-Bit Arcade VU Palette',
            this._settings.color_mode() === 'arcade-vu',
        );
        vu_item.connect('toggled', (_item, state) => {
            this._settings.set_color_mode(state ? 'arcade-vu' : 'suite-accent');
        });
        menu.addMenuItem(vu_item);

        const pk_item = new PopupMenu.PopupSwitchMenuItem(
            'Show 8-Bit Peak-Hold Caps',
            this._settings.show_peak_caps(),
        );
        pk_item.connect('toggled', (_item, state) => {
            this._settings.set_show_peak_caps(state);
        });
        menu.addMenuItem(pk_item);

        const idl_item = new PopupMenu.PopupSwitchMenuItem(
            'Auto-Fade When Audio is Silent',
            this._settings.idle_hide(),
        );
        idl_item.connect('toggled', (_item, state) => {
            this._settings.set_idle_hide(state);
        });
        menu.addMenuItem(idl_item);

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction('Mute / Unmute Output', () => this._toggle_mute());
        menu.addAction('Sonar Settings & About…', () => {
            try { this._extension.openPreferences(); } catch (_e) { /* ignore */ }
        });

        if (Main.panel?.menuManager) {
            Main.panel.menuManager.addMenu(menu);
        }
        return { menu, vu_item, pk_item, idl_item };
    }

    sync_menu(menu_bundle) {
        if (!menu_bundle) return;
        menu_bundle.vu_item.setToggleState(this._settings.color_mode() === 'arcade-vu');
        menu_bundle.pk_item.setToggleState(this._settings.show_peak_caps());
        menu_bundle.idl_item.setToggleState(this._settings.idle_hide());
    }
}
