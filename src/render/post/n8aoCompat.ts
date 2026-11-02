/**
 * n8ao@2.0.1 ↔ three r187 compatibility shim.
 *
 * For half-resolution AO, n8ao allocates a 2-attachment render target through its own
 * "WebGLMultipleRenderTargets" subclass whose `texture` getter returns the whole `textures`
 * ARRAY (the pre-r162 API). three r187's WebGLTextures.setupRenderTarget reads
 * `renderTarget.texture.mipmaps.length`, which throws on an array. n8ao itself only ever reads
 * `.textures[i]`, so we redefine `texture` on that instance to return the first attachment
 * (the modern three contract) every time n8ao (re)creates the target.
 */
import type { N8AOPostPass } from 'n8ao';

interface N8AOInternals {
  depthDownsampleTarget?: { textures: unknown[]; texture: unknown } | null;
  configureHalfResTargets: () => void;
}

function fixTarget(p: N8AOInternals) {
  const t = p.depthDownsampleTarget;
  if (!t || !Array.isArray(t.texture)) return;
  Object.defineProperty(t, 'texture', {
    configurable: true,
    get(this: { textures: unknown[] }) {
      return this.textures[0];
    },
    set(this: { textures: unknown[] }, v: unknown) {
      this.textures[0] = v;
    },
  });
}

/** Call right after `new N8AOPostPass(...)`, before touching `configuration.halfRes`. */
export function patchN8AO(pass: N8AOPostPass): void {
  const p = pass as unknown as N8AOInternals;
  const orig = p.configureHalfResTargets.bind(p);
  p.configureHalfResTargets = () => {
    orig();
    fixTarget(p);
  };
  fixTarget(p);
}
