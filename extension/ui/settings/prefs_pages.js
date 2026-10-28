// SPDX-License-Identifier: GPL-3.0-or-later
// Shared GTK4/Libadwaita row builders and Preferences pages for Sonar.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { format_rgba, parse_rgba, sync_color_across_suite } from './color.js';
import { CLICK_ACTIONS, COLOR_MODES } from './gsettings.js';

export const BORDER_PRESETS = Object.freeze([
    Object.freeze(['Gruvbox Amber', 'rgb(251,184,108)']),
    Object.freeze(['Kelp Emerald', 'rgb(46,194,126)']),
    Object.freeze(['Ocean Cyan', 'rgb(106,215,225)']),
    Object.freeze(['Coral Red', 'rgb(255,0,0)']),
]);

export function make_switch_row(title, subtitle, active, on_toggle) {
    const row = new Adw.ActionRow({ title, subtitle });
    const sw = new Gtk.Switch({ active: Boolean(active), valign: Gtk.Align.CENTER });
    sw.connect('notify::active', () => on_toggle(sw.active));
    row.add_suffix(sw);
    row.activatable_widget = sw;
    return [row, sw];
}

export function make_spin_row(title, subtitle, value, min, max, step, on_change) {
    const row = new Adw.ActionRow({ title, subtitle });
    const spin = Gtk.SpinButton.new_with_range(min, max, step);
    spin.set_value(value);
    spin.set_valign(Gtk.Align.CENTER);
    spin.connect('value-changed', () => on_change(spin.get_value_as_int()));
    row.add_suffix(spin);
    row.activatable_widget = spin;
    return [row, spin];
}

export function make_combo_row(title, subtitle, items, active_idx, on_change) {
    const row = new Adw.ActionRow({ title, subtitle });
    const combo = new Gtk.ComboBoxText({ valign: Gtk.Align.CENTER });
    for (const item of items) combo.append_text(item);
    combo.set_active(Math.max(0, active_idx));
    combo.connect('changed', () => on_change(combo.get_active()));
    row.add_suffix(combo);
    row.activatable_widget = combo;
    return [row, combo];
}

function add_link_row(group, title, subtitle, button_label, url, fallback_url = null) {
    const row = new Adw.ActionRow({ title, subtitle });
    const btn = new Gtk.Button({ label: button_label, valign: Gtk.Align.CENTER, css_classes: ['pill'] });
    btn.connect('clicked', () => {
        let ok = false;
        try { ok = Boolean(Gio.AppInfo.launch_default_for_uri(url, null)); } catch (_e) { ok = false; }
        if (!ok && fallback_url) {
            try { Gio.AppInfo.launch_default_for_uri(fallback_url, null); } catch (_e2) { /* ignore */ }
        }
    });
    row.add_suffix(btn);
    row.activatable_widget = btn;
    group.add(row);
}

