// SPDX-License-Identifier: GPL-3.0-or-later
// Zero-dependency GJS architectural lint, Page Rule, EGO boundary, GTK4/Adw, and behavioral test suite.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {
    MIN_DB,
    compute_triangle_columns,
    db_to_unit,
    is_point_in_corner_triangle,
    parse_gst_level_structure,
    parse_gst_spectrum_structure,
    resample_bands,
    resolve_brick_rgb_unit,
} from '../extension/ui/speaker_style.js';
import {
    SUITE_COLOR_TARGETS,
    format_rgba,
    is_dark_rgba,
    parse_rgba,
    sync_color_across_suite,
    text_color_for_css,
} from '../extension/ui/settings/color.js';
import { CLICK_ACTIONS, COLOR_MODES, ExtensionSettings } from '../extension/ui/settings/gsettings.js';
import { BORDER_PRESETS, build_about_page, build_style_page } from '../extension/ui/settings/prefs_pages.js';

const BANNED_STEMS = new Set(['util', 'utils', 'lib', 'helper', 'helpers', 'common', 'misc', 'shared', 'base', 'core', 'types', 'mod']);
const DECODER = new TextDecoder('utf-8');
const REPO_ROOT = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_path();
const EXT_ROOT = GLib.build_filenamev([REPO_ROOT, 'extension']);

function assert(cond, msg) { if (!cond) throw new Error(`Verification failed: ${msg}`); }

function read_text(path) {
    const [ok, bytes] = GLib.file_get_contents(path);
    assert(ok, `failed to read ${path}`);
    return DECODER.decode(bytes);
}

function walk_repo(dir_path, js_files, dirs) {
    dirs.push(dir_path);
    const enumerator = Gio.File.new_for_path(dir_path).enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
    for (let info; (info = enumerator.next_file(null)) !== null;) {
        const name = info.get_name();
        if (name.startsWith('.') || name === 'dist' || name === 'target') continue;
        const full = GLib.build_filenamev([dir_path, name]);
        if (info.get_file_type() === Gio.FileType.DIRECTORY) walk_repo(full, js_files, dirs);
        else if (name.endsWith('.js')) js_files.push(full);
    }
    enumerator.close(null);
}

function strip_line_comment(raw, blank_strings = false) {
    let out = '', quote = '';
    for (let i = 0; i < raw.length; i += 1) {
        const ch = raw[i];
        if (quote) {
            if (!blank_strings) out += ch;
            if (ch === '\\' && i + 1 < raw.length) { if (!blank_strings) out += raw[i + 1]; i += 1; }
            else if (ch === quote) quote = '';
        } else if (ch === '\'' || ch === '"' || ch === '`') {
            quote = ch; out += blank_strings ? '""' : ch;
        } else if (ch === '/' && raw[i + 1] === '/') break;
        else out += ch;
    }
    return out;
}

