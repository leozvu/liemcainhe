import { PronunciationEntry, VoiceEmotion, VoiceProviderId } from '../types';
import { MediaExecutionContext } from '../types/model';
import { getVoiceCredentials, getVoiceProvider } from './voiceRegistry';
import { assertUsageAllowed, recordUsage } from './usageService';
import { AudioMasteringReport, masterAudioBlob } from './audioMasteringService';
import {
  BillableOperationHooks,
  buildMediaInputSignature,
  createBillableHttpError,
  createConfirmedBillableFailure,
  executeBillableMedia,
  submitPaidTaskSafely,
} from './mediaExecutionService';

export interface GenerateVoiceInput {
  providerId: VoiceProviderId;
  text: string;
  voiceId: string;
  speed: number;
  pitch?: number;
  emotion?: VoiceEmotion;
  pronunciationDictionary?: PronunciationEntry[];
  outputFormat: 'mp3' | 'wav';
  masterAudio?: boolean;
  usageResourceId?: string;
  execution?: MediaExecutionContext;
}

export interface GenerateVoiceResult {
  audioUrl: string;
  fileName: string;
  duration?: number;
  remote?: boolean;
  mastering?: AudioMasteringReport;
  masteringSkippedReason?: string;
}

export interface ElevenLabsVoice {
  id: string;
  name: string;
  description?: string;
  accent?: string;
  gender?: string;
  previewUrl?: string;
}

interface ElevenLabsVoicePayload {
  voice_id?: unknown;
  name?: unknown;
  description?: unknown;
  preview_url?: unknown;
  labels?: unknown;
}

let cachedElevenLabsCatalog: { apiKey: string; voices: ElevenLabsVoice[] } | null = null;

const parseErrorMessage = async (response: Response): Promise<string> => {
  const fallback = `Yêu cầu thất bại (${response.status})`;
  try {
    const payload = await response.clone().json();
    return payload?.detail?.message || payload?.message || payload?.error?.message || payload?.error || fallback;
  } catch {
    try {
      const text = await response.text();
      return text.trim() || fallback;
    } catch {
      return fallback;
    }
  }
};

export const parseElevenLabsVoiceCatalog = (payload: unknown): ElevenLabsVoice[] => {
  const entries = Array.isArray((payload as { voices?: unknown })?.voices)
    ? (payload as { voices: ElevenLabsVoicePayload[] }).voices
    : [];
  return entries
    .filter((voice) => typeof voice.voice_id === 'string' && typeof voice.name === 'string')
    .map((voice) => {
      const labels = voice.labels && typeof voice.labels === 'object'
        ? voice.labels as Record<string, unknown>
        : {};
      return {
        id: String(voice.voice_id),
        name: String(voice.name),
        description: typeof voice.description === 'string' ? voice.description : undefined,
        accent: typeof labels.accent === 'string' ? labels.accent : undefined,
        gender: typeof labels.gender === 'string' ? labels.gender : undefined,
        previewUrl: typeof voice.preview_url === 'string' ? voice.preview_url : undefined,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'vi'));
};

export const fetchElevenLabsVoices = async (apiKey?: string, force = false): Promise<ElevenLabsVoice[]> => {
  const key = apiKey?.trim() || getVoiceCredentials('elevenlabs').apiKey;
  if (!key) throw new Error('Chưa có khóa ElevenLabs. Hãy mở Kết nối giọng nói và nhập khóa trước.');
  if (!force && cachedElevenLabsCatalog?.apiKey === key) return cachedElevenLabsCatalog.voices;

  const response = await fetch('/api-proxy/elevenlabs/v2/voices?page_size=100&include_total_count=false', {
    headers: { Accept: 'application/json', 'xi-api-key': key },
  });
  if (!response.ok) {
    const detail = await parseErrorMessage(response);
    if (response.status === 401) throw new Error('Khóa ElevenLabs không hợp lệ hoặc đã hết hiệu lực. Hãy tạo khóa mới rồi thử lại.');
    if (response.status === 403) throw new Error('Khóa ElevenLabs đang bị giới hạn quyền hoặc IP. Hãy bật quyền Voices và Text to Speech cho khóa.');
    throw new Error(`Không thể tải thư viện giọng ElevenLabs: ${detail}`);
  }
  const voices = parseElevenLabsVoiceCatalog(await response.json());
  if (!voices.length) throw new Error('Khóa hợp lệ nhưng tài khoản chưa có giọng khả dụng. Hãy thêm một giọng vào My Voices trên ElevenLabs.');
  cachedElevenLabsCatalog = { apiKey: key, voices };
  return voices;
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Không thể đọc dữ liệu âm thanh'));
    reader.readAsDataURL(blob);
  });

