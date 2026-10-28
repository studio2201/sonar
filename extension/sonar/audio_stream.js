// SPDX-License-Identifier: GPL-3.0-or-later
// In-process GStreamer stereo monitor pipeline with smooth 8-bit brick and peak-cap decay.

import GLib from 'gi://GLib';
import Gst from 'gi://Gst';
import {
    MIN_DB,
    db_to_unit,
    parse_gst_level_structure,
    parse_gst_spectrum_structure,
} from '../ui/speaker_style.js';

const MAX_COLS = 12;
const MAX_RETRIES = 6;

export class AudioStream {
    constructor(settings, on_frame) {
        this._settings = settings;
        this._on_frame = on_frame;
        this._pipeline = null;
        this._bus = null;
        this._bus_sig = 0;
        this._tick_id = 0;
        this._retry_id = 0;
        this._idle_err_id = 0;
        this._retry_count = 0;

        this.left_levels = new Array(MAX_COLS).fill(0);
        this.right_levels = new Array(MAX_COLS).fill(0);
        this.left_peaks = new Array(MAX_COLS).fill(0);
        this.right_peaks = new Array(MAX_COLS).fill(0);
        this.left_hold = new Array(MAX_COLS).fill(0);
        this.right_hold = new Array(MAX_COLS).fill(0);
        this.is_active = false;
        this._silent_ticks = 60;
    }

