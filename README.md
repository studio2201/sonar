# Studio 2201: Sonar (`sonar@studio2201.github.io`)

**Dual Bottom-Left and Bottom-Right 8-Bit Triangular Corner Speakers for GNOME Shell 45–50.**

Sonar places mirrored 8-bit stepped right-triangle audio visualizers in the bottom-left and bottom-right corners of your screen — framing the **Reef** dock while reacting in real time to your **Left** and **Right** stereo audio channels via in-process GStreamer PipeWire/PulseAudio monitor capture (`@DEFAULT_MONITOR@`).

---

## Key Features

- **True Left & Right Stereo Separation**:
  - **Bottom-Left Triangle (`◣`)**: Driven by the **Left** audio channel (`ch0`), tallest at the left screen edge and stepping down diagonally toward the center of the screen.
  - **Bottom-Right Triangle (`◢`)**: Driven by the **Right** audio channel (`ch1`), tallest at the right screen edge and stepping down diagonally toward the center of the screen.
- **Crisp 8-Bit Pixel-Brick Geometry**:
  - Discrete 8-bit LED bricks (`4..=12` frequency columns, default `8`) with falling 8-bit peak-hold caps and a stepped pixel hypotenuse frame.
  - Two palette modes: **Studio 2201 Suite Accent** (Coral Red, Ocean Cyan, Emerald Green, Amber Gold, or any custom RGBA synced across all 7 Studio 2201 extensions) and **Classic 8-Bit Arcade VU** (Emerald base → Amber mid → Coral Red peak).
- **Direct Corner Speaker Controls**:
  - **Scroll Wheel**: Adjust system output volume directly over either corner triangle.
  - **Left-Click**: Toggle MPRIS media `PlayPause` (with automatic fallback to output mute toggle).
  - **Right-Click**: Open the quick popup menu to toggle **Classic 8-Bit Arcade VU Palette**, **Show 8-Bit Peak-Hold Caps**, **Auto-Fade When Audio is Silent**, or launch **Sonar Settings & About…**.
- **Zero-Subprocess In-Process GStreamer Pipeline**:
  - Uses `gi://Gst` (`pulsesrc device="@DEFAULT_MONITOR@"` + multi-channel `spectrum` & `level`) directly inside GJS with zero external processes or polling scripts.

---

## Verification & Packaging

```bash
glib-compile-schemas extension/schemas
gjs -m tests/verify.js
mkdir -p dist
gnome-extensions pack extension \
  --force \
  --out-dir=dist \
  --schema=schemas/org.gnome.shell.extensions.sonar.gschema.xml \
  --extra-source=sonar \
  --extra-source=ui
gnome-extensions install --force dist/sonar@studio2201.github.io.shell-extension.zip
```

---

## License

GPL-3.0-or-later — Copyright © 2026 Studio 2201.
