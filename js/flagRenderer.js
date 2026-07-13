// WebGL2 batched cloth flags. One context and one instanced draw call render every
// battlefield flag; SVG artwork and the cloth mesh deform together in the vertex shader.
import { LOGICAL_W, LOGICAL_H, getCanvasPixelRatio } from './canvasRuntime.js';
import { getFlagColors } from '../rules/camps.js';
import { campToKey } from '../rules/camps.js';
import { getUnitVisualPos } from './unitRenderer.js';
import { UNIT_FLAG_LAYOUT } from './flagLayout.js';

const MESH_COLUMNS = 18;
const MESH_ROWS = 9;
const ATLAS_COLUMNS = 4;
const ATLAS_ROWS = 4;
const ATLAS_CELL_W = 256;
const ATLAS_CELL_H = 171;
const INSTANCE_FLOATS = 13;
export const FLAG_WIND_STRENGTH = Object.freeze({ normal: 0.7, wind: 1.5 });
export const FLAG_CLOTH_PHYSICS = Object.freeze({ gravitySag: 0.1, windFlattening: 0.22 });

export function getFlagWindStrength(weather) {
    return weather === 'wind' ? FLAG_WIND_STRENGTH.wind : FLAG_WIND_STRENGTH.normal;
}

function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader) || '旗帜着色器编译失败';
        gl.deleteShader(shader);
        throw new Error(message);
    }
    return shader;
}

function program(gl, vertexSource, fragmentSource) {
    const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const result = gl.createProgram();
    gl.attachShader(result, vertex);
    gl.attachShader(result, fragment);
    gl.linkProgram(result);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(result, gl.LINK_STATUS)) {
        const message = gl.getProgramInfoLog(result) || '旗帜着色器链接失败';
        gl.deleteProgram(result);
        throw new Error(message);
    }
    return result;
}

