// SPDX-License-Identifier: GPL-3.0-or-later
// Multi-tab GTK4 / Libadwaita preferences UI for Sonar 8-bit corner speakers.

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { ExtensionSettings } from './ui/settings/gsettings.js';
import { build_about_page, build_style_page, make_spin_row, make_switch_row } from './ui/settings/prefs_pages.js';

export function build_speakers_page(ext_settings, settings, signals) {
    const page = new Adw.PreferencesPage({ title: 'Corner Speakers', icon_name: 'audio-speakers-symbolic' });

    const spk_group = new Adw.PreferencesGroup({
        title: 'Left &amp; Right Corner Triangles',
        description: 'Place 8-bit triangular stereo spectrum speakers in the bottom-left and bottom-right corners flanking Reef',
    });
    const [left_row, left_sw] = make_switch_row(
        'Enable Bottom-Left Speaker (Left Audio Channel)',
        'Render the left-channel 8-bit stepped triangle in the bottom-left screen corner',
        settings.enable_left_speaker(), (v) => settings.set_enable_left_speaker(v),
    );
    const [right_row, right_sw] = make_switch_row(
        'Enable Bottom-Right Speaker (Right Audio Channel)',
        'Render the right-channel 8-bit stepped triangle in the bottom-right screen corner',
        settings.enable_right_speaker(), (v) => settings.set_enable_right_speaker(v),
    );
    const [sz_row, sz_spin] = make_spin_row(
        'Corner Triangle Size (px)', 'Width and height of each bottom-corner right triangle (80–240 px, default 136 px)',
        settings.corner_size(), 80, 240, 8, (v) => settings.set_corner_size(v),
    );
    const [mg_row, mg_spin] = make_spin_row(
        'Screen-Edge Margin (px)', 'Distance from the bottom and side screen edges (0–24 px, default 6 px)',
        settings.corner_margin(), 0, 24, 2, (v) => settings.set_corner_margin(v),
    );
    for (const r of [left_row, right_row, sz_row, mg_row]) spk_group.add(r);
    page.add(spk_group);

    const dsp_group = new Adw.PreferencesGroup({
        title: 'Stereo Audio Spectrum &amp; Peak Response',
        description: 'Tune GStreamer stereo FFT column density, falling 8-bit peak caps, and audio gain sensitivity',
    });
    const [col_row, col_spin] = make_spin_row(
        '8-Bit Frequency Columns per Speaker', 'Number of stepped frequency columns from outer bass to inner treble (4–12)',
        settings.column_count(), 4, 12, 1, (v) => settings.set_column_count(v),
    );
    const [pk_row, pk_sw] = make_switch_row(
        'Show 8-Bit Peak-Hold Caps', 'Keep a bright falling 8-bit peak brick at the top of each frequency column',
        settings.show_peak_caps(), (v) => settings.set_show_peak_caps(v),
    );
    const [idl_row, idl_sw] = make_switch_row(
        'Auto-Fade When Audio is Silent', 'Fade out the corner speakers when no audio is playing',
        settings.idle_hide(), (v) => settings.set_idle_hide(v),
    );
    const [sen_row, sen_spin] = make_spin_row(
        'Audio Gain Sensitivity (%)', 'Scale incoming stereo dB levels (50–200%, default 100%)',
        settings.sensitivity(), 50, 200, 10, (v) => settings.set_sensitivity(v),
    );
    for (const r of [col_row, pk_row, idl_row, sen_row]) dsp_group.add(r);

    const [reset_row, reset_btn] = [
        new Adw.ActionRow({
            title: 'Reset to Sonar Defaults (border=2, margin=6)',
            subtitle: 'Restore dual 136px 8-column corner triangles, 80% opacity, and Coral Red accent border',
        }),
        new Gtk.Button({
            label: 'Reset Defaults', valign: Gtk.Align.CENTER, css_classes: ['destructive-action', 'pill'],
        }),
    ];
    reset_btn.connect('clicked', () => settings.reset_defaults());
    reset_row.add_suffix(reset_btn);
    reset_row.activatable_widget = reset_btn;
    dsp_group.add(reset_row);
    page.add(dsp_group);

    const sync_spk = () => {
        if (left_sw.active !== settings.enable_left_speaker()) left_sw.active = settings.enable_left_speaker();
        if (right_sw.active !== settings.enable_right_speaker()) right_sw.active = settings.enable_right_speaker();
        if (sz_spin.get_value_as_int() !== settings.corner_size()) sz_spin.set_value(settings.corner_size());
        if (mg_spin.get_value_as_int() !== settings.corner_margin()) mg_spin.set_value(settings.corner_margin());
        if (col_spin.get_value_as_int() !== settings.column_count()) col_spin.set_value(settings.column_count());
        if (pk_sw.active !== settings.show_peak_caps()) pk_sw.active = settings.show_peak_caps();
        if (idl_sw.active !== settings.idle_hide()) idl_sw.active = settings.idle_hide();
        if (sen_spin.get_value_as_int() !== settings.sensitivity()) sen_spin.set_value(settings.sensitivity());
    };
    const keys = [
        'enable-left-speaker', 'enable-right-speaker', 'corner-size', 'corner-margin',
        'column-count', 'show-peak-caps', 'idle-hide', 'sensitivity',
    ];
    for (const k of keys) {
        if (ext_settings.settings_schema?.has_key(k)) signals.push([ext_settings, ext_settings.connect(`changed::${k}`, sync_spk)]);
    }
    return page;
}

export default class SonarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const ext_settings = this.getSettings();
        const settings = new ExtensionSettings(ext_settings);
        const signals = [];
        if (typeof window.set_default_size === 'function') window.set_default_size(760, 680);
        window.add(build_speakers_page(ext_settings, settings, signals));
        window.add(build_style_page(ext_settings, settings, signals));
        window.add(build_about_page(this.metadata?.['version-name']));
        const cleanup = () => {
            for (const [obj, sig] of signals) obj.disconnect(sig);
            signals.length = 0;
        };
        if (typeof window.set_default_size === 'function') {
            window.connect('close-request', () => { cleanup(); return false; });
        }
        window.connect('destroy', cleanup);
    }
}
