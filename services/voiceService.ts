import { VoiceProviderId } from '../types';
import { getVoiceCredentials } from './voiceRegistry';

export interface GenerateVoiceInput {
  providerId: VoiceProviderId;
  text: string;
  voiceId: string;
  speed: number;
  outputFormat: 'mp3' | 'wav';
}

export interface GenerateVoiceResult {
  audioUrl: string;
  fileName: string;
  duration?: number;
  remote?: boolean;
}

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

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Không thể đọc dữ liệu âm thanh'));
    reader.readAsDataURL(blob);
  });

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

const generateWithFpt = async (input: GenerateVoiceInput, apiKey: string): Promise<GenerateVoiceResult> => {
  const speed = Math.max(-3, Math.min(3, Math.round((input.speed - 1) * 5)));
  const response = await fetch('/api-proxy/fpt/hmi/tts/v5', {
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

  if (!response.ok) throw new Error(await parseErrorMessage(response));
  const payload = await response.json();
  if (payload.error !== 0 || !payload.async) {
    throw new Error(payload.message || 'FPT.AI không trả về đường dẫn âm thanh');
  }

  return {
    audioUrl: payload.async,
    fileName: `fpt-${payload.request_id || Date.now()}.${input.outputFormat}`,
    remote: true,
  };
};

const generateWithViettel = async (input: GenerateVoiceInput, token: string): Promise<GenerateVoiceResult> => {
  const response = await fetch('/api-proxy/viettel/tts/speech_synthesis', {
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

  if (!response.ok) throw new Error(await parseErrorMessage(response));
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = await response.json();
    throw new Error(payload.message || payload.error || 'Viettel AI không trả về âm thanh');
  }
  const audioUrl = await blobToDataUrl(await response.blob());
  return {
    audioUrl,
    fileName: `viettel-${Date.now()}.${input.outputFormat}`,
    duration: await getAudioDuration(audioUrl),
  };
};

const generateWithElevenLabs = async (input: GenerateVoiceInput, apiKey: string): Promise<GenerateVoiceResult> => {
  if (!input.voiceId.trim()) {
    throw new Error('Hãy nhập Voice ID của ElevenLabs trong hồ sơ nhân vật');
  }
  // PCM from ElevenLabs is headerless raw audio, so keep the browser workflow on
  // a universally playable MP3 even when the project requests WAV elsewhere.
  const outputFormat = 'mp3_44100_128';
  const response = await fetch(
    `/api-proxy/elevenlabs/v1/text-to-speech/${encodeURIComponent(input.voiceId)}?output_format=${outputFormat}`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: input.text,
        model_id: 'eleven_v3',
        language_code: 'vi',
        voice_settings: {
          stability: 0.48,
          similarity_boost: 0.78,
          style: 0.32,
          speed: Math.max(0.7, Math.min(1.2, input.speed)),
        },
      }),
    },
  );
  if (!response.ok) throw new Error(await parseErrorMessage(response));
  const audioUrl = await blobToDataUrl(await response.blob());
  return {
    audioUrl,
    fileName: `elevenlabs-${Date.now()}.mp3`,
    duration: await getAudioDuration(audioUrl),
  };
};

export const generateVoice = async (input: GenerateVoiceInput): Promise<GenerateVoiceResult> => {
  const text = input.text.trim();
  if (text.length < 3) throw new Error('Lời thoại phải có ít nhất 3 ký tự');
  if (text.length > 5000) throw new Error('Mỗi lượt tạo giọng chỉ hỗ trợ tối đa 5.000 ký tự');

  const credentials = getVoiceCredentials(input.providerId);
  if (!credentials.apiKey) throw new Error('Chưa cấu hình khóa API cho nhà cung cấp giọng nói');

  if (input.providerId === 'fpt') return generateWithFpt(input, credentials.apiKey);
  if (input.providerId === 'viettel') return generateWithViettel(input, credentials.apiKey);
  if (input.providerId === 'elevenlabs') return generateWithElevenLabs(input, credentials.apiKey);
  if (input.providerId === 'vbee') {
    throw new Error('Vbee yêu cầu máy chủ callback công khai. Hãy dùng FPT.AI/Viettel AI trong bản web hoặc nhập bản thu đã tạo từ Vbee.');
  }
  throw new Error('Giọng người thật cần được tải lên từ tệp âm thanh');
};

export const audioFileToDataUrl = async (file: File): Promise<{ audioUrl: string; duration?: number }> => {
  if (!file.type.startsWith('audio/')) throw new Error('Vui lòng chọn tệp âm thanh');
  if (file.size > 25 * 1024 * 1024) throw new Error('Tệp âm thanh không được vượt quá 25 MB');
  const audioUrl = await blobToDataUrl(file);
  return { audioUrl, duration: await getAudioDuration(audioUrl) };
};
