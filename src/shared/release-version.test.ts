import { describe, expect, it } from 'vitest';
import manifest from '../../manifest.json';
import project from '../../package.json';
import lock from '../../package-lock.json';

describe('plugin release version', () => {
  it('injects into all matching frames including origin-inherited blank/srcdoc documents', () => {
    expect(manifest.content_scripts[0]).toMatchObject({ all_frames: true, match_about_blank: true, match_origin_as_fallback: true });
  });

  it('keeps the manifest and package lock versions synchronized', () => {
    expect(manifest.version).toBe(project.version);
    expect(lock.version).toBe(project.version);
    expect(lock.packages[''].version).toBe(project.version);
  });
});
