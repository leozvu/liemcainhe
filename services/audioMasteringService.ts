export interface AudioMasteringOptions {
  trimThresholdDb?: number;
  paddingMs?: number;
  targetRmsDb?: number;
  peakCeilingDb?: number;
  fadeMs?: number;
}

export interface AudioMasteringReport {
  duration: number;
  originalDuration: number;
  trimmedSeconds: number;
  gainDb: number;
  peakDb: number;
}

export interface SampleRange {
  start: number;
  end: number;
}

const dbToLinear = (db: number) => 10 ** (db / 20);
const linearToDb = (value: number) => 20 * Math.log10(Math.max(value, 1e-9));

export const findActiveSampleRange = (
  channels: Float32Array[],
  sampleRate: number,
  thresholdDb = -45,
  paddingMs = 60,
): SampleRange => {
  const length = channels[0]?.length || 0;
  if (!length) return { start: 0, end: 0 };
  const threshold = dbToLinear(thresholdDb);
  let start = 0;
  let end = length;
  while (start < length && channels.every((channel) => Math.abs(channel[start] || 0) < threshold)) start += 1;
  while (end > start && channels.every((channel) => Math.abs(channel[end - 1] || 0) < threshold)) end -= 1;
  const padding = Math.round(sampleRate * paddingMs / 1000);
  return { start: Math.max(0, start - padding), end: Math.min(length, end + padding) };
};

export const calculateMasteringGain = (
  channels: Float32Array[],
  range: SampleRange,
  targetRmsDb = -18,
  peakCeilingDb = -1,
): { gain: number; gainDb: number; peakDb: number } => {
  let sumSquares = 0;
  let samples = 0;
  let peak = 0;
  channels.forEach((channel) => {
    for (let index = range.start; index < range.end; index += 1) {
      const value = channel[index] || 0;
      sumSquares += value * value;
      peak = Math.max(peak, Math.abs(value));
      samples += 1;
    }
  });
  if (!samples || peak === 0) return { gain: 1, gainDb: 0, peakDb: -180 };
  const rms = Math.sqrt(sumSquares / samples);
  const rmsGain = dbToLinear(targetRmsDb - linearToDb(rms));
  const peakGain = dbToLinear(peakCeilingDb) / peak;
  const gain = Math.max(0.1, Math.min(8, rmsGain, peakGain));
  return { gain, gainDb: linearToDb(gain), peakDb: linearToDb(Math.min(1, peak * gain)) };
};

const encodeWav = (channels: Float32Array[], sampleRate: number): Blob => {
  const channelCount = channels.length;
  const sampleCount = channels[0]?.length || 0;
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + sampleCount * channelCount * bytesPerSample);
  const view = new DataView(buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + sampleCount * channelCount * bytesPerSample, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, sampleCount * channelCount * bytesPerSample, true);
  let offset = 44;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const value = Math.max(-1, Math.min(1, channels[channel][sample] || 0));
      view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
      offset += bytesPerSample;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
};

export const masterAudioBlob = async (
  blob: Blob,
  options: AudioMasteringOptions = {},
): Promise<{ blob: Blob; report: AudioMasteringReport }> => {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) throw new Error('Trình duyệt không hỗ trợ mastering âm thanh');
  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const sourceChannels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
    const range = findActiveSampleRange(sourceChannels, decoded.sampleRate, options.trimThresholdDb, options.paddingMs);
    const gain = calculateMasteringGain(sourceChannels, range, options.targetRmsDb, options.peakCeilingDb);
    const length = Math.max(1, range.end - range.start);
    const fadeSamples = Math.min(Math.round(decoded.sampleRate * (options.fadeMs ?? 12) / 1000), Math.floor(length / 2));
    const channels = sourceChannels.map((source) => {
      const output = new Float32Array(length);
      for (let index = 0; index < length; index += 1) {
        const fadeIn = fadeSamples ? Math.min(1, index / fadeSamples) : 1;
        const fadeOut = fadeSamples ? Math.min(1, (length - 1 - index) / fadeSamples) : 1;
        output[index] = Math.max(-1, Math.min(1, (source[range.start + index] || 0) * gain.gain * fadeIn * fadeOut));
      }
      return output;
    });
    return {
      blob: encodeWav(channels, decoded.sampleRate),
      report: {
        duration: length / decoded.sampleRate,
        originalDuration: decoded.duration,
        trimmedSeconds: Math.max(0, decoded.duration - length / decoded.sampleRate),
        gainDb: gain.gainDb,
        peakDb: gain.peakDb,
      },
    };
  } finally {
    void context.close();
  }
};
