// Raw ESM deployments deliberately remain Canvas-only: browsers cannot
// resolve the bare pixi.js package specifier without Vite. Vite replaces
// import.meta.env in both dev and production builds, so the GPU backend is
// exposed only where its dependency graph is actually resolvable.
export const VITE_RUNTIME_AVAILABLE = Boolean(
    import.meta.env?.DEV || import.meta.env?.PROD
);
