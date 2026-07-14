export type RendererBackend = 'canvas2d' | 'pixi-webgl' | 'pixi-webgpu';
export type PerformanceProfile = 'auto' | 'high' | 'balanced' | 'low';
export type MotionMode = 'full' | 'static';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject { readonly [key: string]: JsonValue; }

export interface BattlefieldViewport {
    readonly width: number;
    readonly height: number;
    readonly pixelRatio: number;
}

export interface RenderPolicy {
    readonly requestedProfile: PerformanceProfile;
    readonly profile: Exclude<PerformanceProfile, 'auto'>;
    readonly maxPixelRatio: number;
    readonly pixelRatio: number;
    readonly effects: 'full' | 'reduced' | 'minimal';
    readonly targetFps: 30 | 60;
    readonly motionMode: MotionMode;
    readonly reducedMotion: boolean;
    readonly paused: boolean;
}

export interface RendererInitOptions {
    readonly backend?: RendererBackend;
    readonly width?: number;
    readonly height?: number;
    readonly viewport?: BattlefieldViewport;
    readonly devicePixelRatio?: number;
    readonly performanceProfile?: PerformanceProfile;
    readonly reducedMotion?: boolean;
    readonly paused?: boolean;
    readonly canvas?: HTMLCanvasElement;
}

export interface RenderFrame {
    readonly nowMs: number;
    readonly deltaMs: number;
    readonly frameId: number;
    readonly motionNowMs: number;
    readonly motionEnabled: boolean;
}

export interface BattlefieldRenderSnapshot extends JsonObject {
    readonly kind: 'blades-of-hex/battlefield';
    readonly version: number;
    readonly signature: string;
}

export interface BattlefieldVisualEvent extends JsonObject {
    readonly type: string;
}

export interface BattlefieldRenderer {
    readonly backend: RendererBackend;
    readonly policy: RenderPolicy | null;
    initialize(host: HTMLElement | HTMLCanvasElement | null, options: RendererInitOptions): Promise<void>;
    syncScene(snapshot: BattlefieldRenderSnapshot): void;
    enqueue(event: BattlefieldVisualEvent): void;
    resize(viewport: BattlefieldViewport): void;
    render(frame: Partial<RenderFrame>): unknown;
    destroy(): void;
}
