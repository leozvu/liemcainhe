import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { ProjectState, Shot, VoiceTake } from '../types';
import { getActiveVideoModel } from './modelRegistry';
import { recordUsage } from './usageService';

const CORE_VERSION = '0.12.10';
const CORE_BASE_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`;
const MAX_INPUT_BYTES = 700 * 1024 * 1024;

let activeFfmpeg: FFmpeg | null = null;
let rendering = false;

export interface BrowserRenderProgress {
  phase: string;
  progress: number;
  detail?: string;
}

interface TimelineClip {
  shot: Shot;
  duration: number;
  offset: number;
}

const safeName = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9_-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80) || 'egoric-master';

const fileExtension = (url: string, fallback: string): string => {
  const clean = url.split('?')[0].split('#')[0];
  const match = clean.match(/\.([a-zA-Z0-9]{2,5})$/);
  return match?.[1]?.toLowerCase() || fallback;
};

const selectedVoiceTake = (project: ProjectState, shotId: string): VoiceTake | undefined => {
  const takeId = project.voiceStudio?.selectedTakeByShot[shotId];
  return project.voiceStudio?.takes.find((take) => take.id === takeId && take.status === 'ready' && take.audioUrl);
};

const timelineClips = (project: ProjectState): TimelineClip[] => {
  const shotMap = new Map(project.shots.map((shot) => [shot.id, shot]));
  const planned = project.creativeDirector?.timeline || [];
  const ordered: Array<{ shot: Shot; duration: number }> = [];
  const included = new Set<string>();
  planned.forEach((entry) => {
    const shot = shotMap.get(entry.shotId);
    if (!shot?.interval?.videoUrl || included.has(shot.id)) return;
    ordered.push({ shot, duration: Math.max(1, entry.duration || shot.interval.duration || 8) });
    included.add(shot.id);
  });
  project.shots.forEach((shot) => {
    if (!shot.interval?.videoUrl || included.has(shot.id)) return;
    ordered.push({ shot, duration: Math.max(1, shot.interval.duration || 8) });
  });
  let offset = 0;
  return ordered.map((item) => {
    const clip = { ...item, offset };
    offset += item.duration;
    return clip;
  });
};

const renderDimensions = (): { width: number; height: number } => {
  const ratio = getActiveVideoModel()?.params.defaultAspectRatio || '16:9';
  if (ratio === '9:16') return { width: 720, height: 1280 };
  if (ratio === '1:1') return { width: 720, height: 720 };
  return { width: 1280, height: 720 };
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

export const isBrowserMasterRenderSupported = (): boolean =>
  typeof window !== 'undefined'
  && typeof WebAssembly !== 'undefined'
  && typeof Worker !== 'undefined';

export const cancelBrowserMasterRender = (): void => {
  activeFfmpeg?.terminate();
  activeFfmpeg = null;
  rendering = false;
};

export const renderMasterVideoInBrowser = async (
  project: ProjectState,
  onProgress?: (progress: BrowserRenderProgress) => void,
): Promise<void> => {
  if (rendering) throw new Error('Một bản master khác đang được ghép trên thiết bị này.');
  if (!isBrowserMasterRenderSupported()) throw new Error('Trình duyệt này không hỗ trợ WebAssembly Worker để ghép video.');
  const clips = timelineClips(project);
  if (!clips.length) throw new Error('Chưa có đoạn video hoàn chỉnh để ghép.');

  const startedAt = Date.now();
  const files: string[] = [];
  const ffmpeg = new FFmpeg();
  activeFfmpeg = ffmpeg;
  rendering = true;
  let downloadedBytes = 0;

  try {
    onProgress?.({ phase: 'Đang tải bộ dựng cục bộ…', progress: 2, detail: 'FFmpeg chạy trên thiết bị, không tiêu tốn credit AI.' });
    const coreURL = await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, 'text/javascript');
    const wasmURL = await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, 'application/wasm');
    await ffmpeg.load({ coreURL, wasmURL });

    const { width, height } = renderDimensions();
    const normalizedFiles: string[] = [];
    for (let index = 0; index < clips.length; index += 1) {
      const clip = clips[index];
      const sourceFile = `source_${String(index + 1).padStart(3, '0')}.${fileExtension(clip.shot.interval!.videoUrl!, 'mp4')}`;
      const normalizedFile = `normalized_${String(index + 1).padStart(3, '0')}.mp4`;
      onProgress?.({
        phase: `Đang chuẩn hóa cảnh ${index + 1}/${clips.length}…`,
        progress: 8 + Math.round((index / clips.length) * 52),
        detail: clip.shot.actionSummary,
      });
      const source = await fetchFile(clip.shot.interval!.videoUrl!);
      downloadedBytes += source.byteLength;
      if (downloadedBytes > MAX_INPUT_BYTES) {
        throw new Error('Tổng video vượt 700 MB. Hãy xuất theo từng chương hoặc dùng render worker cloud.');
      }
      await ffmpeg.writeFile(sourceFile, source);
      files.push(sourceFile, normalizedFile);
      const duration = clip.duration.toFixed(3);
      const exitCode = await ffmpeg.exec([
        '-i', sourceFile,
        '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,fps=25,format=yuv420p,setsar=1,tpad=stop_mode=clone:stop_duration=${duration}`,
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

    const concatFile = 'egoric_concat.txt';
    const silentMaster = 'egoric_master_silent.mp4';
    files.push(concatFile, silentMaster);
    await ffmpeg.writeFile(concatFile, new TextEncoder().encode(normalizedFiles.map((file) => `file '${file}'`).join('\n')));
    onProgress?.({ phase: 'Đang ghép timeline…', progress: 64, detail: `${clips.length} cảnh · hard cut an toàn` });
    const concatExit = await ffmpeg.exec([
      '-f', 'concat',
      '-safe', '0',
      '-i', concatFile,
      '-c', 'copy',
      '-movflags', '+faststart',
      silentMaster,
    ]);
    if (concatExit !== 0) throw new Error('Không thể ghép timeline video.');

    const voiceInputs: Array<{ file: string; clip: TimelineClip }> = [];
    for (const clip of clips) {
      const take = selectedVoiceTake(project, clip.shot.id);
      if (!take?.audioUrl) continue;
      const voiceFile = `voice_${String(voiceInputs.length + 1).padStart(3, '0')}.${fileExtension(take.audioUrl, 'mp3')}`;
      const audio = await fetchFile(take.audioUrl);
      downloadedBytes += audio.byteLength;
      if (downloadedBytes > MAX_INPUT_BYTES) throw new Error('Tổng media vượt 700 MB. Hãy dùng render worker cloud.');
      await ffmpeg.writeFile(voiceFile, audio);
      files.push(voiceFile);
      voiceInputs.push({ file: voiceFile, clip });
    }

    const outputFile = 'egoric_master.mp4';
    files.push(outputFile);
    const totalDuration = clips.reduce((sum, clip) => sum + clip.duration, 0);
    onProgress?.({ phase: 'Đang trộn và cân bằng âm thanh…', progress: 76, detail: `${voiceInputs.length} bản thoại đã chọn` });
    let audioExit = 0;
    if (voiceInputs.length) {
      const args = ['-i', silentMaster];
      voiceInputs.forEach((voice) => args.push('-i', voice.file));
      const filters = voiceInputs.map((voice, index) => {
        const delayMs = Math.round(voice.clip.offset * 1000);
        return `[${index + 1}:a]atrim=0:${voice.clip.duration.toFixed(3)},asetpts=PTS-STARTPTS,adelay=delays=${delayMs}:all=1[v${index}]`;
      });
      const inputs = voiceInputs.map((_, index) => `[v${index}]`).join('');
      filters.push(`${inputs}amix=inputs=${voiceInputs.length}:duration=longest:dropout_transition=0,loudnorm=I=-16:LRA=11:TP=-1.5[aout]`);
      args.push(
        '-filter_complex', filters.join(';'),
        '-map', '0:v:0',
        '-map', '[aout]',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-t', totalDuration.toFixed(3),
        '-movflags', '+faststart',
        outputFile,
      );
      audioExit = await ffmpeg.exec(args);
    } else {
      audioExit = await ffmpeg.exec([
        '-i', silentMaster,
        '-f', 'lavfi',
        '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-t', totalDuration.toFixed(3),
        '-movflags', '+faststart',
        outputFile,
      ]);
    }
    if (audioExit !== 0) throw new Error('Không thể tạo track âm thanh cho bản master.');

    onProgress?.({ phase: 'Đang hoàn thiện MP4…', progress: 94 });
    const output = await ffmpeg.readFile(outputFile);
    if (!(output instanceof Uint8Array) || output.byteLength === 0) throw new Error('FFmpeg không trả về dữ liệu MP4 hợp lệ.');
    downloadBlob(new Blob([uint8BlobPart(output)], { type: 'video/mp4' }), `${safeName(project.title)}-master.mp4`);
    recordUsage({ kind: 'export', inputSize: downloadedBytes, durationMs: Date.now() - startedAt, status: 'success' });
    onProgress?.({ phase: 'Đã ghép và tải MP4', progress: 100, detail: 'Bản master được dựng hoàn toàn trên thiết bị.' });
  } catch (error) {
    recordUsage({
      kind: 'export',
      inputSize: downloadedBytes,
      durationMs: Date.now() - startedAt,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await cleanup(ffmpeg, files).catch(() => undefined);
    if (activeFfmpeg === ffmpeg) activeFfmpeg = null;
    rendering = false;
  }
};

