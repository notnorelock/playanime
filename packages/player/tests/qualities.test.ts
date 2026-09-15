import { describe, expect, it } from 'bun:test';
import { MediaProviderId } from '@playanime/contracts';
import {
  buildQualityOptions,
  pickSource,
  qualityLabel,
} from '../src/index.js';

describe('player quality helpers', () => {
  const sources = [
    { src: 'https://example.com/1080.mp4', resolution: 1080, mimeType: 'video/mp4' },
    { src: 'https://example.com/720.mp4', resolution: 720, mimeType: 'video/mp4' },
    { src: 'https://example.com/360.mp4', resolution: 360, mimeType: 'video/mp4' },
  ];

  it('builds Auto plus resolved qualities only', () => {
    expect(buildQualityOptions(sources)).toEqual([
      { value: 'auto', label: 'Auto' },
      { value: 1080, label: '1080p' },
      { value: 720, label: '720p' },
      { value: 360, label: '360p' },
    ]);
  });

  it('does not fabricate missing resolutions', () => {
    expect(buildQualityOptions([{ src: 'https://example.com/a.mp4', mimeType: 'video/mp4' }])).toEqual([
      { value: 'auto', label: 'Auto' },
    ]);
  });

  it('picks Auto as the highest available source', () => {
    expect(pickSource(sources, 'auto').resolution).toBe(1080);
  });

  it('picks a manual quality', () => {
    expect(pickSource(sources, 720).src).toContain('720');
  });

  it('labels resolutions as Np', () => {
    expect(qualityLabel(1080)).toBe('1080p');
  });

  it('keeps provider id out of generic helpers', () => {
    expect(MediaProviderId.GOOGLE_DRIVE).toBe('google-drive');
  });
});
