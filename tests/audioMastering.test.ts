import { describe, expect, it } from 'vitest';
import { calculateMasteringGain, findActiveSampleRange } from '../services/audioMasteringService';

describe('audio mastering', () => {
  it('cắt khoảng lặng nhưng giữ padding', () => {
    const channel = new Float32Array(1000);
    channel.fill(0.25, 300, 700);
    expect(findActiveSampleRange([channel], 1000, -40, 50)).toEqual({ start: 250, end: 750 });
  });

  it('không khuếch đại vượt trần peak', () => {
    const channel = new Float32Array([0.1, 0.5, -0.9, 0.2]);
    const result = calculateMasteringGain([channel], { start: 0, end: channel.length }, -8, -1);
    expect(result.gain).toBeLessThanOrEqual(10 ** (-1 / 20) / 0.9 + 1e-6);
    expect(result.peakDb).toBeLessThanOrEqual(-0.99);
  });
});