const masterGeneratedAudio = async (result: GenerateVoiceResult): Promise<GenerateVoiceResult> => {
  if (result.remote) return { ...result, masteringSkippedReason: 'Nguồn âm thanh bất đồng bộ chưa cho phép trình duyệt xử lý trực tiếp.' };
  try {
    const source = await fetch(result.audioUrl).then((response) => response.blob());
    const mastered = await masterAudioBlob(source);
    const baseName = result.fileName.replace(/\.[a-z0-9]{2,5}$/i, '');
    return {
      ...result,
      audioUrl: await blobToDataUrl(mastered.blob),
      fileName: `${baseName}-master.wav`,
      duration: mastered.report.duration,
      mastering: mastered.report,
    };
  } catch (error) {
    console.warn('Mastering tự động không khả dụng; giữ nguyên bản giọng gốc.', error);
    return { ...result, masteringSkippedReason: error instanceof Error ? error.message : 'Không thể giải mã âm thanh nguồn.' };
  }
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const applyPronunciationDictionary = (text: string, entries: PronunciationEntry[] = []): string =>
  entries.reduce((current, entry) => {
    const source = entry.source.trim();
    const replacement = entry.replacement.trim();
    if (!source || !replacement) return current;
    return current.replace(new RegExp(escapeRegex(source), 'giu'), replacement);
  }, text);

export const createVoiceSourceHash = (text: string, voiceId: string, speed: number, emotion: VoiceEmotion, pitch: number): string => {
  const value = `${text}|${voiceId}|${speed}|${emotion}|${pitch}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

export const getAudioDuration = (audioUrl: string): Promise<number | undefined> =>
  new Promise((resolve) => {
    const audio = new Audio();
    const done = (value?: number) => {
      audio.removeAttribute('src');
      resolve(value);
    };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : undefined);
    audio.onerror = () => done(undefined);
    audio.src = audioUrl;
  });

const generateWithFpt = async (
  input: GenerateVoiceInput,
  apiKey: string,
  hooks: BillableOperationHooks,
): Promise<GenerateVoiceResult> => {
  const speed = Math.max(-3, Math.min(3, Math.round((input.speed - 1) * 5)));
  const response = await submitPaidTaskSafely(async () => {
    const next = await fetch('/api-proxy/fpt/hmi/tts/v5', {
      method: 'POST',
      headers: {
        api_key: apiKey,
        voice: input.voiceId || 'banmai',
        speed: String(speed),
        format: input.outputFormat,
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: input.text,
    });
    if (!next.ok) throw createBillableHttpError(await parseErrorMessage(next), next.status);
    return next;
  });

  await hooks.onProviderAccepted();
  const payload = await response.json();
  if (payload.error !== 0 || !payload.async) {
    throw createConfirmedBillableFailure(payload.message || 'FPT.AI không trả về đường dẫn âm thanh');
  }
  if (payload.request_id) await hooks.onProviderTaskId(String(payload.request_id));

  return {
    audioUrl: payload.async,
    fileName: `fpt-${payload.request_id || Date.now()}.${input.outputFormat}`,
    remote: true,
  };
};

const generateWithViettel = async (
  input: GenerateVoiceInput,
  token: string,
  hooks: BillableOperationHooks,
): Promise<GenerateVoiceResult> => {
  const response = await submitPaidTaskSafely(async () => {
    const next = await fetch('/api-proxy/viettel/tts/speech_synthesis', {
      method: 'POST',
      headers: { Accept: '*/*', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: input.text,
        voice: input.voiceId || 'hn-thanhphuong',
        speed: Math.max(0.8, Math.min(1.2, input.speed)),
        tts_return_option: input.outputFormat === 'wav' ? 2 : 3,
        token,
        without_filter: false,
      }),
    });
    if (!next.ok) throw createBillableHttpError(await parseErrorMessage(next), next.status);
    return next;
  });

  await hooks.onProviderAccepted();
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = await response.json();
    throw createConfirmedBillableFailure(payload.message || payload.error || 'Viettel AI không trả về âm thanh');
  }
  const audioUrl = await blobToDataUrl(await response.blob());
  return {
    audioUrl,
    fileName: `viettel-${Date.now()}.${input.outputFormat}`,
    duration: await getAudioDuration(audioUrl),
  };
};

export const buildElevenLabsRequestBody = (input: Pick<GenerateVoiceInput, 'text' | 'emotion'>) => ({
  text: input.text,
  model_id: 'eleven_v3',
  language_code: 'vi',
  voice_settings: {
    stability: input.emotion === 'dramatic' ? 0.35 : input.emotion === 'intimate' ? 0.65 : 0.5,
    similarity_boost: 0.78,
    use_speaker_boost: true,
  },
});

const generateWithElevenLabs = async (
  input: GenerateVoiceInput,
  apiKey: string,
  hooks: BillableOperationHooks,
): Promise<GenerateVoiceResult> => {
  if (!input.voiceId.trim()) {
    throw new Error('Hãy nhập Voice ID của ElevenLabs trong hồ sơ nhân vật');
  }
  // PCM from ElevenLabs is headerless raw audio, so keep the browser workflow on
  // a universally playable MP3 even when the project requests WAV elsewhere.
  const outputFormat = 'mp3_44100_128';
  const response = await submitPaidTaskSafely(async () => {
    const next = await fetch(
      `/api-proxy/elevenlabs/v1/text-to-speech/${encodeURIComponent(input.voiceId)}?output_format=${outputFormat}`,
      {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildElevenLabsRequestBody(input)),
      },
    );
    if (next.ok) return next;
    const detail = await parseErrorMessage(next);
    if (next.status === 401) throw createBillableHttpError('Khóa ElevenLabs không hợp lệ hoặc đã hết hiệu lực.', next.status);
    if (next.status === 403) throw createBillableHttpError('Khóa ElevenLabs không có quyền Text to Speech hoặc đang bị giới hạn IP.', next.status);
    if (next.status === 422) throw createBillableHttpError(`ElevenLabs từ chối cấu hình giọng hoặc Voice ID: ${detail}`, next.status);
    throw createBillableHttpError(`ElevenLabs không thể tạo giọng: ${detail}`, next.status);
  });
  await hooks.onProviderAccepted();
  const audioUrl = await blobToDataUrl(await response.blob());
  return {
    audioUrl,
    fileName: `elevenlabs-${Date.now()}.mp3`,
    duration: await getAudioDuration(audioUrl),
  };
};

export const buildShopAIKeyTtsRequestBody = (
  input: Pick<GenerateVoiceInput, 'text' | 'voiceId'>,
) => ({
  text: input.text,
  model: 'gemini-2.5-flash-preview-tts',
  voice: input.voiceId || 'Kore',
});

const generateWithShopAIKey = async (
  input: GenerateVoiceInput,
  apiKey: string,
  hooks: BillableOperationHooks,
): Promise<GenerateVoiceResult> => {
  const response = await submitPaidTaskSafely(async () => {
    const next = await fetch('/api-proxy/shopaikey/tts/google/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(buildShopAIKeyTtsRequestBody(input)),
    });
    if (next.ok) return next;
    const detail = await parseErrorMessage(next);
    if (next.status === 401) throw createBillableHttpError('Khóa ShopAIKey không hợp lệ hoặc đã bị thu hồi.', next.status);
    if (next.status === 402) throw createBillableHttpError('Khóa ShopAIKey không còn đủ credit để tạo giọng.', next.status);
    throw createBillableHttpError(`ShopAIKey TTS không thể tạo giọng: ${detail}`, next.status);
  });
  await hooks.onProviderAccepted();
  const payload = await response.json();
  const audioUrl = String(payload?.url || payload?.data?.url || '').trim();
  if (!audioUrl) {
    throw new Error('ShopAIKey đã nhận tác vụ TTS nhưng không trả về URL âm thanh. Hãy đối soát request trước khi chạy lại.');
  }
  return {
    audioUrl,
    fileName: `shopaikey-${Date.now()}.${payload?.format || 'wav'}`,
    remote: true,
  };
};

export const generateVoice = async (input: GenerateVoiceInput): Promise<GenerateVoiceResult> => {
  const text = applyPronunciationDictionary(input.text.trim(), input.pronunciationDictionary);
  if (text.length < 3) throw new Error('Lời thoại phải có ít nhất 3 ký tự');
  if (text.length > 5000) throw new Error('Mỗi lượt tạo giọng chỉ hỗ trợ tối đa 5.000 ký tự');

  assertUsageAllowed();

  const credentials = getVoiceCredentials(input.providerId);
  if (!credentials.apiKey) {
    throw new Error(input.providerId === 'shopaikey'
      ? 'Chưa có khóa ShopAIKey. Hãy mở Cổng AI nội bộ và nhập khóa trước.'
      : input.providerId === 'elevenlabs'
      ? 'Chưa có khóa ElevenLabs. Hãy mở Kết nối giọng nói và nhập khóa trước.'
      : 'Chưa cấu hình khóa API cho nhà cung cấp giọng nói');
  }

  const preparedInput = { ...input, text };
  const startedAt = Date.now();
  const provider = getVoiceProvider(input.providerId);
  return executeBillableMedia({
    context: input.execution,
    mediaType: 'voice',
    resourceId: input.usageResourceId,
    inputSignature: buildMediaInputSignature({
      providerId: input.providerId,
      text,
      voiceId: input.voiceId,
      speed: input.speed,
      pitch: input.pitch,
      emotion: input.emotion,
      outputFormat: input.outputFormat,
      masterAudio: input.masterAudio,
    }),
    operation: async (hooks) => {
      try {
        let result: GenerateVoiceResult;
        if (input.providerId === 'shopaikey') result = await generateWithShopAIKey(preparedInput, credentials.apiKey, hooks);
        else if (input.providerId === 'fpt') result = await generateWithFpt(preparedInput, credentials.apiKey, hooks);
        else if (input.providerId === 'viettel') result = await generateWithViettel(preparedInput, credentials.apiKey, hooks);
        else if (input.providerId === 'elevenlabs') result = await generateWithElevenLabs(preparedInput, credentials.apiKey, hooks);
        else if (input.providerId === 'vbee') {
          throw new Error('Vbee yêu cầu máy chủ callback công khai. Hãy dùng FPT.AI/Viettel AI trong bản web hoặc nhập bản thu đã tạo từ Vbee.');
        } else throw new Error('Giọng người thật cần được tải lên từ tệp âm thanh');
        const finalResult = input.masterAudio ? await masterGeneratedAudio(result) : result;
        recordUsage({ kind: 'voice', providerId: input.providerId, modelId: provider.shortName, resourceId: input.usageResourceId, inputSize: text.length, durationMs: Date.now() - startedAt, status: 'success' });
        return finalResult;
      } catch (error) {
        recordUsage({ kind: 'voice', providerId: input.providerId, modelId: provider.shortName, resourceId: input.usageResourceId, durationMs: Date.now() - startedAt, status: 'failed', error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },
  });
};

export const audioFileToDataUrl = async (file: File, masterAudio = false): Promise<{ audioUrl: string; duration?: number; fileName?: string; mastering?: AudioMasteringReport }> => {
  if (!file.type.startsWith('audio/')) throw new Error('Vui lòng chọn tệp âm thanh');
  if (file.size > 25 * 1024 * 1024) throw new Error('Tệp âm thanh không được vượt quá 25 MB');
  if (masterAudio) {
    const mastered = await masterAudioBlob(file);
    return {
      audioUrl: await blobToDataUrl(mastered.blob),
      duration: mastered.report.duration,
      fileName: `${file.name.replace(/\.[a-z0-9]{2,5}$/i, '')}-master.wav`,
      mastering: mastered.report,
    };
  }
  const audioUrl = await blobToDataUrl(file);
  return { audioUrl, duration: await getAudioDuration(audioUrl), fileName: file.name };
};
