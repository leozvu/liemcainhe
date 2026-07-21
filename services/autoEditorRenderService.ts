import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import {
  AspectRatio,
  AutoEditorCaptionCue,
  AutoEditorCaptionStyle,
  AutoEditorColorPreset,
  AutoEditorLogoPosition,
  AutoEditorTimelineClip,
  ProjectState,
  Shot,
  VoiceTake,
} from '../types';
import { getAutoEditorLogoUrl, normalizeAutoEditorState } from './autoEditorService';
import { recordUsage } from './usageService';

const CORE_VERSION = '0.12.10';
const CORE_BASE_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`;
const MAX_INPUT_BYTES = 700 * 1024 * 1024;

let activeFfmpeg: FFmpeg | null = null;
let rendering = false;

export interface AutoEditorRenderProgress {
  phase: string;
  progress: number;
  detail?: string;
}

interface RenderClip {
  shot: Shot;
  duration: number;
  offset: number;
  voiceTake?: VoiceTake;
}

const dimensionsForRatio = (ratio: AspectRatio): { width: number; height: number } => {
  if (ratio === '9:16') return { width: 720, height: 1280 };
  if (ratio === '1:1') return { width: 720, height: 720 };
  return { width: 1280, height: 720 };
};

const safeName = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9_-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 90) || 'egoric-video';

const extension = (url: string, fallback: string): string => {
  const match = url.split('?')[0].split('#')[0].match(/\.([a-zA-Z0-9]{2,5})$/);
  return match?.[1]?.toLowerCase() || fallback;
};

const uint8BlobPart = (value: Uint8Array): ArrayBuffer =>
  value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;

const downloadBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
};

const cleanup = async (ffmpeg: FFmpeg, files: string[]): Promise<void> => {
  await Promise.all(files.map((file) => ffmpeg.deleteFile(file).catch(() => undefined)));
};

const colorFilter = (preset: AutoEditorColorPreset): string[] => {
  if (preset === 'cinematic') return ['eq=contrast=1.08:saturation=0.92:brightness=-0.02'];
  if (preset === 'warm') return ['colorbalance=rs=.055:gs=.018:bs=-.045'];
  if (preset === 'cool') return ['colorbalance=rs=-.035:gs=.01:bs=.055'];
  if (preset === 'contrast') return ['eq=contrast=1.14:saturation=1.05'];
  return [];
};

const clipsFromTimeline = (project: ProjectState, timeline: AutoEditorTimelineClip[]): RenderClip[] => {
  const shots = new Map(project.shots.map((shot) => [shot.id, shot]));
  const takes = new Map((project.voiceStudio?.takes || []).map((take) => [take.id, take]));
  return timeline.map((clip) => {
    const shot = shots.get(clip.shotId);
    if (!shot?.interval?.videoUrl) throw new Error(`Cảnh ${clip.order + 1} chưa có video để render.`);
    const take = clip.voiceTakeId ? takes.get(clip.voiceTakeId) : undefined;
    return { shot, duration: clip.duration, offset: clip.offset, voiceTake: take?.audioUrl ? take : undefined };
  });
};

const roundRect = (context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void => {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
};

const wrapLines = (context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line);
  return lines.slice(0, 3);
};

const renderCaptionPng = async (
  cue: AutoEditorCaptionCue,
  outputWidth: number,
  outputHeight: number,
  style: AutoEditorCaptionStyle,
): Promise<Uint8Array> => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(outputWidth * 0.88);
  canvas.height = outputHeight > outputWidth ? 230 : 170;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Thiết bị không hỗ trợ lớp vẽ phụ đề.');
  const fontSize = outputHeight > outputWidth ? 44 : 40;
  context.font = `${style === 'clean' ? 700 : 800} ${fontSize}px Arial, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const lines = wrapLines(context, style === 'bold' ? cue.text.toLocaleUpperCase('vi') : cue.text, canvas.width - 56);
  const lineHeight = fontSize * 1.18;
  const totalHeight = lineHeight * lines.length;
  const startY = canvas.height / 2 - totalHeight / 2 + lineHeight / 2;
  if (style === 'boxed') {
    const widths = lines.map((line) => context.measureText(line).width);
    const boxWidth = Math.min(canvas.width - 20, Math.max(...widths, 180) + 48);
    const boxHeight = totalHeight + 34;
    roundRect(context, (canvas.width - boxWidth) / 2, (canvas.height - boxHeight) / 2, boxWidth, boxHeight, 18);
    context.fillStyle = 'rgba(4, 8, 12, .82)';
    context.fill();
  }
  context.lineJoin = 'round';
  context.miterLimit = 2;
  lines.forEach((line, index) => {
    const y = startY + index * lineHeight;
    context.strokeStyle = style === 'clean' ? 'rgba(0,0,0,.86)' : 'rgba(0,0,0,.96)';
    context.lineWidth = style === 'clean' ? 8 : 11;
    context.strokeText(line, canvas.width / 2, y);
    context.fillStyle = style === 'bold' ? '#d9fbff' : '#ffffff';
    context.fillText(line, canvas.width / 2, y);
  });
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Không thể tạo ảnh phụ đề.')), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
};