export function build_style_page(ext_settings, settings, signals) {
    const page = new Adw.PreferencesPage({ title: 'Appearance & Styling', icon_name: 'applications-graphics-symbolic' });
    const group = new Adw.PreferencesGroup({
        title: 'Transparency, Accent Border &amp; Color Presets',
        description: 'Customize background transparency, brick opacity, border thickness, and 1-click Kelp/Reef color presets',
    });

    const [op_row, op_spin] = make_spin_row(
        'Background Opacity (%)', 'Transparency of the corner speaker housing (0% = fully transparent, 80% = Reef default)',
        settings.background_opacity(), 0, 100, 5, (v) => settings.set_background_opacity(v),
    );
    const [bop_row, bop_spin] = make_spin_row(
        '8-Bit Brick Opacity (%)', 'Transparency of the lit 8-bit frequency bricks and peak caps (20–100%, default 100%)',
        settings.brick_opacity(), 20, 100, 5, (v) => settings.set_brick_opacity(v),
    );
    const [bdr_row, bdr_sw] = make_switch_row(
        'Show Accent Border Ring', 'Draw a high-contrast border around the corner speakers matching Kelp and Reef',
        settings.show_border(), (v) => settings.set_show_border(v),
    );

    const mode_labels = ['Studio 2201 Suite Accent (Default)', 'Classic 8-Bit Arcade VU (Emerald → Amber → Coral)'];
    const [mode_row, mode_combo] = make_combo_row(
        '8-Bit Brick Color Mode', 'Choose between your synced Studio 2201 accent color or classic 3-tier arcade VU meters',
        mode_labels, COLOR_MODES.indexOf(settings.color_mode()),
        (idx) => { if (idx >= 0 && idx < COLOR_MODES.length) settings.set_color_mode(COLOR_MODES[idx]); },
    );

    const color_row = new Adw.ActionRow({
        title: 'Accent Border Color',
        subtitle: 'Pick a custom RGBA color or select a 1-click Kelp/Reef color preset below',
    });
    const init_rgba = new Gdk.RGBA();
    if (!init_rgba.parse(settings.border_color_rgba())) init_rgba.parse('rgb(255,0,0)');
    const color_btn = new Gtk.ColorButton({ rgba: init_rgba, use_alpha: true, valign: Gtk.Align.CENTER });
    color_btn.connect('color-set', () => settings.set_border_color_rgba(color_btn.get_rgba().to_string()));
    color_row.add_suffix(color_btn);
    color_row.activatable_widget = color_btn;

    const preset_labels = [...BORDER_PRESETS.map(([label]) => label), 'Custom Color'];
    const match_preset = (color) => BORDER_PRESETS.findIndex(([, c]) => format_rgba(parse_rgba(c)) === color);
    const init_idx = match_preset(settings.border_color_rgba());
    const [preset_row, preset_combo] = make_combo_row(
        'Quick Color Presets', 'One-click color presets matching Kelp active window borders and Reef dock',
        preset_labels, init_idx >= 0 ? init_idx : BORDER_PRESETS.length,
        (idx) => {
            if (idx >= 0 && idx < BORDER_PRESETS.length) {
                const css_color = BORDER_PRESETS[idx][1];
                settings.set_border_color_rgba(css_color);
                const next_rgba = new Gdk.RGBA();
                if (next_rgba.parse(css_color)) color_btn.set_rgba(next_rgba);
            }
        },
    );

    const sync_row = new Adw.ActionRow({
        title: 'Sync Color Across Suite',
        subtitle: 'Apply this accent border color to all installed Studio 2201 extensions (Coral, Kelp, Reef, Seabed, Shoal, Sonar, Tide)',
    });
    const sync_btn = new Gtk.Button({ label: 'Sync Suite Color', valign: Gtk.Align.CENTER, css_classes: ['pill'] });
    sync_btn.connect('clicked', () => {
        const count = sync_color_across_suite(settings.border_color_rgba());
        sync_btn.set_label(`Synced (${count})`);
    });
    sync_row.add_suffix(sync_btn);
    sync_row.activatable_widget = sync_btn;

    const [bw_row, bw_spin] = make_spin_row(
        'Border Width (px)', 'Thickness of the speaker accent border ring (0–8 px, default 2 px)',
        settings.border_width(), 0, 8, 1, (v) => settings.set_border_width(v),
    );
    const [br_row, br_spin] = make_spin_row(
        'Border Corner Radius (px)', 'Corner rounding of the outer speaker corner (0–32 px, default 16 px)',
        settings.border_radius(), 0, 32, 2, (v) => settings.set_border_radius(v),
    );
    const [mg_row, mg_spin] = make_spin_row(
        'Floating Screen-Edge Margin (px)', 'Gap between the corner speakers and screen edges (0–24 px, default 6 px)',
        settings.corner_margin(), 0, 24, 1, (v) => settings.set_corner_margin(v),
    );
    const [scr_row, scr_sw] = make_switch_row(
        'Scroll Wheel Adjusts System Volume', 'Scroll up or down on either corner triangle to raise or lower volume',
        settings.scroll_volume(), (v) => settings.set_scroll_volume(v),
    );
    const click_labels = ['Play / Pause Active Media (Default)', 'Toggle Audio Mute', 'Disabled'];
    const [clk_row, clk_combo] = make_combo_row(
        'Left-Click Action', 'Action triggered when left-clicking inside either corner speaker triangle',
        click_labels, CLICK_ACTIONS.indexOf(settings.click_action()),
        (idx) => { if (idx >= 0 && idx < CLICK_ACTIONS.length) settings.set_click_action(CLICK_ACTIONS[idx]); },
    );

    const rows = [
        op_row, bop_row, bdr_row, mode_row, color_row, preset_row,
        sync_row, bw_row, br_row, mg_row, scr_row, clk_row,
    ];
    for (const r of rows) group.add(r);
    page.add(group);

    const sync_ui = () => {
        if (op_spin.get_value_as_int() !== settings.background_opacity()) op_spin.set_value(settings.background_opacity());
        if (bop_spin.get_value_as_int() !== settings.brick_opacity()) bop_spin.set_value(settings.brick_opacity());
        if (bdr_sw.active !== settings.show_border()) bdr_sw.active = settings.show_border();
        const m_idx = Math.max(0, COLOR_MODES.indexOf(settings.color_mode()));
        if (mode_combo.get_active() !== m_idx) mode_combo.set_active(m_idx);
        if (bw_spin.get_value_as_int() !== settings.border_width()) bw_spin.set_value(settings.border_width());
        if (br_spin.get_value_as_int() !== settings.border_radius()) br_spin.set_value(settings.border_radius());
        if (mg_spin.get_value_as_int() !== settings.corner_margin()) mg_spin.set_value(settings.corner_margin());
        if (scr_sw.active !== settings.scroll_volume()) scr_sw.active = settings.scroll_volume();
        const c_idx = Math.max(0, CLICK_ACTIONS.indexOf(settings.click_action()));
        if (clk_combo.get_active() !== c_idx) clk_combo.set_active(c_idx);
        const next_color = settings.border_color_rgba();
        const next_rgba = new Gdk.RGBA();
        if (next_rgba.parse(next_color) && !color_btn.get_rgba().equal(next_rgba)) color_btn.set_rgba(next_rgba);
        const p_idx = match_preset(next_color);
        const target_idx = p_idx >= 0 ? p_idx : BORDER_PRESETS.length;
        if (preset_combo.get_active() !== target_idx) preset_combo.set_active(target_idx);
    };
    const keys = [
        'background-opacity', 'brick-opacity', 'show-border', 'color-mode', 'border-color-rgba',
        'border-width', 'border-radius', 'corner-margin', 'scroll-volume', 'click-action',
    ];
    for (const k of keys) {
        if (ext_settings.settings_schema?.has_key(k)) signals.push([ext_settings, ext_settings.connect(`changed::${k}`, sync_ui)]);
    }
    return page;
}