function verify_page_rules_and_lint(js_files, dirs) {
    assert(js_files.length === 11, `expected 11 .js files, found ${js_files.length}`);
    const legacy = ['imports.gi', 'imports.ui', 'imports.misc', 'ExtensionUtils', 'Meta.LaterType', 'Clutter.Container', 'add_actor', 'remove_actor', 'new String('];
    const forbidden_re = [
        /\beval\s*\(/, /\bnew\s+Function\s*\(/, /Gio\.Subprocess(Launcher)?\b/,
        /GLib\.spawn_\w+/, /ByteArray\.toString/, /imports\.(mainloop|lang)/,
    ];
    for (const file of js_files) {
        const content = read_text(file);
        const lines = content.endsWith('\n') ? content.slice(0, -1).split('\n') : content.split('\n');
        assert(lines.length >= 16 && lines.length <= 256, `Page Rule violation: ${file} has ${lines.length} lines (16..=256)`);
        assert(lines[0] === '// SPDX-License-Identifier: GPL-3.0-or-later', `Missing SPDX header in ${file}`);
        assert(lines[1].startsWith('// ') && lines[1].length >= 12, `Missing concise module description on line 2 of ${file}`);
        if (file.startsWith(EXT_ROOT)) {
            for (const sym of legacy) assert(!content.includes(sym), `Forbidden legacy symbol '${sym}' in ${file}`);
            for (const re of forbidden_re) assert(!re.test(content), `Forbidden pattern ${re} in ${file}`);
        }
        for (let idx = 0; idx < lines.length; idx += 1) {
            const raw = lines[idx], ln = idx + 1, code = strip_line_comment(raw, true);
            assert(raw.length <= 200, `Line ${ln} of ${file} exceeds 200 chars (${raw.length})`);
            if (!file.startsWith(EXT_ROOT)) continue;
            assert(!code.trimStart().startsWith('var ') && !code.includes(' var ') && !code.includes('(var '), `Forbidden var in ${file}:${ln}`);
            for (let i = 0; i < code.length - 1; i += 1) {
                const prev = i > 0 ? code[i - 1] : '';
                const prev_eq = prev === '=' || prev === '!' || prev === '<' || prev === '>';
                const next_eq = i + 2 < code.length && code[i + 2] === '=';
                assert(!(code[i] === '=' && code[i + 1] === '=' && !prev_eq && !next_eq), `Loose == in ${file}:${ln}`);
                assert(!(code[i] === '!' && code[i + 1] === '=' && !next_eq), `Loose != in ${file}:${ln}`);
            }
        }
    }
    for (const dir_path of dirs) {
        const enumerator = Gio.File.new_for_path(dir_path).enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        const visible = [];
        for (let info; (info = enumerator.next_file(null)) !== null;) {
            const name = info.get_name();
            if (!name.startsWith('.') && name !== 'dist' && name !== 'target') visible.push(name);
        }
        enumerator.close(null);
        assert(visible.length <= 8, `Directory density violation: ${dir_path} has ${visible.length} visible entries (max 8)`);
        for (const name of visible) {
            const stem = (name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name).toLowerCase();
            assert(!BANNED_STEMS.has(stem), `Banned generic name '${name}' in ${dir_path}`);
        }
    }
}

function verify_process_boundaries_and_invariants() {
    const shared = ['prefs.js', 'ui/speaker_style.js', 'ui/settings/gsettings.js', 'ui/settings/color.js', 'ui/settings/prefs_pages.js'];
    const compositor_only = ['gi://Meta', 'gi://Clutter', 'gi://St', 'gi://Shell', 'resource:///org/gnome/shell/'];
    assert(strip_line_comment("import St from 'gi://St'; // comment").includes('gi://St'), 'strip_line_comment');
    for (const rel of shared) {
        for (const raw of read_text(GLib.build_filenamev([EXT_ROOT, rel])).split('\n')) {
            const code = strip_line_comment(raw);
            for (const sym of compositor_only) assert(!code.includes(sym), `Process-boundary violation: ${rel} imports '${sym}'`);
        }
    }
    const check_files = [
        'extension.js', 'prefs.js', 'ui/settings/prefs_pages.js', 'sonar/sonar_manager.js',
        'sonar/audio_stream.js', 'sonar/corner_speaker.js', 'sonar/media_volume.js',
        'metadata.json', 'schemas/org.gnome.shell.extensions.sonar.gschema.xml',
    ];
    const combined = check_files.map((rel) => read_text(GLib.build_filenamev([EXT_ROOT, rel]))).join('\n');
    const reqs = [
        'export default class SonarExtension extends Extension', 'this.manager.destroy()', 'fillPreferencesWindow(window)',
        'Adw.PreferencesPage', 'close-request', 'Star Sonar on GitHub', 'Tuition, Not Coffee — Help send my daughter to college',
        'https://ubermetroid.github.io/tuition-not-coffee', '[sonar] decay-tick', 'pulsesrc device="@DEFAULT_MONITOR@"',
        '"45"', '"50"', '"settings-schema": "org.gnome.shell.extensions.sonar"', 'name="enable-left-speaker"',
        'name="enable-right-speaker"', '1.0.0', '"name": "Studio 2201: Sonar (8-Bit Corner Speakers)"',
        'Sync Color Across Suite', 'sync_color_across_suite', 'this.unload_theme()', 'load_stylesheet(file)',
    ];
    for (const req of reqs) assert(combined.includes(req), `Missing invariant: ${req}`);
    const prefs_pages = read_text(GLib.build_filenamev([EXT_ROOT, 'ui/settings/prefs_pages.js']));
    assert(!/new Gtk\.Label\(\{[^}]*&amp;/s.test(prefs_pages), 'Gtk.Label must not contain raw &amp; without use_markup');
}

async function verify_behavioral_and_gtk_suite() {
    const tmp_dir = GLib.dir_make_tmp('sonar-verify-XXXXXX');
    const schema_xml = 'org.gnome.shell.extensions.sonar.gschema.xml';
    const dst_xml = Gio.File.new_for_path(GLib.build_filenamev([tmp_dir, schema_xml]));
    const comp = Gio.File.new_for_path(GLib.build_filenamev([tmp_dir, 'gschemas.compiled']));
    try {
        Gio.File.new_for_path(GLib.build_filenamev([EXT_ROOT, 'schemas', schema_xml])).copy(dst_xml, Gio.FileCopyFlags.OVERWRITE, null, null);
        assert(Gio.Subprocess.new(['glib-compile-schemas', tmp_dir], Gio.SubprocessFlags.NONE).wait_check(null), 'schema');
        const src = Gio.SettingsSchemaSource.new_from_directory(tmp_dir, Gio.SettingsSchemaSource.get_default(), false);
        const mem_backend = Gio.memory_settings_backend_new();
        const ext_settings = new Gio.Settings({ settings_schema: src.lookup('org.gnome.shell.extensions.sonar', true), backend: mem_backend });
        const s = new ExtensionSettings(ext_settings);
        assert(s.enable_left_speaker() && s.enable_right_speaker() && s.show_peak_caps() && s.show_border() && !s.idle_hide() && s.scroll_volume(), 'bool defs');
        assert(s.corner_size() === 136 && s.corner_margin() === 6 && s.column_count() === 8 && s.sensitivity() === 100, 'uint defs 1');
        assert(s.background_opacity() === 80 && s.brick_opacity() === 100 && s.border_width() === 2 && s.border_radius() === 16, 'uint defs 2');
        assert(s.color_mode() === 'suite-accent' && s.click_action() === 'play-pause' && COLOR_MODES.length === 2 && CLICK_ACTIONS.length === 3 && BORDER_PRESETS.length === 4, 'enums');

        s.set_corner_size(500); assert(s.corner_size() === 240, 'clamp max size');
        s.set_corner_size(20); assert(s.corner_size() === 80, 'clamp min size');
        s.set_column_count(20); assert(s.column_count() === 12, 'clamp max cols');
        s.set_brick_opacity(10); assert(s.brick_opacity() === 20, 'clamp min brick opacity');
        s.set_border_width(20); assert(s.border_width() === 8, 'clamp max border width');
        s.set_border_radius(80); assert(s.border_radius() === 32, 'clamp max border radius');
        s.set_color_mode('arcade-vu'); assert(s.color_mode() === 'arcade-vu', 'arcade-vu');
        s.set_border_color_rgba('#2ec27e'); assert(s.border_color_rgba() === 'rgba(46, 194, 126, 1)', 'border color');
        s.reset_defaults();
        assert(s.corner_size() === 136 && s.background_opacity() === 80 && s.brick_opacity() === 100, 'reset defaults 1');
        assert(s.border_width() === 2 && s.border_radius() === 16 && s.color_mode() === 'suite-accent' && s.border_color_rgba() === 'rgba(255, 0, 0, 1)', 'reset defaults 2');

        const sonar_sdir = GLib.build_filenamev([tmp_dir, 'sonar@studio2201.github.io', 'schemas']);
        GLib.mkdir_with_parents(sonar_sdir, 0o755);
        comp.copy(Gio.File.new_for_path(GLib.build_filenamev([sonar_sdir, 'gschemas.compiled'])), Gio.FileCopyFlags.OVERWRITE, null, null);
        assert(SUITE_COLOR_TARGETS.length === 7 && sync_color_across_suite('#102030', tmp_dir, mem_backend) === 1 && s.border_color_rgba() === 'rgba(16, 32, 48, 1)', 'suite sync');
        for (const p of [GLib.build_filenamev([sonar_sdir, 'gschemas.compiled']), sonar_sdir, GLib.build_filenamev([tmp_dir, 'sonar@studio2201.github.io'])]) Gio.File.new_for_path(p).delete(null);
        s.reset_defaults();

        assert(is_dark_rgba(parse_rgba('#111111')) && text_color_for_css('#ffffff') === '#000000', 'luminance');
        assert(format_rgba(parse_rgba('#zzzzzz')) === 'rgba(255, 0, 0, 1)', 'invalid hex falls back to Coral Red');
        assert(db_to_unit(MIN_DB) === 0 && db_to_unit(-4) === 1 && db_to_unit(-36, 100) === 0.5, 'db_to_unit');
        const lvl = parse_gst_level_structure('level, peak=(GValueArray)< -18.5, -12.0 >, decay=(GValueArray)< -18.5, -12.0 >;');
        assert(lvl && lvl.left_db === -18.5 && lvl.right_db === -12.0, 'parse_gst_level_structure');
        const spec_str = 'spectrum, magnitude=(float)< < (float)-20.0, (float)-30.0, (float)-40.0, (float)-50.0 >, < (float)-15.0, (float)-25.0, (float)-35.0, (float)-45.0 > >;';
        const spec = parse_gst_spectrum_structure(spec_str, 4);
        assert(spec && spec.left_bands.length === 4 && spec.left_bands[0] === -20 && spec.right_bands[0] === -15, 'parse_gst_spectrum_structure');
        assert(resample_bands([-10, -20], 6).length === 6, 'resample_bands');

        const left_cols = compute_triangle_columns(136, 8, false);
        const right_cols = compute_triangle_columns(136, 8, true);
        assert(left_cols.length === 8 && left_cols[0].max_bricks > left_cols[7].max_bricks && left_cols[0].x < left_cols[7].x, 'left triangle');
        assert(right_cols.length === 8 && right_cols[0].max_bricks > right_cols[7].max_bricks && right_cols[0].x > right_cols[7].x, 'right triangle');
        for (const sz of [80, 100, 136, 240]) {
            for (const c of [4, 8, 12]) {
                const l_fit = compute_triangle_columns(sz, c, false);
                const r_fit = compute_triangle_columns(sz, c, true);
                assert(l_fit.at(-1).x + l_fit.at(-1).width <= sz && r_fit.at(-1).x >= 0, `fit (${sz}, ${c})`);
            }
        }
        const rs_16 = resample_bands([0, -2, -4, -6, -8, -10, -12, -14, -16, -18, -20, -22, -24, -26, -28, -30], 8);
        assert(rs_16.length === 8 && rs_16[7] === -29, 'resample_bands averages top treble bands 14..15');
        assert(is_point_in_corner_triangle(10, 126, 136, false, 8) && !is_point_in_corner_triangle(126, 10, 136, false, 8), 'left hit test');
        assert(is_point_in_corner_triangle(126, 126, 136, true, 8) && !is_point_in_corner_triangle(10, 10, 136, true, 8), 'right hit test');
        assert(resolve_brick_rgb_unit(9, 10, 'arcade-vu', 'rgb(255,0,0)', false, 50)[3] === 0.5, 'arcade-vu brick opacity');

        let Gtk = null, Adw = null;
        try { Gtk = (await import('gi://Gtk?version=4.0')).default; Adw = (await import('gi://Adw?version=1')).default; } catch (_e) { /* no Gtk4 */ }
        if (Gtk && Adw && Gtk.init_check()) {
            Adw.init();
            const signals = [], page_s = build_style_page(ext_settings, s, signals), page_a = build_about_page();
            assert(page_s.get_title() === 'Appearance & Styling' && page_a.get_title() === 'About & Support', 'GTK4 pages');
            let root_to_walk = [page_s, page_a];
            const gres = '/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource';
            if (Gio.File.new_for_path(gres).query_exists(null)) {
                try {
                    Gio.resources_register(Gio.Resource.load(gres));
                    const { default: SonarPreferences, build_speakers_page } = await import('../extension/prefs.js');
                    assert(build_speakers_page(ext_settings, s, signals).get_title() === 'Corner Speakers', 'Corner Speakers page title');
                    const prefs = Object.create(SonarPreferences.prototype), win = new Adw.PreferencesWindow();
                    prefs.getSettings = () => ext_settings; prefs.fillPreferencesWindow(win); root_to_walk = [win];
                } catch (e) { if (String(e).includes('Verification failed')) throw e; }
            }
            const walk_labels = (w) => {
                if (!w) return;
                if (w instanceof Gtk.Label) {
                    const txt = w.get_text() || '';
                    assert(!txt.includes('&amp;'), `Unescaped &amp; in rendered Gtk.Label text: ${txt}`);
                    if (w.get_visible()) assert(txt.trim().length > 0, 'Empty visible Gtk.Label');
                }
                for (let c = w.get_first_child?.(); c; c = c.get_next_sibling?.()) walk_labels(c);
            };
            for (const r of root_to_walk) walk_labels(r);
            for (const [obj, sig] of signals) obj.disconnect(sig);
        }
    } finally {
        for (const f of [dst_xml, comp, Gio.File.new_for_path(tmp_dir)]) {
            try { if (f.query_exists(null)) f.delete(null); } catch (_e) { /* ignore cleanup error */ }
        }
    }
}
const js_files = [], dirs = [];
walk_repo(REPO_ROOT, js_files, dirs);
verify_page_rules_and_lint(js_files, dirs);
verify_process_boundaries_and_invariants();
await verify_behavioral_and_gtk_suite();
print(`OK: verified ${js_files.length} JS pages across ${dirs.length} directories and all headless behavioral suites.`);