const logoPosition = (position: AutoEditorLogoPosition, margin: number): { x: string; y: string } => ({
  'top-left': { x: String(margin), y: String(margin) },
  'top-right': { x: `W-w-${margin}`, y: String(margin) },
  'bottom-left': { x: String(margin), y: `H-h-${margin}` },
  'bottom-right': { x: `W-w-${margin}`, y: `H-h-${margin}` },
}[position]);

export const isAutoEditorRenderSupported = (): boolean => typeof window !== 'undefined'
  && typeof document !== 'undefined'
  && typeof WebAssembly !== 'undefined'
  && typeof Worker !== 'undefined';

export const cancelAutoEditorRender = (): void => {
  activeFfmpeg?.terminate();
  activeFfmpeg = null;
  rendering = false;
};

export const renderAutoEditorOutputInBrowser = async (
  project: ProjectState,
  outputId: string,
  onProgress?: (progress: AutoEditorRenderProgress) => void,
): Promise<void> => {
  if (rendering) throw new Error('Một đầu ra khác đang được render trên thiết bị này.');
  if (!isAutoEditorRenderSupported()) throw new Error('Trình duyệt này không hỗ trợ FFmpeg WebAssembly.');
  const state = normalizeAutoEditorState(project.autoEditor, project);
  const output = state.outputs.find((item) => item.id === outputId);
  if (!output) throw new Error('Không tìm thấy đầu ra Auto Editor.');
  if (!state.timeline.length) throw new Error('Hãy lập timeline trước khi render.');
  const clips = clipsFromTimeline(project, state.timeline);
  const { width, height } = dimensionsForRatio(output.aspectRatio);
  const totalDuration = clips.reduce((sum, clip) => sum + clip.duration, 0);
  const startedAt = Date.now();
  const files: string[] = [];
  const ffmpeg = new FFmpeg();
  activeFfmpeg = ffmpeg;
  rendering = true;
  let downloadedBytes = 0;

  try {
    onProgress?.({ phase: 'Đang tải bộ dựng cục bộ…', progress: 2, detail: 'Không sử dụng credit AI.' });
    const coreURL = await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, 'text/javascript');
    const wasmURL = await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, 'application/wasm');
    await ffmpeg.load({ coreURL, wasmURL });

    const normalizedFiles: string[] = [];
    for (let index = 0; index < clips.length; index += 1) {
      const clip = clips[index];
      const sourceFile = `editor_source_${String(index + 1).padStart(3, '0')}.${extension(clip.shot.interval!.videoUrl!, 'mp4')}`;
      const normalizedFile = `editor_clip_${String(index + 1).padStart(3, '0')}.mp4`;
      const source = await fetchFile(clip.shot.interval!.videoUrl!);
      downloadedBytes += source.byteLength;
      if (downloadedBytes > MAX_INPUT_BYTES) throw new Error('Tổng media vượt 700 MB. Hãy chia video thành nhiều chương.');
      await ffmpeg.writeFile(sourceFile, source);
      files.push(sourceFile, normalizedFile);
      const duration = clip.duration.toFixed(3);
      const filters = [
        `scale=${width}:${height}:force_original_aspect_ratio=increase`,
        `crop=${width}:${height}`,
        `fps=${state.settings.fps}`,
        'format=yuv420p',
        'setsar=1',
        `tpad=stop_mode=clone:stop_duration=${duration}`,
        ...colorFilter(state.settings.colorPreset),
      ];
      if (state.settings.transition === 'crossfade' && clip.duration >= 1) {
        const fadeDuration = Math.min(0.22, clip.duration / 4);
        filters.push(`fade=t=in:st=0:d=${fadeDuration.toFixed(2)}`, `fade=t=out:st=${Math.max(0, clip.duration - fadeDuration).toFixed(2)}:d=${fadeDuration.toFixed(2)}`);
      }
      onProgress?.({ phase: `Đang dựng cảnh ${index + 1}/${clips.length}…`, progress: 8 + Math.round((index / clips.length) * 45), detail: clip.shot.actionSummary });
      const exitCode = await ffmpeg.exec([
        '-i', sourceFile,
        '-vf', filters.join(','),
        '-t', duration,
        '-an',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '23',
        '-movflags', '+faststart',
        normalizedFile,
      ]);
      if (exitCode !== 0) throw new Error(`Không thể chuẩn hóa cảnh ${index + 1}.`);
      normalizedFiles.push(normalizedFile);
      await ffmpeg.deleteFile(sourceFile).catch(() => undefined);
    }

    const concatFile = 'editor_concat.txt';
    const silentMaster = 'editor_master_silent.mp4';
    files.push(concatFile, silentMaster);
    await ffmpeg.writeFile(concatFile, new TextEncoder().encode(normalizedFiles.map((file) => `file '${file}'`).join('\n')));
    onProgress?.({ phase: 'Đang ghép timeline…', progress: 57, detail: `${clips.length} cảnh · ${output.aspectRatio}` });
    if (await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', '-movflags', '+faststart', silentMaster]) !== 0) {
      throw new Error('Không thể ghép timeline video.');
    }

    const args: string[] = ['-i', silentMaster];
    let inputIndex = 1;
    const voiceInputs: Array<{ index: number; clip: RenderClip }> = [];
    if (state.settings.includeVoice) {
      for (const clip of clips) {
        if (!clip.voiceTake?.audioUrl) continue;
        const file = `editor_voice_${String(voiceInputs.length + 1).padStart(3, '0')}.${extension(clip.voiceTake.audioUrl, 'mp3')}`;
        const audio = await fetchFile(clip.voiceTake.audioUrl);
        downloadedBytes += audio.byteLength;
        if (downloadedBytes > MAX_INPUT_BYTES) throw new Error('Tổng media vượt 700 MB. Hãy chia video thành nhiều chương.');
        await ffmpeg.writeFile(file, audio);
        files.push(file);
        args.push('-i', file);
        voiceInputs.push({ index: inputIndex, clip });
        inputIndex += 1;
      }
    }

    let musicInput: number | undefined;
    if (state.settings.musicEnabled && state.settings.musicUrl) {
      const musicFile = `editor_music.${extension(state.settings.musicUrl, 'mp3')}`;
      const music = await fetchFile(state.settings.musicUrl);
      downloadedBytes += music.byteLength;
      if (downloadedBytes > MAX_INPUT_BYTES) throw new Error('Tổng media vượt 700 MB. Hãy dùng tệp nhạc nhẹ hơn.');
      await ffmpeg.writeFile(musicFile, music);
      files.push(musicFile);
      args.push('-stream_loop', '-1', '-i', musicFile);
      musicInput = inputIndex;
      inputIndex += 1;
    }

    const captionInputs: Array<{ index: number; cue: AutoEditorCaptionCue; file: string }> = [];
    if (state.settings.captionsEnabled) {
      for (let index = 0; index < state.captions.length; index += 1) {
        const cue = state.captions[index];
        const file = `editor_caption_${String(index + 1).padStart(3, '0')}.png`;
        const png = await renderCaptionPng(cue, width, height, state.settings.captionStyle);
        await ffmpeg.writeFile(file, png);
        files.push(file);
        args.push('-loop', '1', '-framerate', String(state.settings.fps), '-i', file);
        captionInputs.push({ index: inputIndex, cue, file });
        inputIndex += 1;
      }
    }

    let logoInput: number | undefined;
    const logoUrl = getAutoEditorLogoUrl(project);
    if (state.settings.logoEnabled && logoUrl) {
      const logoFile = `editor_logo.${extension(logoUrl, 'png')}`;
      const logo = await fetchFile(logoUrl);
      await ffmpeg.writeFile(logoFile, logo);
      files.push(logoFile);
      args.push('-loop', '1', '-framerate', String(state.settings.fps), '-i', logoFile);
      logoInput = inputIndex;
      inputIndex += 1;
    }

    let silentAudioInput: number | undefined;
    if (!voiceInputs.length && musicInput === undefined) {
      args.push('-f', 'lavfi', '-t', totalDuration.toFixed(3), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
      silentAudioInput = inputIndex;
      inputIndex += 1;
    }

    const filters: string[] = [];
    let videoMap = '0:v:0';
    let videoLabel = '';
    captionInputs.forEach((caption, index) => {
      const source = index === 0 ? '[0:v]' : `[editor_v${index}]`;
      const target = `[editor_v${index + 1}]`;
      const margin = Math.round(height * (output.aspectRatio === '9:16' ? 0.10 : 0.06));
      filters.push(`${source}[${caption.index}:v]overlay=x=(W-w)/2:y=H-h-${margin}:enable='between(t,${caption.cue.start.toFixed(3)},${caption.cue.end.toFixed(3)})':eof_action=pass${target}`);
      videoLabel = target;
    });
    if (logoInput !== undefined) {
      const logoWidth = Math.round(width * (state.settings.logoSizePercent / 100));
      const logoLabel = '[editor_logo_scaled]';
      filters.push(`[${logoInput}:v]scale=${logoWidth}:-1${logoLabel}`);
      const source = videoLabel || '[0:v]';
      const target = '[editor_v_logo]';
      const margin = Math.round(Math.min(width, height) * 0.04);
      const position = logoPosition(state.settings.logoPosition, margin);
      filters.push(`${source}${logoLabel}overlay=x=${position.x}:y=${position.y}:eof_action=pass${target}`);
      videoLabel = target;
    }
    if (videoLabel) videoMap = videoLabel;

    let audioMap = '';
    if (voiceInputs.length) {
      voiceInputs.forEach((voice, index) => {
        const delay = Math.round(voice.clip.offset * 1000);
        filters.push(`[${voice.index}:a]atrim=0:${voice.clip.duration.toFixed(3)},asetpts=PTS-STARTPTS,adelay=delays=${delay}:all=1[editor_voice_${index}]`);
      });
      const voiceLabels = voiceInputs.map((_, index) => `[editor_voice_${index}]`).join('');
      filters.push(`${voiceLabels}amix=inputs=${voiceInputs.length}:duration=longest:dropout_transition=0,loudnorm=I=-16:LRA=11:TP=-1.5[editor_voice_mix]`);
      if (musicInput !== undefined) {
        const release = Math.round(clamp(Math.abs(state.settings.duckingDb) * 28, 180, 700));
        filters.push(`[${musicInput}:a]atrim=0:${totalDuration.toFixed(3)},asetpts=PTS-STARTPTS,volume=${state.settings.musicVolume.toFixed(3)}[editor_music]`);
        filters.push('[editor_voice_mix]asplit=2[editor_voice_sc][editor_voice_final]');
        filters.push(`[editor_music][editor_voice_sc]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=${release}[editor_music_ducked]`);
        filters.push('[editor_music_ducked][editor_voice_final]amix=inputs=2:duration=longest:dropout_transition=0,loudnorm=I=-14:LRA=11:TP=-1.5[editor_audio]');
        audioMap = '[editor_audio]';
      } else {
        audioMap = '[editor_voice_mix]';
      }
    } else if (musicInput !== undefined) {
      filters.push(`[${musicInput}:a]atrim=0:${totalDuration.toFixed(3)},asetpts=PTS-STARTPTS,volume=${state.settings.musicVolume.toFixed(3)},loudnorm=I=-18:LRA=11:TP=-2[editor_audio]`);
      audioMap = '[editor_audio]';
    } else if (silentAudioInput !== undefined) {
      audioMap = `${silentAudioInput}:a:0`;
    }

    const outputFile = 'egoric_auto_editor.mp4';
    files.push(outputFile);
    if (filters.length) args.push('-filter_complex', filters.join(';'));
    args.push('-map', videoMap, '-map', audioMap);
    if (videoLabel) args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22', '-pix_fmt', 'yuv420p');
    else args.push('-c:v', 'copy');
    args.push('-c:a', 'aac', '-b:a', '192k', '-t', totalDuration.toFixed(3), '-movflags', '+faststart', outputFile);
    onProgress?.({ phase: 'Đang trộn voice, nhạc và lớp thương hiệu…', progress: 76, detail: `${state.captions.length} cue phụ đề · ${voiceInputs.length} voice` });
    if (await ffmpeg.exec(args) !== 0) throw new Error('Không thể hoàn thiện video. Hãy thử tắt nhạc hoặc lớp logo rồi render lại.');

    onProgress?.({ phase: 'Đang đóng gói MP4…', progress: 95 });
    const result = await ffmpeg.readFile(outputFile);
    if (!(result instanceof Uint8Array) || !result.byteLength) throw new Error('FFmpeg không trả về MP4 hợp lệ.');
    downloadBlob(new Blob([uint8BlobPart(result)], { type: 'video/mp4' }), output.fileName || `${safeName(project.title)}-${output.aspectRatio.replace(':', 'x')}.mp4`);
    recordUsage({ kind: 'export', modelId: 'Egoric Auto Editor · Local FFmpeg', inputSize: downloadedBytes, durationMs: Date.now() - startedAt, status: 'success' });
    onProgress?.({ phase: 'Đã render và tải MP4', progress: 100, detail: 'Toàn bộ quá trình chạy trên thiết bị, chi phí API $0.' });
  } catch (error) {
    recordUsage({ kind: 'export', modelId: 'Egoric Auto Editor · Local FFmpeg', inputSize: downloadedBytes, durationMs: Date.now() - startedAt, status: 'failed', error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    await cleanup(ffmpeg, files).catch(() => undefined);
    if (activeFfmpeg === ffmpeg) activeFfmpeg = null;
    rendering = false;
  }
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
