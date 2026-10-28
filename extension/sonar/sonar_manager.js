// SPDX-License-Identifier: GPL-3.0-or-later
// Coordinates Sonar settings, GStreamer stereo monitor stream, and Left/Right 8-bit corner speakers.

import Gio from 'gi://Gio';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { ExtensionSettings } from '../ui/settings/gsettings.js';
import { AudioStream } from './audio_stream.js';
import { CornerSpeaker } from './corner_speaker.js';
import { MediaVolumeController } from './media_volume.js';

export class SonarManager {
    constructor(extension) {
        this.extension = extension;
        this.ext_settings = null;
        this.settings = null;
        this._current_style = null;
        this._audio = null;
        this._media = null;
        this._left_speaker = null;
        this._right_speaker = null;
        this._ext_sig = 0;
        this._iface_sigs = [];
        this._mon_sig = 0;
        this._ov_show_sig = 0;
        this._ov_hide_sig = 0;
        this._destroyed = false;

        try {
            this.ext_settings = extension.getSettings();
            this.settings = new ExtensionSettings(this.ext_settings);
            this.load_theme();

            this._media = new MediaVolumeController(extension, this.settings);
            this._audio = new AudioStream(this.settings, () => this._on_audio_frame());
            this._left_speaker = new CornerSpeaker(false, this.settings, this._audio, this._media);
            this._right_speaker = new CornerSpeaker(true, this.settings, this._audio, this._media);

            this._connect_signals();
            this._audio.start();
        } catch (err) {
            console.error('[sonar] failed to initialize SonarManager:', err);
            this.destroy();
        }
    }

    load_theme() {
        this.unload_theme();
        try {
            const file = Gio.File.new_for_path(`${this.extension.path}/ui/stylesheet.css`);
            const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
            if (theme) {
                theme.load_stylesheet(file);
                this._current_style = file;
            }
        } catch (err) {
            console.error('[sonar] failed to load stylesheet:', err);
        }
    }

    unload_theme() {
        if (!this._current_style) return;
        try {
            const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
            if (theme) theme.unload_stylesheet(this._current_style);
        } catch (_e) { /* ignore */ }
        this._current_style = null;
    }

    _connect_signals() {
        this._ext_sig = this.ext_settings.connect('changed', () => this._sync_all());
        if (this.settings.iface) {
            for (const key of ['color-scheme', 'gtk-theme']) {
                if (this.settings.iface.settings_schema?.has_key(key)) {
                    this._iface_sigs.push(this.settings.iface.connect(`changed::${key}`, () => this._sync_all()));
                }
            }
        }
        this._mon_sig = Main.layoutManager.connect('monitors-changed', () => this._sync_all());
        this._ov_show_sig = Main.overview.connect('showing', () => this._sync_all());
        this._ov_hide_sig = Main.overview.connect('hidden', () => this._sync_all());
    }

    _sync_all() {
        if (this._destroyed) return;
        this._left_speaker?.sync_geometry();
        this._right_speaker?.sync_geometry();
    }

    _on_audio_frame() {
        if (this._destroyed) return;
        this._left_speaker?.queue_frame();
        this._right_speaker?.queue_frame();
    }

    destroy() {
        this._destroyed = true;
        if (this.ext_settings && this._ext_sig) {
            try { this.ext_settings.disconnect(this._ext_sig); } catch (_e) { /* ignore */ }
            this._ext_sig = 0;
        }
        if (this.settings?.iface && this._iface_sigs.length > 0) {
            for (const sig of this._iface_sigs) {
                try { this.settings.iface.disconnect(sig); } catch (_e) { /* ignore */ }
            }
            this._iface_sigs = [];
        }
        if (this._mon_sig) {
            try { Main.layoutManager.disconnect(this._mon_sig); } catch (_e) { /* ignore */ }
            this._mon_sig = 0;
        }
        if (this._ov_show_sig) {
            try { Main.overview.disconnect(this._ov_show_sig); } catch (_e) { /* ignore */ }
            this._ov_show_sig = 0;
        }
        if (this._ov_hide_sig) {
            try { Main.overview.disconnect(this._ov_hide_sig); } catch (_e) { /* ignore */ }
            this._ov_hide_sig = 0;
        }
        if (this._left_speaker) {
            this._left_speaker.destroy();
            this._left_speaker = null;
        }
        if (this._right_speaker) {
            this._right_speaker.destroy();
            this._right_speaker = null;
        }
        if (this._audio) {
            this._audio.destroy();
            this._audio = null;
        }
        this.unload_theme();
        this._media = null;
        this.settings = null;
        this.ext_settings = null;
    }
}
