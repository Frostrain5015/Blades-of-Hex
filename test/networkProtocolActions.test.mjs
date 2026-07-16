import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTION_TYPES } from '../protocol/messages.js';

const ACTION_SOURCE_FILES = [
    'js/gameLogic.js',
    'js/input.js',
    'js/state.js'
];

function collectLiteralActions(source) {
    const actions = new Set();
    const pattern = /(?:broadcastAction|sendAction)\(\s*['"]([^'"]+)['"]/g;
    for (const match of source.matchAll(pattern)) actions.add(match[1]);
    return actions;
}

test('all browser-broadcast gameplay actions are accepted by the server protocol', () => {
    const emitted = new Set();
    for (const relativePath of ACTION_SOURCE_FILES) {
        const source = readFileSync(join(import.meta.dirname, '..', relativePath), 'utf8');
        for (const action of collectLiteralActions(source)) emitted.add(action);
    }

    const missing = [...emitted].filter(action => !ACTION_TYPES.has(action)).sort();
    assert.deepEqual(missing, [], `protocol ACTION_TYPES is missing: ${missing.join(', ')}`);
});