export function build_about_page(version_name = 'v1.0.0') {
    const page = new Adw.PreferencesPage({ title: 'About & Support', icon_name: 'help-about-symbolic' });
    const header_group = new Adw.PreferencesGroup({
        title: 'Sonar — 8-Bit Corner Stereo Speakers for GNOME 45–50',
        description: 'Dual bottom-left and bottom-right 8-bit triangular audio spectrum visualizers driven by ' +
            'in-process GStreamer PipeWire/PulseAudio stereo monitor analysis.',
    });
    const ver_row = new Adw.ActionRow({
        title: 'Sonar Release Version',
        subtitle: 'Zero-subprocess, zero-telemetry Wayland stereo corner visualizer for GNOME Shell',
    });
    const clean_ver = String(version_name || '1.0.0').replace(/^v/, '');
    ver_row.add_suffix(new Gtk.Label({ label: `v${clean_ver}`, valign: Gtk.Align.CENTER, css_classes: ['monospace'] }));
    header_group.add(ver_row);

    const lic_row = new Adw.ActionRow({
        title: 'Open-Source License',
        subtitle: 'Original Studio 2201 creation — free software forever',
    });
    lic_row.add_suffix(new Gtk.Label({ label: 'GPL-3.0-or-later', valign: Gtk.Align.CENTER, css_classes: ['monospace'] }));
    header_group.add(lic_row);
    page.add(header_group);

    const support_group = new Adw.PreferencesGroup({
        title: 'Support &amp; Community',
        description: 'If Sonar makes your desktop come alive alongside Kelp and Reef, starring the repository ' +
            'or sponsoring development helps keep GNOME 45–50 support fast and rock-solid.',
    });
    add_link_row(
        support_group, 'Star Sonar on GitHub',
        'Star studio2201/sonar to help other Linux users discover Sonar',
        'Star on GitHub', 'https://github.com/studio2201/sonar',
    );
    add_link_row(
        support_group, 'Tuition, Not Coffee — Help send my daughter to college',
        "Skip the coffee — 100% of sponsorships go toward my daughter's college &amp; future fund",
        'Tuition, Not Coffee', 'https://ubermetroid.github.io/tuition-not-coffee',
        'https://github.com/studio2201/sonar',
    );
    add_link_row(
        support_group, 'Project Website &amp; Documentation',
        'Explore the Sonar feature guide and Studio 2201 suite integration',
        'Open Website', 'https://studio2201.github.io/sonar/',
    );
    add_link_row(
        support_group, 'Report an Issue or Request a Feature',
        'Found a bug or have a feature request? Open an issue on GitHub',
        'Report Issue', 'https://github.com/studio2201/sonar/issues',
    );
    page.add(support_group);
    return page;
}
