// SPDX-License-Identifier: GPL-3.0-or-later
// GNOME Shell extension entrypoint (SonarExtension extends Extension) managing enable/disable.

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { SonarManager } from './sonar/sonar_manager.js';

export default class SonarExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this.manager = null;
    }

    enable() {
        if (this.manager !== null) return;
        const mgr = new SonarManager(this);
        this.manager = mgr._destroyed ? null : mgr;
    }

    disable() {
        if (this.manager !== null) {
            this.manager.destroy();
            this.manager = null;
        }
    }
}
