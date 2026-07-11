// Pure hex-tile model used by the simulation and headless snapshot restore.
import { CAMP } from '../rules/camps.js';
import { BOARD_RULES } from '../rules/constants.js';
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
        this.isCity = false;
        this.isVillage = false;
        this.villageDistrictId = 0;
        this.districtId = 0;
        this.terrain = 'plains';
        this.fortification = null;
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
        if (this.camp === newCamp && this.targetColor === newCamp.color) return;
        this.camp = newCamp;
        this.startColor = newCamp.color;
        this.targetColor = newCamp.color;
        this.currentColor = newCamp.color;
        this.fadeStartTime = null;
    }
}