function rgb(hex) {
    const value = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!value) return [0.45, 0.45, 0.45];
    const n = Number.parseInt(value[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function phaseFrom(value) {
    const text = String(value ?? '0');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return (hash >>> 0) / 0xffffffff * Math.PI * 2;
}

const VERTEX_SOURCE = `#version 300 es
precision highp float;
in vec2 aUv;
in vec2 aAnchor;
in vec2 aSize;
in float aPhase;
in float aAtlasIndex;
in vec3 aMainColor;
in vec3 aDarkColor;
in float aCommander;
uniform vec2 uResolution;
uniform float uTime;
uniform float uWind;
out vec2 vUv;
out float vFold;
flat out float vAtlasIndex;
flat out vec3 vMainColor;
flat out vec3 vDarkColor;
flat out float vCommander;
void main() {
    float u = aUv.x;
    float v = aUv.y;
    float strength = min(uWind, 2.5);
    float travel = smoothstep(0.0, 0.13, u) * pow(u, 0.82);
    float t = uTime * (1.75 + strength * 0.34);
    float primaryPhase = t * 1.75 - u * 7.2 + aPhase;
    float ripplePhase = t * 3.05 - u * 14.5 + v * 3.1 + aPhase * 1.37;
    float twistPhase = t * 1.35 - u * 5.6 + aPhase * 0.73;
    float primary = sin(primaryPhase);
    float ripple = sin(ripplePhase);
    float depth = travel * strength * (primary * 0.115 + ripple * 0.027);
    float vertical = travel * strength * (primary * 0.072 + ripple * 0.020);
    float torsion = (v - 0.5) * travel * strength * cos(twistPhase) * 0.055;
    // 重力形成从固定端到自由端逐渐增加的静态弧垂；风越强，旗面被拉得越平。
    float windLift = 1.0 - clamp(strength / 2.5, 0.0, 1.0) * ${FLAG_CLOTH_PHYSICS.windFlattening.toFixed(3)};
    float gravitySag = travel * ${FLAG_CLOTH_PHYSICS.gravitySag.toFixed(3)} * windLift;
    vec2 local = vec2(u, v);
    local.y += gravitySag + vertical + torsion;
    local.x += depth * 0.11 - travel * abs(depth) * 0.055;
    local.y = 0.5 + (local.y - 0.5) / (1.0 - depth * 0.12);
    vec2 pixel = aAnchor + local * aSize;
    gl_Position = vec4(pixel.x / uResolution.x * 2.0 - 1.0, 1.0 - pixel.y / uResolution.y * 2.0, 0.0, 1.0);
    vUv = aUv;
    vFold = clamp(cos(primaryPhase) * 0.78 + cos(ripplePhase) * 0.22, -1.0, 1.0) * min(strength, 1.4);
    vAtlasIndex = aAtlasIndex;
    vMainColor = aMainColor;
    vDarkColor = aDarkColor;
    vCommander = aCommander;
}`;

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
uniform sampler2D uAtlas;
in vec2 vUv;
in float vFold;
flat in float vAtlasIndex;
flat in vec3 vMainColor;
flat in vec3 vDarkColor;
flat in float vCommander;
out vec4 outColor;
float commandSashMask(vec2 uv, float padding) {
    float gate = smoothstep(0.635 - padding, 0.645 + padding, uv.x);
    float top = (uv.x - 0.645) * 0.84 - padding;
    float bottom = top + 0.13 + padding * 2.0;
    float begins = smoothstep(top - 0.006, top + 0.006, uv.y);
    float ends = 1.0 - smoothstep(bottom - 0.006, bottom + 0.006, uv.y);
    return gate * begins * ends;
}
void main() {
    vec4 texel;
    if (vAtlasIndex >= 0.0) {
        float column = mod(vAtlasIndex, ${ATLAS_COLUMNS}.0);
        float row = floor(vAtlasIndex / ${ATLAS_COLUMNS}.0);
        vec2 safeUv = mix(vec2(0.003), vec2(0.997), vUv);
        vec2 atlasUv = vec2((column + safeUv.x) / ${ATLAS_COLUMNS}.0, 1.0 - (row + safeUv.y) / ${ATLAS_ROWS}.0);
        texel = texture(uAtlas, atlasUv);
    } else {
        texel = vec4(mix(vMainColor, vDarkColor, smoothstep(0.05, 1.0, vUv.x) * 0.45), 1.0);
    }
    vec3 color = texel.rgb;
    if (vCommander > 0.5) {
        float sashOutline = commandSashMask(vUv, 0.025);
        float sash = commandSashMask(vUv, 0.0);
        vec3 darkThread = vec3(0.16, 0.09, 0.035);
        vec3 goldThread = mix(vec3(1.0, 0.89, 0.58), vec3(0.55, 0.31, 0.08), vUv.x);
        color = mix(color, darkThread, sashOutline * 0.96);
        color = mix(color, goldThread, sash);
    }
    float foldLight = 0.90 + vFold * 0.115;
    color *= foldLight;
    float edgeDistance = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float edge = 1.0 - smoothstep(0.0, 0.025, edgeDistance);
    color = mix(color, vec3(1.0), edge * 0.20);
    outColor = vec4(color, texel.a);
}`;

export class BatchedFlagRenderer {
    constructor(width = LOGICAL_W, height = LOGICAL_H, canvas = null, pixelRatio = 1) {
        this.logicalWidth = width;
        this.logicalHeight = height;
        this.pixelRatio = Math.max(1, pixelRatio || 1);
        this.canvas = canvas || document.createElement('canvas');
        this.canvas.width = Math.round(width * this.pixelRatio);
        this.canvas.height = Math.round(height * this.pixelRatio);
        this.gl = this.canvas.getContext('webgl2', {
            alpha: true,
            antialias: true,
            depth: false,
            premultipliedAlpha: true,
            preserveDrawingBuffer: true,
            powerPreference: 'high-performance'
        });
        if (!this.gl) throw new Error('WebGL2 不可用');
        this.instanceCount = 0;
        this.textureSlots = new Map();
        this.readyTextures = new Set();
        this.failedTextures = new Set();
        this.atlasCanvas = document.createElement('canvas');
        this.atlasCanvas.width = ATLAS_COLUMNS * ATLAS_CELL_W;
        this.atlasCanvas.height = ATLAS_ROWS * ATLAS_CELL_H;
        this.atlasContext = this.atlasCanvas.getContext('2d');
        this._initProgram();
        this._initMesh();
        this._initTexture();
        this._configure();
    }

    _initProgram() {
        const gl = this.gl;
        this.program = program(gl, VERTEX_SOURCE, FRAGMENT_SOURCE);
        const attr = name => gl.getAttribLocation(this.program, name);
        this.locations = {
            aUv: attr('aUv'), aAnchor: attr('aAnchor'), aSize: attr('aSize'), aPhase: attr('aPhase'),
            aAtlasIndex: attr('aAtlasIndex'), aMainColor: attr('aMainColor'), aDarkColor: attr('aDarkColor'),
            aCommander: attr('aCommander'),
            uResolution: gl.getUniformLocation(this.program, 'uResolution'),
            uTime: gl.getUniformLocation(this.program, 'uTime'),
            uWind: gl.getUniformLocation(this.program, 'uWind'),
            uAtlas: gl.getUniformLocation(this.program, 'uAtlas')
        };
    }

    _initMesh() {
        const gl = this.gl;
        const vertices = [];
        const indices = [];
        for (let row = 0; row <= MESH_ROWS; row++) {
            for (let column = 0; column <= MESH_COLUMNS; column++) vertices.push(column / MESH_COLUMNS, row / MESH_ROWS);
        }
        for (let row = 0; row < MESH_ROWS; row++) {
            for (let column = 0; column < MESH_COLUMNS; column++) {
                const tl = row * (MESH_COLUMNS + 1) + column;
                const tr = tl + 1;
                const bl = tl + MESH_COLUMNS + 1;
                const br = bl + 1;
                indices.push(tl, bl, tr, tr, bl, br);
            }
        }
        this.indexCount = indices.length;
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);
        const meshBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, meshBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(this.locations.aUv);
        gl.vertexAttribPointer(this.locations.aUv, 2, gl.FLOAT, false, 0, 0);
        const indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
        this.instanceBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
        const stride = INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
        const instanceAttribute = (location, size, offset) => {
            gl.enableVertexAttribArray(location);
            gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset * Float32Array.BYTES_PER_ELEMENT);
            gl.vertexAttribDivisor(location, 1);
        };
        instanceAttribute(this.locations.aAnchor, 2, 0);
        instanceAttribute(this.locations.aSize, 2, 2);
        instanceAttribute(this.locations.aPhase, 1, 4);
        instanceAttribute(this.locations.aAtlasIndex, 1, 5);
        instanceAttribute(this.locations.aMainColor, 3, 6);
        instanceAttribute(this.locations.aDarkColor, 3, 9);
        instanceAttribute(this.locations.aCommander, 1, 12);
        gl.bindVertexArray(null);
    }

    _initTexture() {
        const gl = this.gl;
        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.atlasCanvas);
    }

    _configure() {
        const gl = this.gl;
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0, 0, 0, 0);
    }

    registerTexture(url) {
        if (!url || this.failedTextures.has(url)) return -1;
        if (this.textureSlots.has(url)) return this.readyTextures.has(url) ? this.textureSlots.get(url) : -1;
        if (this.textureSlots.size >= ATLAS_COLUMNS * ATLAS_ROWS) return -1;
        const index = this.textureSlots.size;
        this.textureSlots.set(url, index);
        const image = new Image();
        image.onload = () => {
            const column = index % ATLAS_COLUMNS;
            const row = Math.floor(index / ATLAS_COLUMNS);
            this.atlasContext.clearRect(column * ATLAS_CELL_W, row * ATLAS_CELL_H, ATLAS_CELL_W, ATLAS_CELL_H);
            this.atlasContext.drawImage(image, column * ATLAS_CELL_W, row * ATLAS_CELL_H, ATLAS_CELL_W, ATLAS_CELL_H);
            const gl = this.gl;
            gl.bindTexture(gl.TEXTURE_2D, this.texture);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.atlasCanvas);
            this.readyTextures.add(url);
        };
        image.onerror = () => this.failedTextures.add(url);
        image.src = url;
        return -1;
    }

    setInstances(instances) {
        const data = new Float32Array(instances.length * INSTANCE_FLOATS);
        instances.forEach((item, index) => {
            const offset = index * INSTANCE_FLOATS;
            const colors = item.colors || getFlagColors(item.color);
            const main = rgb(colors.main);
            const dark = rgb(colors.dark);
            data.set([
                item.x, item.y, item.width, item.height, item.phase || 0,
                this.registerTexture(item.flagUrl),
                ...main, ...dark, item.commander ? 1 : 0
            ], offset);
        });
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
        this.instanceCount = instances.length;
    }

    render(timeSeconds, wind = FLAG_WIND_STRENGTH.normal) {
        const gl = this.gl;
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (!this.instanceCount) return;
        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.uniform1i(this.locations.uAtlas, 0);
        gl.uniform2f(this.locations.uResolution, this.logicalWidth, this.logicalHeight);
        gl.uniform1f(this.locations.uTime, timeSeconds);
        gl.uniform1f(this.locations.uWind, wind);
        gl.drawElementsInstanced(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0, this.instanceCount);
        gl.bindVertexArray(null);
    }
}

let battlefieldRenderer = null;
let battlefieldFailed = false;

function factionAppearance(camp, gameState) {
    const key = campToKey(camp);
    const faction = gameState?.factions?.[key] || camp || {};
    return {
        colors: getFlagColors(faction.colorId || faction.color),
        flagUrl: faction.flagUrl || null
    };
}

export function collectBattlefieldFlags(gameState, now) {
    const flags = [];
    for (const tile of gameState.tiles || []) {
        const cityFlag = tile.getFlagRenderData?.();
        if (cityFlag) {
            const appearance = factionAppearance(cityFlag.camp, gameState);
            flags.push({ ...cityFlag, ...appearance, phase: phaseFrom(`tile:${tile.id}`) });
        }
        const unit = tile.unit;
        if (!unit || tile.isCity || tile.isVillage || unit._airdropWaiting) continue;
        if ((unit._airliftLandAt && now < unit._airliftLandAt) || (unit._soulRecallLandAt && now < unit._soulRecallLandAt)) continue;
        const pos = getUnitVisualPos(unit);
        const appearance = factionAppearance(unit.camp, gameState);
        flags.push({
            x: pos.x + UNIT_FLAG_LAYOUT.poleX + UNIT_FLAG_LAYOUT.clothOffsetX,
            y: pos.y + UNIT_FLAG_LAYOUT.poleTop + UNIT_FLAG_LAYOUT.clothOffsetY,
            width: UNIT_FLAG_LAYOUT.width,
            height: UNIT_FLAG_LAYOUT.height,
            commander: !!unit.commander,
            phase: phaseFrom(`unit:${unit.id}`),
            ...appearance
        });
    }
    return flags;
}

export function drawBattlefieldFlags(ctx, gameState, now) {
    if (battlefieldFailed) return;
    try {
        if (!battlefieldRenderer) {
            battlefieldRenderer = new BatchedFlagRenderer(LOGICAL_W, LOGICAL_H, null, getCanvasPixelRatio());
        }
        battlefieldRenderer.setInstances(collectBattlefieldFlags(gameState, now));
        battlefieldRenderer.render(now / 1000, getFlagWindStrength(gameState.weather));
        ctx.drawImage(battlefieldRenderer.canvas, 0, 0, LOGICAL_W, LOGICAL_H);
    } catch (error) {
        battlefieldFailed = true;
        console.warn('[flagRenderer] WebGL2 旗帜渲染不可用:', error);
    }
}

export function createFlagPreview(canvas) {
    const logicalWidth = Number(canvas.getAttribute('width')) || canvas.width;
    const logicalHeight = Number(canvas.getAttribute('height')) || canvas.height;
    const renderer = new BatchedFlagRenderer(logicalWidth, logicalHeight, canvas, getCanvasPixelRatio());
    let previewInstance = null;
    return {
        setFaction(faction) {
            const colors = getFlagColors(faction?.colorId || faction?.color);
            // 为自由端的重力下垂和上下摆动预留透明空间，避免预览旗被画布裁切。
            const height = logicalHeight - 16;
            const width = height * 1.5;
            previewInstance = {
                x: (logicalWidth - width) / 2, y: 3, width, height,
                phase: 1.7, colors, flagUrl: faction?.flagUrl || null
            };
            renderer.setInstances([previewInstance]);
        },
        render(now) {
            // 数据 SVG 异步装入纹理图集后需要重新写入图集索引，才能从渐变旗切换到自定义徽记。
            if (previewInstance) renderer.setInstances([previewInstance]);
            renderer.render(now / 1000, FLAG_WIND_STRENGTH.normal);
        }
    };
}
