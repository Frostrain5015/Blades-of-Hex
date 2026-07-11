// Browser bootstrap adapter for legacy callers that still invoke Unit presentation methods.
// The Unit domain class intentionally does not import this module.
import { Unit } from './Unit.js';
import { drawUnit, getUnitVisualPos, startUnitMovePath } from './unitRenderer.js';
import { gameState } from './state.js';

Unit.prototype.getVisualPos = function getVisualPos() {
    return getUnitVisualPos(this);
};

Unit.prototype.startMovePath = function startMovePath(path) {
    return startUnitMovePath(this, path);
};

Unit.prototype.draw = function draw() {
    return drawUnit(this, gameState);
};
