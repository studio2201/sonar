# AGENTS.md — Sonar Architectural Invariants & Engineering Standards

## 1. Global Engineering Philosophy

Sonar (`sonar@studio2201.github.io`) is built on four uncompromising engineering pillars:

1. **Linus Torvalds' "Good Taste"**: Eliminate special-case branching through clean data representation (mirrored left/right triangular geometry, pure GStreamer `level`/`spectrum` bus parsers, and unified 8-bit LED brick color resolvers).
2. **UNIX Philosophy**: Each module ("page") does one thing well, composes cleanly via explicit ES2022 imports, and avoids hidden global state.
3. **NASA JPL Power-of-10 Safety Rules**:
   - All frequency band resamplers and column geometry builders enforce explicit bounds (`4..=12` columns, `80..=240` px).
   - Zero dynamic code evaluation (`eval`, `Function`) and zero external subprocesses (`Gio.Subprocess`, `GLib.spawn_*`) in the compositor — audio capture runs 100% in-process via `gi://Gst` (`pulsesrc device="@DEFAULT_MONITOR@"`).
   - All `GLib.timeout_add` sources (`[sonar] decay-tick`, `[sonar] gst-retry`) are deterministically named via `GLib.Source.set_name_by_id` and removed on teardown.
4. **OWASP Zero-Trust & Multi-Distro Security**:
   - Zero shell subprocesses or network calls; integrates natively with GNOME Shell lock/suspend `disable()` teardown, `Gvc` (`Volume.getMixerControl()`) volume control, and MPRIS D-Bus playback control.
   - All CSS color inputs (`extension/ui/settings/color.js`) are clamped and sanitized before style generation.

---

## 2. The Page Rule & Directory Density (Enforced by `tests/verify.js`)

- **File Line Bounds**: Every `.js` source file in the repository (`extension/`, `tests/`) **must** be between **16 and 256 lines** (`16..=256`), and every line **must** be at most **200 characters** (`<= 200`).
- **Directory Density**: Every directory in the repository (`root`, `tests/`, `extension/`, and all subdirectories) **must** contain **at most 8 visible entries** (`<= 8`).
- **Banned Generic Names**: Generic grab-bag names (`util`, `utils`, `lib`, `helper`, `helpers`, `common`, `misc`, `shared`, `base`, `core`, `types`, `mod`) are strictly forbidden.
- **2-Line SPDX + Concise Module Header**:
   - Line 1 of every `.js` file must be `// SPDX-License-Identifier: GPL-3.0-or-later`.
   - Line 2 of every `.js` file must be a concise single-line module description (`// <Concise module description>`).

---

## 3. Process-Boundary & GNOME Shell / EGO Lifecycle Invariants (`tests/verify.js`)

- **ES2022 Strictness**: Zero `var` declarations (`const`/`let` only) and zero loose equality operators (`===`/`!==` only).
- **Process Boundary Separation**: `extension/prefs.js` runs in the GTK4 `gnome-extensions-app` process. Neither `prefs.js` nor any module in its import chain (`ui/speaker_style.js`, `ui/settings/gsettings.js`, `ui/settings/color.js`, `ui/settings/prefs_pages.js`) may import compositor-only typelibs (`gi://Meta`, `gi://Clutter`, `gi://St`, `gi://Shell`, `resource:///org/gnome/shell/*`).
- **Deterministic EGO Teardown**: `extension/extension.js` performs zero top-level work at import time and deterministically stops the GStreamer pipeline (`Gst.State.NULL`), removes the `Gst.Bus` signal watch, cancels named `GLib` timers, removes both `CornerSpeaker` widgets from `Main.layoutManager`, and unloads the stylesheet on `disable()`.

---

## 4. Functional Page Map

### Verification & Test Suite (`tests/` — 1 page)
- [`tests/verify.js`](tests/verify.js): Zero-dependency GJS architectural lint, Page Rule (`16..=256` lines, `<= 8` entries/dir), process-boundary check, GTK4/Libadwaita Preferences inspection, and headless behavioral test suite (`gjs -m tests/verify.js`).

### GNOME Shell Extension (`extension/` — 10 JS pages across 2 domain trees)
- **Root Entrypoints**:
  - [`extension/extension.js`](extension/extension.js): `SonarExtension extends Extension` EGO lifecycle entrypoint.
  - [`extension/prefs.js`](extension/prefs.js): `SonarPreferences extends ExtensionPreferences` 3-tab GTK4 / Libadwaita preferences UI.
- **8-Bit Corner Speakers & GStreamer Stereo Audio (`extension/sonar/` — 4 pages)**:
  - [`sonar_manager.js`](extension/sonar/sonar_manager.js): Coordinates `ExtensionSettings`, `AudioStream`, `MediaVolumeController`, and Left/Right `CornerSpeaker` instances across monitor and overview changes.
  - [`audio_stream.js`](extension/sonar/audio_stream.js): In-process GStreamer stereo monitor pipeline (`pulsesrc device="@DEFAULT_MONITOR@"` + `level` + multi-channel `spectrum`) with smooth 8-bit brick and peak-cap decay.
  - [`corner_speaker.js`](extension/sonar/corner_speaker.js): Bottom-left or bottom-right `St.DrawingArea` widget rendering stepped 8-bit LED frequency columns, falling peak caps, and triangular hit-testing.
  - [`media_volume.js`](extension/sonar/media_volume.js): Scroll-wheel output volume control (`Volume.getMixerControl()`), MPRIS `PlayPause` / mute left-click actions, and right-click `PopupMenu`.
- **UI, 8-Bit Geometry & Settings (`extension/ui/` — 4 JS pages + stylesheet)**:
  - [`speaker_style.js`](extension/ui/speaker_style.js), `stylesheet.css`
  - `settings/`: [`color.js`](extension/ui/settings/color.js), [`gsettings.js`](extension/ui/settings/gsettings.js), [`prefs_pages.js`](extension/ui/settings/prefs_pages.js)