    start() {
        try {
            if (!Gst.is_initialized()) Gst.init(null);
        } catch (_e) {
            return;
        }
        this._start_pipeline();
        if (!this._tick_id) {
            this._tick_id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 45, () => this._on_decay_tick());
            if (GLib.Source?.set_name_by_id) GLib.Source.set_name_by_id(this._tick_id, '[sonar] decay-tick');
        }
    }

    _start_pipeline() {
        this._stop_pipeline();
        const pipe_str = [
            'pulsesrc device="@DEFAULT_MONITOR@"',
            'audio/x-raw,channels=2,rate=22050',
            'level interval=40000000 post-messages=true',
            'spectrum bands=16 threshold=-70 interval=40000000 post-messages=true multi-channel=true',
            'fakesink sync=false',
        ].join(' ! ');

        try {
            this._pipeline = Gst.parse_launch(pipe_str);
            this._bus = this._pipeline.get_bus();
            this._bus.add_signal_watch();
            this._bus_sig = this._bus.connect('message', (_bus, msg) => this._on_bus_message(msg));
            this._pipeline.set_state(Gst.State.PLAYING);
        } catch (_e) {
            this._stop_pipeline();
        }
    }

    _stop_pipeline() {
        if (this._bus) {
            if (this._bus_sig) {
                try { this._bus.disconnect(this._bus_sig); } catch (_e) { /* ignore */ }
                this._bus_sig = 0;
            }
            try { this._bus.remove_signal_watch(); } catch (_e) { /* ignore */ }
            this._bus = null;
        }
        if (this._pipeline) {
            try { this._pipeline.set_state(Gst.State.NULL); } catch (_e) { /* ignore */ }
            this._pipeline = null;
        }
    }

    _on_bus_message(msg) {
        if (!msg) return;
        if (msg.type === Gst.MessageType.ERROR) {
            if (!this._idle_err_id) {
                this._idle_err_id = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._idle_err_id = 0;
                    this._schedule_retry();
                    return GLib.SOURCE_REMOVE;
                });
                if (GLib.Source?.set_name_by_id) GLib.Source.set_name_by_id(this._idle_err_id, '[sonar] gst-err-idle');
            }
            return;
        }
        if (msg.type !== Gst.MessageType.ELEMENT) return;
        this._retry_count = 0;
        const st = msg.get_structure();
        if (!st) return;
        const text = st.to_string();
        const cols = this._settings.column_count();
        const sens = this._settings.sensitivity();

        if (text.startsWith('spectrum,')) {
            const parsed = parse_gst_spectrum_structure(text, cols);
            if (parsed) {
                this._apply_bands(parsed.left_bands, parsed.right_bands, cols, sens);
            }
        } else if (text.startsWith('level,')) {
            const parsed = parse_gst_level_structure(text);
            if (parsed) {
                const l_u = db_to_unit(parsed.left_db, sens);
                const r_u = db_to_unit(parsed.right_db, sens);
                if (l_u > 0.02 || r_u > 0.02) {
                    this._silent_ticks = 0;
                    this.is_active = true;
                }
            }
        }
    }

    _apply_bands(l_db_arr, r_db_arr, cols, sens) {
        let any_sound = false;
        for (let i = 0; i < cols; i += 1) {
            const lu = db_to_unit(l_db_arr[i] ?? MIN_DB, sens);
            const ru = db_to_unit(r_db_arr[i] ?? MIN_DB, sens);
            if (lu > 0.03 || ru > 0.03) any_sound = true;
            if (lu >= this.left_levels[i]) {
                this.left_levels[i] = lu;
            } else {
                this.left_levels[i] = this.left_levels[i] * 0.65 + lu * 0.35;
            }
            if (ru >= this.right_levels[i]) {
                this.right_levels[i] = ru;
            } else {
                this.right_levels[i] = this.right_levels[i] * 0.65 + ru * 0.35;
            }
            if (this.left_levels[i] >= this.left_peaks[i]) {
                this.left_peaks[i] = this.left_levels[i];
                this.left_hold[i] = 7;
            }
            if (this.right_levels[i] >= this.right_peaks[i]) {
                this.right_peaks[i] = this.right_levels[i];
                this.right_hold[i] = 7;
            }
        }
        if (any_sound) {
            this._silent_ticks = 0;
            this.is_active = true;
        }
        if (this._on_frame) this._on_frame();
    }

    _on_decay_tick() {
        let changed = false;
        for (let i = 0; i < MAX_COLS; i += 1) {
            if (this.left_levels[i] > 0.005) {
                this.left_levels[i] = Math.max(0, this.left_levels[i] - 0.045);
                changed = true;
            } else if (this.left_levels[i] !== 0) {
                this.left_levels[i] = 0;
                changed = true;
            }
            if (this.right_levels[i] > 0.005) {
                this.right_levels[i] = Math.max(0, this.right_levels[i] - 0.045);
                changed = true;
            } else if (this.right_levels[i] !== 0) {
                this.right_levels[i] = 0;
                changed = true;
            }
            if (this.left_hold[i] > 0) {
                this.left_hold[i] -= 1;
            } else if (this.left_peaks[i] > 0) {
                this.left_peaks[i] = Math.max(this.left_levels[i], this.left_peaks[i] - 0.028);
                changed = true;
            }
            if (this.right_hold[i] > 0) {
                this.right_hold[i] -= 1;
            } else if (this.right_peaks[i] > 0) {
                this.right_peaks[i] = Math.max(this.right_levels[i], this.right_peaks[i] - 0.028);
                changed = true;
            }
        }
        this._silent_ticks += 1;
        const was_active = this.is_active;
        this.is_active = this._silent_ticks < 35;
        if (changed || was_active !== this.is_active) {
            if (this._on_frame) this._on_frame();
        }
        return GLib.SOURCE_CONTINUE;
    }

    _schedule_retry() {
        this._stop_pipeline();
        if (this._retry_id || this._retry_count >= MAX_RETRIES) return;
        this._retry_count += 1;
        const delay_sec = Math.min(30, 4 * this._retry_count);
        this._retry_id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delay_sec, () => {
            this._retry_id = 0;
            this._start_pipeline();
            return GLib.SOURCE_REMOVE;
        });
        if (GLib.Source?.set_name_by_id) GLib.Source.set_name_by_id(this._retry_id, '[sonar] gst-retry');
    }

    destroy() {
        if (this._idle_err_id) {
            GLib.source_remove(this._idle_err_id);
            this._idle_err_id = 0;
        }
        if (this._tick_id) {
            GLib.source_remove(this._tick_id);
            this._tick_id = 0;
        }
        if (this._retry_id) {
            GLib.source_remove(this._retry_id);
            this._retry_id = 0;
        }
        this._stop_pipeline();
        this._on_frame = null;
    }
}
