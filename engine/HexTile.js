// Pure hex-tile model used by the simulation and headless snapshot restore.
import { CAMP } from '../rules/camps.js';
import { BOARD_RULES } from '../rules/constants.js';
import { SURFACE_KIND } from '../rules/surfaces.js';
import { nextId } from '../js/uid.js';

const HEX_SIZE = BOARD_RULES.hexSize;
const HEX_WIDTH = Math.sqrt(3) * HEX_SIZE;

export class EngineHexTile {
    constructor(q, r, idOverride = null) {
        this.id = idOverride ?? nextId();
        this.q = q;
        this.r = r;
        this.s = -q - r;
        this.camp = CAMP.neutral;
        this.surface = SURFACE_KIND.LAND;
        this.isCity = false;
        // A multi-cell city has one `isCity` centre and one or more visual
        // footprint cells marked `isUrban`. Old one-cell cities set both.
        this.isUrban = false;
        this.urbanCenterKey = null;
        this.isVillage = false;
        this.villageDistrictId = 0;
        this.districtId = 0;
        this.terrain = 'plains';
        this.fortification = null;
        this.isPort = false;
        this._portCapturedIndependent = false;
        this._portOperationalAtRound = 0;
        this.unit = null;
        this.startColor = this.camp.color;
        this.targetColor = this.camp.color;
        this.currentColor = this.camp.color;
        this.fadeDuration = 0;
        this.fadeStartTime = null;
        this._minePlanted = false;
        this._mineCampKey = null;
        this._cityDisabledUntil = 0;
        this._reinforcedThisTurn = false;
        this.x = BOARD_RULES.logicalWidth / 2 + HEX_WIDTH * (q + r * 0.5);
        this.y = BOARD_RULES.logicalHeight / 2 + (3 / 2 * HEX_SIZE) * r;
    }

    setCampWithFade(newCamp) {
        // Water is deliberately ownerless. Keep its material colour intact
        // rather than replacing it with the neutral faction colour.
        if (!newCamp) {
            this.camp = null;
            this.fadeStartTime = null;
            return;
        }
        if (this.camp === newCamp && this.targetColor === newCamp.color) return;
        this.camp = newCamp;
        this.startColor = newCamp.color;
        this.targetColor = newCamp.color;
        this.currentColor = newCamp.color;
        this.fadeStartTime = null;
    }
}
