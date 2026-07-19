// Author: forsearch | Updated: 2026-04-30
import { ScriptData, Shot, Character, Scene, AspectRatio, VideoDuration } from "../types";
import { DEFAULT_CHAT_MODEL_ID, DEFAULT_IMAGE_MODEL_ID, DEFAULT_VIDEO_MODEL_ID } from '../types/model';
import {
  shouldUseImagesGenerationsEndpoint,
  callImagesGenerationsApi,
  extractImageFromApiResponse,
  normalizeImageResult,
} from './imageGenerationHelpers';
import { addRenderLogWithTokens } from './renderLogService';
import { throwFromVideoHttpError, formatVideoTaskErrorForUser } from './videoHttpErrors';
import { resolveSoraVideoDownloadId, downloadSoraCompletedVideo, encodeVideoPathId } from './soraVideoResolve';
import { 
  getGlobalApiKey as getRegistryApiKey,
  setGlobalApiKey as setRegistryApiKey,
  getApiBaseUrlForModel,
  getApiKeyForModel,
  getModelById,
  getModels,
  getActiveModel,
  getActiveChatModel,
  getActiveVideoModel,
  getActiveImageModel,
} from './modelRegistry';

export class ApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiKeyError';
  }
}

let runtimeApiKey: string = process.env.API_KEY || "";

export const setGlobalApiKey = (key: string) => {
  runtimeApiKey = key;
  setRegistryApiKey(key);
};

const resolveModel = (type: 'chat' | 'image' | 'video', modelId?: string) => {
  if (modelId) {
    const model = getModelById(modelId);
    if (model && model.type === type) return model;
    const candidates = getModels(type).filter(m => m.apiModel === modelId);
    if (candidates.length === 1) return candidates[0];
  }
  return getActiveModel(type);
};

const resolveRequestModel = (type: 'chat' | 'image' | 'video', modelId?: string): string => {
  const resolved = resolveModel(type, modelId);
  return resolved?.apiModel || resolved?.id || modelId || '';
};

const checkApiKey = (type: 'chat' | 'image' | 'video' = 'chat', modelId?: string) => {
  const resolvedModel = resolveModel(type, modelId);
  
  if (resolvedModel) {
    const modelApiKey = getApiKeyForModel(resolvedModel.id);
    if (modelApiKey) return modelApiKey;
  }
  
  const registryKey = getRegistryApiKey();
  if (registryKey) return registryKey;
  
  if (!runtimeApiKey) throw new ApiKeyError('Thiếu API Key. Hãy thiết lập khóa trong phần cấu hình mô hình.');
  return runtimeApiKey;
};

const DEFAULT_API_BASE = 'https://api.gitcc.com';

const SCRIPT_INPUT_MAX_CHARS = 120000;
const LONG_FORM_MAX_TOKENS = 32768;
const PARAGRAPHS_CHUNK_MAX_TOKENS = 8192;

const getApiBase = (type: 'chat' | 'image' | 'video' = 'chat', modelId?: string): string => {
  try {
    const resolvedModel = resolveModel(type, modelId);
    if (resolvedModel) {
      return getApiBaseUrlForModel(resolvedModel.id);
    }
    return getDefaultApiBase();
  } catch (e) {
    return getDefaultApiBase();
  }
};

const getDefaultApiBase = (): string => {
  if (typeof window !== 'undefined') {
    const o = window.location.origin;
    const isLocal = o.startsWith('http://localhost') || o.startsWith('http://127.0.0.1') || o.startsWith('https://localhost') || o.startsWith('https://127.0.0.1');
    if (isLocal && DEFAULT_API_BASE === 'https://api.gitcc.com') return '/api-proxy';
  }
  return DEFAULT_API_BASE;
};

const getActiveChatModelName = (): string => {
  try {
    const model = getActiveChatModel();
    return model?.apiModel || model?.id || DEFAULT_CHAT_MODEL_ID;
  } catch (e) {
    return DEFAULT_CHAT_MODEL_ID;
  }
};

const getVeoModelName = (hasReferenceImage: boolean, aspectRatio: AspectRatio): string => {
  const orientation = aspectRatio === '9:16' ? 'portrait' : 'landscape';
  
  if (hasReferenceImage) {
    return `veo_3_1_i2v_s_fast_fl_${orientation}`;
  } else {
    return `veo_3_1_t2v_fast_${orientation}`;
  }
};

const getSoraVideoSize = (aspectRatio: AspectRatio): string => {
  const sizeMap: Record<AspectRatio, string> = {
    '16:9': '1280x720',
    '9:16': '720x1280',
    '1:1': '720x720',
  };
  return sizeMap[aspectRatio];
};

const ANTSK_API_BASE = DEFAULT_API_BASE;

export const verifyApiKey = async (key: string): Promise<{ success: boolean; message: string }> => {
  try {
    const apiBase = getApiBase('chat');
    const response = await fetch(`${apiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: DEFAULT_CHAT_MODEL_ID,
        messages: [{ role: 'user', content: 'Chỉ trả về số 1' }],
        temperature: 0.1,
        max_tokens: 5
      })
    });

    if (!response.ok) {
      let errorMessage = `Xác thực thất bại: ${response.status}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error?.message || errorMessage;
      } catch (e) {
        // ignore
      }
      return { success: false, message: errorMessage };
    }

    const data = await response.json();
    if (data.choices?.[0]?.message?.content !== undefined) {
      return { success: true, message: 'Xác thực API Key thành công' };
    } else {
      return { success: false, message: 'Định dạng phản hồi không hợp lệ' };
    }
  } catch (error: any) {
    return { success: false, message: error.message || 'Lỗi mạng' };
  }
};

/**
 * Thử lại các thao tác gặp giới hạn 429, hết thời gian chờ hoặc lỗi tạm thời.
 * @param operation - Thao tác bất đồng bộ cần thực thi.
 * @param maxRetries - Số lần thử tối đa, mặc định là 3.
 * @param baseDelay - Độ trễ cơ sở tính bằng mili giây, dùng chiến lược lùi theo cấp số nhân.
 * @returns Kết quả thao tác.
 * @throws Lỗi cuối cùng khi mọi lần thử đều thất bại.
 */
const retryOperation = async <T>(operation: () => Promise<T>, maxRetries: number = 3, baseDelay: number = 2000): Promise<T> => {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (e: any) {
      lastError = e;
      // Xác định lỗi có thể thử lại.
      const isRetryableError = 
        e.status === 429 || 
        e.status === 502 ||
        e.status === 503 ||
        e.code === 429 || 
        e.status === 504 ||
        e.message?.includes('429') || 
        e.message?.includes('502') ||
        e.message?.includes('503') ||
        e.message?.includes('quota') || 
        e.message?.includes('RESOURCE_EXHAUSTED') ||
        e.message?.includes('overloaded') ||
        e.message?.includes('cpu overloaded') ||
        e.message?.includes('hết thời gian') ||
        e.message?.includes('timeout') ||
        e.message?.includes('Gateway Timeout') ||
        e.message?.includes('504') ||
        e.message?.includes('ECONNRESET') ||
        e.message?.includes('ETIMEDOUT') ||
        e.message?.includes('network') ||
        e.status >= 500;
      
      if (isRetryableError && i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i);
        console.warn(`Yêu cầu thất bại, đang thử lại lần ${i + 1}/${maxRetries} sau ${delay} ms...`, e.message);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw e;
    }
  }
  throw lastError;
};

const cleanJsonString = (str: string): string => {
  if (!str) return "{}";
  
  let cleaned = str.trim();
  
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
  
  cleaned = cleaned.replace(/```\s*$/, '');
  
  return cleaned.trim();
};

const chatCompletion = async (prompt: string, model: string = DEFAULT_CHAT_MODEL_ID, temperature: number = 0.7, maxTokens: number = 8192, responseFormat?: 'json_object', timeout: number = 600000): Promise<string> => {
  const apiKey = checkApiKey('chat', model);
  const requestModel = resolveRequestModel('chat', model);
  
  const requestBody: any = {
    model: requestModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: temperature,
    max_tokens: maxTokens
  };
  
  if (responseFormat === 'json_object') {
    requestBody.response_format = { type: 'json_object' };
  }
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const apiBase = getApiBase('chat', model);
    const resolvedModel = resolveModel('chat', model);
    const endpoint = resolvedModel?.endpoint || '/v1/chat/completions';
    const response = await fetch(`${apiBase}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

  if (!response.ok) {
    let errorMessage = `Lỗi HTTP: ${response.status}`;
    const raw = await response.text();
    try {
      if (raw) {
        const errorData = JSON.parse(raw);
        errorMessage = errorData.error?.message || errorData.message || errorMessage;
      }
    } catch (_) {
      if (raw) errorMessage = raw;
    }
    throw new Error(errorMessage);
  }

  const data = JSON.parse(await response.text() || '{}');
  return data.choices?.[0]?.message?.content || '';
  } catch (error: any) {
    clearTimeout(timeoutId);
    // Kiểm tra lỗi hết thời gian chờ.
    if (error.name === 'AbortError') {
      throw new Error(`Yêu cầu hết thời gian chờ (${timeout} ms)`);
    }
    throw error;
  }
};

/**
 * Gọi API hoàn tất hội thoại ở chế độ luồng SSE.
 * @param prompt - Nội dung prompt.
 * @param model - Tên mô hình.
 * @param temperature - Tham số temperature.
 * @param responseFormat - Định dạng phản hồi, chỉ dùng cho JSON.
 * @param timeout - Thời gian chờ tính bằng mili giây.
 * @param onDelta - Hàm gọi lại cho từng phần văn bản nhận được.
 * @returns Toàn bộ văn bản.
 */
const chatCompletionStream = async (
  prompt: string,
  model: string = DEFAULT_CHAT_MODEL_ID,
  temperature: number = 0.7,
  responseFormat: 'json_object' | undefined,
  timeout: number = 600000,
  onDelta?: (delta: string) => void
): Promise<string> => {
  const apiKey = checkApiKey('chat', model);
  const requestModel = resolveRequestModel('chat', model);
  const requestBody: any = {
    model: requestModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: temperature,
    stream: true
  };

  if (responseFormat === 'json_object') {
    requestBody.response_format = { type: 'json_object' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const apiBase = getApiBase('chat', model);
    const resolvedModel = resolveModel('chat', model);
    const endpoint = resolvedModel?.endpoint || '/v1/chat/completions';
    const response = await fetch(`${apiBase}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (!response.ok) {
      let errorMessage = `Lỗi HTTP: ${response.status}`;
      const raw = await response.text();
      try {
        if (raw) {
          const errorData = JSON.parse(raw);
          errorMessage = errorData.error?.message || errorData.message || errorMessage;
        }
      } catch (_) {
        if (raw) errorMessage = raw;
      }
      throw new Error(errorMessage);
    }

    if (!response.body) {
      throw new Error('Luồng phản hồi trống, không thể xử lý theo luồng');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullText = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundaryIndex = buffer.indexOf('\n\n');
      while (boundaryIndex !== -1) {
        const chunk = buffer.slice(0, boundaryIndex).trim();
        buffer = buffer.slice(boundaryIndex + 2);

        if (chunk) {
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const dataStr = line.replace(/^data:\s*/, '');
            if (dataStr === '[DONE]') {
              clearTimeout(timeoutId);
              return fullText;
            }
            try {
              const payload = JSON.parse(dataStr);
              const delta = payload?.choices?.[0]?.delta?.content || payload?.choices?.[0]?.message?.content || '';
              if (delta) {
                fullText += delta;
                onDelta?.(delta);
              }
            } catch (e) {
              // Bỏ qua dòng không phân tích được.
            }
          }
        }

        boundaryIndex = buffer.indexOf('\n\n');
      }
    }

    clearTimeout(timeoutId);
    return fullText;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Yêu cầu hết thời gian chờ (${timeout} ms)`);
    }
    throw error;
  }
};

/**
 * Agent 1 & 2: cấu trúc và phân rã kịch bản dài theo hai giai đoạn.
 * Giai đoạn 1 chỉ trích xuất title, genre, logline, characters và scenes.
 * Giai đoạn 2 trích xuất storyParagraphs theo từng cảnh rồi hợp nhất.
 */
export const parseScriptToData = async (rawText: string, language: string = 'Vietnamese', model: string = DEFAULT_CHAT_MODEL_ID, visualStyle: string = 'live-action'): Promise<ScriptData> => {
  console.log('📝 parseScriptToData được gọi (hai giai đoạn) - mô hình:', model, 'phong cách:', visualStyle);
  const startTime = Date.now();
  const inputText = rawText.slice(0, SCRIPT_INPUT_MAX_CHARS);
  if (rawText.length > SCRIPT_INPUT_MAX_CHARS) {
    console.warn(`[parseScriptToData] Kịch bản đã được cắt còn ${SCRIPT_INPUT_MAX_CHARS} ký tự; độ dài ban đầu: ${rawText.length}`);
  }

  try {
    // Giai đoạn 1: chỉ trích xuất cấu trúc, không gồm storyParagraphs.
    const structurePrompt = `
Analyze the text and output a JSON object in the language: ${language}.

Tasks:
1. Extract title, genre, logline (in ${language}).
2. Extract characters (id, name, gender, age, personality).
3. Extract scenes (id, location, time, atmosphere).
Do NOT output storyParagraphs in this step.

Input:
"${inputText}"

Output ONLY valid JSON with this structure (no storyParagraphs):
{
  "title": "string",
  "genre": "string",
  "logline": "string",
  "characters": [{"id": "string", "name": "string", "gender": "string", "age": "string", "personality": "string"}],
  "scenes": [{"id": "string", "location": "string", "time": "string", "atmosphere": "string"}]
}
`;

    let responseText = await retryOperation(() =>
      chatCompletion(structurePrompt, model, 0.7, LONG_FORM_MAX_TOKENS, 'json_object')
    );

    if (!responseText?.trim()) {
      throw new Error('AI không trả về nội dung. Hãy kiểm tra mô hình hoặc thử lại sau.');
    }

    const text = cleanJsonString(responseText);
    let parsed: any = {};
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      console.error("Failed to parse script structure JSON:", e);
      console.error("Raw (first 500 chars):", responseText.slice(0, 500));
      throw new Error('Không thể phân tích cấu trúc do AI trả về. Hãy thử lại hoặc đổi mô hình.');
    }

    const characters = Array.isArray(parsed.characters)
      ? parsed.characters.map((c: any) => ({
          ...c,
          id: String(c.id),
          variations: [] as any[]
        }))
      : [];
    const scenes = Array.isArray(parsed.scenes)
      ? parsed.scenes.map((s: any) => ({ ...s, id: String(s.id) }))
      : [];

    if (characters.length === 0 && scenes.length === 0) {
      throw new Error('AI không trích xuất được nhân vật hoặc cảnh. Hãy nhập một câu chuyện/kịch bản đầy đủ có nhân vật và địa điểm.');
    }

    const genre = parsed.genre || 'Tổng hợp';

    // Giai đoạn 2: trích xuất storyParagraphs theo từng cảnh.
    const storyParagraphs: { id: number; text: string; sceneRefId: string }[] = [];
    let nextId = 1;

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const scenePrompt = `
Given the script and scene list below, extract ONLY the story paragraphs that belong to this scene.
Scene to extract for: id="${scene.id}", location="${scene.location}".

Full script:
"${inputText}"

All scene IDs for reference: ${scenes.map((s: any) => s.id).join(', ')}

Output ONLY a JSON array of objects. Each object: {"id": number, "text": string, "sceneRefId": "${scene.id}"}.
Use short paragraph texts. Language: ${language}.
`;

      try {
        if (i > 0) await new Promise((r) => setTimeout(r, 800));
        const paraResponse = await retryOperation(() =>
          chatCompletion(scenePrompt, model, 0.5, PARAGRAPHS_CHUNK_MAX_TOKENS, 'json_object')
        );
        const paraCleaned = cleanJsonString(paraResponse);
        let arr: any[] = [];
        try {
          const parsedPara = JSON.parse(paraCleaned);
          arr = Array.isArray(parsedPara)
            ? parsedPara
            : Array.isArray(parsedPara.storyParagraphs)
              ? parsedPara.storyParagraphs
              : Array.isArray(parsedPara.paragraphs)
                ? parsedPara.paragraphs
                : (() => {
                    const v = Object.values(parsedPara).find((x: any) => Array.isArray(x));
                    return Array.isArray(v) ? v : [];
                  })();
        } catch (_) {
          // Giữ mảng rỗng và bỏ qua cảnh khi không phân tích được.
          arr = [];
        }
        arr.forEach((p: any) => {
          if (p && (p.text || p.content)) {
            storyParagraphs.push({
              id: nextId++,
              text: typeof p.text === 'string' ? p.text : String(p.content || ''),
              sceneRefId: String(scene.id)
            });
          }
        });
      } catch (e) {
        console.warn(`[parseScriptToData] Không trích xuất được đoạn cho cảnh ${scene.location}; đang bỏ qua:`, e);
      }
    }

    // Nếu không có kết quả theo cảnh, thử trích xuất toàn bộ một lần.
    if (storyParagraphs.length === 0 && scenes.length > 0) {
      console.log('[parseScriptToData] Không có đoạn theo cảnh; đang thử trích xuất toàn bộ...');
      const fallbackPrompt = `
Break down the story into paragraphs linked to scenes. Language: ${language}.
Script:
"${inputText.slice(0, 60000)}"

Scenes (use these sceneRefId): ${JSON.stringify(scenes.map((s: any) => ({ id: s.id, location: s.location })))}

Output ONLY valid JSON: { "storyParagraphs": [ {"id": number, "text": "string", "sceneRefId": "string"} ] }
`;
      try {
        const fallbackResp = await retryOperation(() =>
          chatCompletion(fallbackPrompt, model, 0.6, LONG_FORM_MAX_TOKENS, 'json_object')
        );
        const fallbackParsed = JSON.parse(cleanJsonString(fallbackResp));
        const list = Array.isArray(fallbackParsed.storyParagraphs) ? fallbackParsed.storyParagraphs : [];
        list.forEach((p: any, idx: number) => {
          if (p && (p.text || p.content)) {
            storyParagraphs.push({
              id: nextId++,
              text: typeof p.text === 'string' ? p.text : String(p.content || ''),
              sceneRefId: String(p.sceneRefId || scenes[0]?.id || '')
            });
          }
        });
      } catch (e2) {
        console.warn('[parseScriptToData] Trích xuất toàn bộ cũng thất bại:', e2);
      }
    }

    // Tạo prompt hình ảnh cho nhân vật và bối cảnh.
    console.log('🎨 Đang tạo prompt hình ảnh cho nhân vật và bối cảnh...', `phong cách: ${visualStyle}`);
    for (let i = 0; i < characters.length; i++) {
      try {
        if (i > 0) await new Promise((resolve) => setTimeout(resolve, 1500));
        const prompts = await generateVisualPrompts('character', characters[i], genre, model, visualStyle, language);
        characters[i].visualPrompt = prompts.visualPrompt;
        (characters[i] as any).negativePrompt = prompts.negativePrompt;
      } catch (e) {
        console.error(`Failed to generate visual prompt for character ${characters[i].name}:`, e);
      }
    }
    for (let i = 0; i < scenes.length; i++) {
      try {
        if (i > 0 || characters.length > 0) await new Promise((resolve) => setTimeout(resolve, 1500));
        const prompts = await generateVisualPrompts('scene', scenes[i], genre, model, visualStyle, language);
        scenes[i].visualPrompt = prompts.visualPrompt;
        (scenes[i] as any).negativePrompt = prompts.negativePrompt;
      } catch (e) {
        console.error(`Failed to generate visual prompt for scene ${scenes[i].location}:`, e);
      }
    }

    console.log('✅ Đã tạo xong prompt hình ảnh');
    const result: ScriptData = {
      title: parsed.title || 'Kịch bản chưa đặt tên',
      genre,
      logline: parsed.logline || '',
      language,
      characters,
      scenes,
      storyParagraphs
    };

    addRenderLogWithTokens({
      type: 'script-parsing',
      resourceId: 'script-parse-' + Date.now(),
      resourceName: result.title,
      status: 'success',
      model,
      prompt: structurePrompt.substring(0, 200) + '...',
      duration: Date.now() - startTime
    });
    return result;
  } catch (error: any) {
    addRenderLogWithTokens({
      type: 'script-parsing',
      resourceId: 'script-parse-' + Date.now(),
      resourceName: 'Phân tích kịch bản',
      status: 'failed',
      model,
      prompt: '',
      error: error.message,
      duration: Date.now() - startTime
    });
    throw error;
  }
};

/**
 * Tạo danh sách cảnh quay theo dữ liệu kịch bản và thời lượng mục tiêu.
 * Số cảnh quay = thời lượng mục tiêu (giây) / 10 giây mỗi cảnh, rồi phân bổ theo cảnh.
 * @param scriptData - Dữ liệu kịch bản gồm cảnh, nhân vật và thời lượng.
 * @param model - Mô hình AI, mặc định DEFAULT_CHAT_MODEL_ID.
 * @returns Danh sách cảnh quay gồm khung hình chính và chuyển động máy quay.
 */
export const generateShotList = async (scriptData: ScriptData, model: string = DEFAULT_CHAT_MODEL_ID): Promise<Shot[]> => {
  const overallStartTime = Date.now();
  
  if (!scriptData.scenes || scriptData.scenes.length === 0) {
    return [];
  }

  const lang = scriptData.language || 'Vietnamese';
  const visualStyle = scriptData.visualStyle || 'live-action';
  const stylePrompt = VISUAL_STYLE_PROMPTS[visualStyle] || visualStyle;
  
  // Xử lý từng cảnh để giảm lỗi JSON dài và nguy cơ vượt giới hạn token.
  const processScene = async (scene: Scene, index: number): Promise<Shot[]> => {
    const sceneStartTime = Date.now();
    const paragraphs = scriptData.storyParagraphs
      .filter(p => String(p.sceneRefId) === String(scene.id))
      .map(p => p.text)
      .join('\n');

    if (!paragraphs.trim()) return [];

    const targetDurationStr = scriptData.targetDuration || '60s';
    const targetSeconds = parseInt(targetDurationStr.replace(/[^\d]/g, '')) || 60;
    const totalShotsNeeded = Math.round(targetSeconds / 10);
    const scenesCount = scriptData.scenes.length;
    const shotsPerScene = Math.max(1, Math.round(totalShotsNeeded / scenesCount));
    
    const prompt = `
      Act as a professional cinematographer. Generate a detailed shot list (Camera blocking) for Scene ${index + 1}.
      Language for Text Output: ${lang}.
      
      IMPORTANT VISUAL STYLE: ${stylePrompt}
      All 'visualPrompt' fields MUST describe shots in this "${visualStyle}" style.
      
      Scene Details:
      Location: ${scene.location}
      Time: ${scene.time}
      Atmosphere: ${scene.atmosphere}
      
      Scene Action:
      "${paragraphs.slice(0, 12000)}"
      
      Context:
      Genre: ${scriptData.genre}
      Visual Style: ${visualStyle} (${stylePrompt})
      Target Duration (Whole Script): ${scriptData.targetDuration || 'Standard'}
      Total Shots Budget: ${totalShotsNeeded} shots (Each shot = 10 seconds of video)
      Shots for This Scene: Approximately ${shotsPerScene} shots
      
      Characters:
      ${JSON.stringify(scriptData.characters.map(c => ({ id: c.id, name: c.name, desc: c.visualPrompt || c.personality })))}

      Professional Camera Movement Reference (Choose from these categories):
      - Horizontal Left Shot (trượt ngang sang trái) - Camera moves left
      - Horizontal Right Shot (trượt ngang sang phải) - Camera moves right
      - Pan Left Shot (lia trái) - Pan left
      - Pan Right Shot (lia phải) - Pan right
      - Vertical Up Shot (di chuyển thẳng lên) - Move up vertically
      - Vertical Down Shot (di chuyển thẳng xuống) - Move down vertically
      - Tilt Up Shot (ngẩng máy lên) - Tilt upward
      - Tilt Down Shot (hạ máy xuống) - Tilt downward
      - Zoom Out Shot (thu nhỏ/lùi xa) - Pull back/zoom out
      - Zoom In Shot (phóng to/tiến gần) - Push in/zoom in
      - Dolly Shot (dolly tiến/lùi) - Dolly in/out movement
      - Circular Shot (quay vòng quanh chủ thể) - Orbit around subject
      - Over the Shoulder Shot (qua vai) - Over shoulder perspective
      - Pan Shot (lia máy) - Pan movement
      - Low Angle Shot (góc thấp) - Low angle view
      - High Angle Shot (góc cao) - High angle view
      - Tracking Shot (bám theo chủ thể) - Follow subject
      - Handheld Shot (máy cầm tay) - Handheld camera
      - Static Shot (máy cố định) - Fixed camera position
      - POV Shot (góc nhìn chủ quan) - Point of view
      - Bird's Eye View Shot (góc nhìn từ trên cao) - Overhead view
      - 360-Degree Circular Shot (quay vòng 360 độ) - Full circle
      - Parallel Tracking Shot (bám song song) - Side tracking
      - Diagonal Tracking Shot (bám chéo) - Diagonal tracking
      - Rotating Shot (xoay máy) - Rotating movement
      - Slow Motion Shot (chuyển động chậm) - Slow-mo effect
      - Time-Lapse Shot (tua nhanh thời gian) - Time-lapse
      - Canted Shot (góc nghiêng Dutch) - Dutch angle
      - Cinematic Dolly Zoom (dolly zoom điện ảnh) - Vertigo effect

      Instructions:
      1. Create EXACTLY ${shotsPerScene} shots (or ${shotsPerScene - 1} to ${shotsPerScene + 1} shots if needed for story flow) for this scene.
      2. CRITICAL: Each shot will be 10 seconds. Total shots must match the target duration formula: ${targetSeconds} seconds ÷ 10 = ${totalShotsNeeded} total shots across all scenes.
      3. DO NOT exceed ${shotsPerScene + 1} shots for this scene. Select the most important moments only.
      4. 'cameraMovement': Can reference the Professional Camera Movement Reference list above for inspiration, or use your own creative camera movements. You may use the exact English terms (e.g., "Dolly Shot", "Pan Right Shot", "Zoom In Shot", "Tracking Shot") or describe custom movements.
      5. 'shotSize': Specify the field of view (e.g., Extreme Close-up, Medium Shot, Wide Shot).
      6. 'actionSummary': Detailed description of what happens in the shot (in ${lang}).
      7. 'visualPrompt': Detailed description for image generation in ${visualStyle} style (OUTPUT IN ${lang}). Include style-specific keywords. Keep it under 50 words.
      
      Output ONLY a valid JSON OBJECT with this exact structure (no markdown, no extra text):
      {
        "shots": [
          {
            "id": "string",
            "sceneId": "${scene.id}",
            "actionSummary": "string",
            "dialogue": "string (empty if none)",
            "cameraMovement": "string",
            "shotSize": "string",
            "characters": ["string"],
            "keyframes": [
              {"id": "string", "type": "start|end", "visualPrompt": "string (MUST include ${visualStyle} style keywords)"}
            ]
          }
        ]
      }
    `;

    let responseText = '';
    try {
      responseText = await retryOperation(() => chatCompletion(prompt, model, 0.7, LONG_FORM_MAX_TOKENS, 'json_object'));
      const text = cleanJsonString(responseText);
      const parsed = JSON.parse(text);

      // json_object buộc phản hồi là object; hỗ trợ cả mảng cũ và { shots: [...] } mới.
      const shots = Array.isArray(parsed)
        ? parsed
        : (parsed && Array.isArray((parsed as any).shots) ? (parsed as any).shots : []);
      
      const validShots = Array.isArray(shots) ? shots : [];
      const result = validShots.map(s => ({
        ...s,
        sceneId: String(scene.id)
      }));
      
      addRenderLogWithTokens({
        type: 'script-parsing',
        resourceId: `shot-gen-scene-${scene.id}-${Date.now()}`,
        resourceName: `Tạo cảnh quay - Cảnh ${index + 1}: ${scene.location}`,
        status: 'success',
        model: model,
        prompt: prompt.substring(0, 200) + '...',
        duration: Date.now() - sceneStartTime
      });
      
      return result;

    } catch (e: any) {
      console.error(`Failed to generate shots for scene ${scene.id}`, e);
      try {
        console.error(`  ↳ sceneId=${scene.id}, sceneIndex=${index}, responseText(snippet)=`, String(responseText || '').slice(0, 500));
      } catch {
        // ignore
      }
      
      addRenderLogWithTokens({
        type: 'script-parsing',
        resourceId: `shot-gen-scene-${scene.id}-${Date.now()}`,
        resourceName: `Tạo cảnh quay - Cảnh ${index + 1}: ${scene.location}`,
        status: 'failed',
        model: model,
        prompt: prompt.substring(0, 200) + '...',
        error: e.message || String(e),
        duration: Date.now() - sceneStartTime
      });
      
      return [];
    }
  };

  const BATCH_SIZE = 1;
  const allShots: Shot[] = [];
  
  for (let i = 0; i < scriptData.scenes.length; i += BATCH_SIZE) {
    if (i > 0) await new Promise(resolve => setTimeout(resolve, 1500));
    
    const batch = scriptData.scenes.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((scene, idx) => processScene(scene, i + idx))
    );
    batchResults.forEach(shots => allShots.push(...shots));
  }

  if (allShots.length === 0) {
    throw new Error('Tạo cảnh quay thất bại: AI trả về dữ liệu rỗng. Có thể cấu trúc JSON không khớp hoặc nội dung cảnh chưa được nhận diện; hãy xem nhật ký trong bảng điều khiển.');
  }

  return allShots.map((s, idx) => ({
    ...s,
    id: `shot-${idx + 1}`,
    keyframes: Array.isArray(s.keyframes) ? s.keyframes.map(k => ({ 
      ...k, 
      id: `kf-${idx + 1}-${k.type}`,
      status: 'pending' 
    })) : []
  }));
};

const VISUAL_STYLE_PROMPTS: { [key: string]: string } = {
  'live-action': 'photorealistic, cinematic film quality, real human actors, professional cinematography, natural lighting, 8K resolution',
  'anime': 'Japanese anime style, cel-shaded, vibrant colors, expressive eyes, dynamic poses, Studio Ghibli/Makoto Shinkai quality',
  '2d-animation': 'classic 2D animation, hand-drawn style, Disney/Pixar quality, smooth lines, expressive characters, painterly backgrounds',
  '3d-animation': 'high-quality 3D CGI animation, Pixar/DreamWorks style, subsurface scattering, detailed textures, stylized characters',
  'cyberpunk': 'cyberpunk aesthetic, neon-lit, rain-soaked streets, holographic displays, high-tech low-life, Blade Runner style',
  'oil-painting': 'oil painting style, visible brushstrokes, rich textures, classical art composition, museum quality fine art',
};

const NEGATIVE_PROMPTS: { [key: string]: string } = {
  'live-action': 'cartoon, anime, illustration, painting, drawing, 3d render, cgi, low quality, blurry, grainy, watermark, text, logo, signature, distorted face, bad anatomy, extra limbs, mutated hands, deformed, ugly, disfigured, poorly drawn, amateur',
  'anime': 'photorealistic, 3d render, western cartoon, ugly, bad anatomy, extra limbs, deformed limbs, blurry, watermark, text, logo, poorly drawn face, mutated hands, extra fingers, missing fingers, bad proportions, grotesque',
  '2d-animation': 'photorealistic, 3d, low quality, pixelated, blurry, watermark, text, bad anatomy, deformed, ugly, amateur drawing, inconsistent style, rough sketch',
  '3d-animation': 'photorealistic, 2d, flat, hand-drawn, low poly, bad topology, texture artifacts, z-fighting, clipping, low quality, blurry, watermark, text, bad rigging, unnatural movement',
  'cyberpunk': 'bright daylight, pastoral, medieval, fantasy, cartoon, low tech, rural, natural, watermark, text, logo, low quality, blurry, amateur',
  'oil-painting': 'digital art, photorealistic, 3d render, cartoon, anime, low quality, blurry, watermark, text, amateur, poorly painted, muddy colors, overworked canvas',
};

/**
 * Tạo prompt hình ảnh chi tiết cho nhân vật hoặc bối cảnh.
 * @param type - Loại dữ liệu: character hoặc scene.
 * @param data - Dữ liệu nhân vật hoặc bối cảnh.
 * @param genre - Thể loại kịch bản.
 * @param model - Mô hình AI, mặc định DEFAULT_CHAT_MODEL_ID.
 * @param visualStyle - Phong cách hình ảnh, mặc định live-action.
 * @param language - Ngôn ngữ đầu ra, mặc định Vietnamese.
 * @returns Object gồm visualPrompt và negativePrompt.
 */
export const generateVisualPrompts = async (type: 'character' | 'scene', data: Character | Scene, genre: string, model: string = DEFAULT_CHAT_MODEL_ID, visualStyle: string = 'live-action', language: string = 'Vietnamese'): Promise<{ visualPrompt: string; negativePrompt: string }> => {
   const stylePrompt = VISUAL_STYLE_PROMPTS[visualStyle] || visualStyle;
   const negativePrompt = NEGATIVE_PROMPTS[visualStyle] || NEGATIVE_PROMPTS['live-action'];
   
   let prompt: string;
   
   if (type === 'character') {
     const char = data as Character;
     prompt = `You are an expert AI prompt engineer for ${visualStyle} style image generation.

Create a detailed visual prompt for a character with the following structure:

Character Data:
- Name: ${char.name}
- Gender: ${char.gender}
- Age: ${char.age}
- Personality: ${char.personality}

REQUIRED STRUCTURE (output in ${language}):
1. Core Identity: [ethnicity, age, gender, body type]
2. Facial Features: [specific distinguishing features - eyes, nose, face shape, skin tone]
3. Hairstyle: [detailed hair description - color, length, style]
4. Clothing: [detailed outfit appropriate for ${genre} genre]
5. Pose & Expression: [body language and facial expression matching personality]
6. Technical Quality: ${stylePrompt}

CRITICAL RULES:
- Sections 1-3 are FIXED features for consistency across all variations
- Use specific, concrete visual details
- Output as single paragraph, comma-separated
- MUST include style keywords: ${visualStyle}
- Length: 60-90 words
- Focus on visual details that can be rendered in images

Output ONLY the visual prompt text, no explanations.`;
   } else {
     const scene = data as Scene;
     prompt = `You are an expert cinematographer and AI prompt engineer for ${visualStyle} productions.

Create a cinematic scene prompt with this structure:

Scene Data:
- Location: ${scene.location}
- Time: ${scene.time}
- Atmosphere: ${scene.atmosphere}
- Genre: ${genre}

REQUIRED STRUCTURE (output in ${language}):
1. Environment: [detailed location description with architectural/natural elements]
2. Lighting: [specific lighting setup - direction, color temperature, quality (soft/hard), key light source]
3. Composition: [camera angle (eye-level/low/high), framing rules (rule of thirds/symmetry), depth layers]
4. Atmosphere: [mood, weather, particles in air (fog/dust/rain), environmental effects]
5. Color Palette: [dominant colors, color temperature (warm/cool), saturation level]
6. Technical Quality: ${stylePrompt}

CRITICAL RULES:
- Use professional cinematography terminology
- Specify light sources and direction (e.g., "golden hour backlight from right")
- Include composition guidelines (rule of thirds, leading lines, depth of field)
- Output as single paragraph, comma-separated
- MUST emphasize ${visualStyle} style throughout
- Length: 70-110 words
- Focus on elements that establish mood and cinematic quality

Output ONLY the visual prompt text, no explanations.`;
   }

   const visualPrompt = await retryOperation(() => chatCompletion(prompt, model, 0.7, 1024));
   
   return {
     visualPrompt: visualPrompt.trim(),
     negativePrompt: negativePrompt
   };
};

/**
 * Tạo ảnh (Agent 4 & 6) qua API hình ảnh hoặc chat/completions tương thích.
 * @param prompt - Prompt tạo ảnh.
 * @param referenceImages - Ảnh tham chiếu base64; ảnh đầu là bối cảnh, các ảnh sau là nhân vật.
 * @param aspectRatio - Tỷ lệ 16:9 hoặc 9:16; một số mô hình không hỗ trợ 1:1.
 * @param isVariation - Chế độ biến thể trang phục, giữ khuôn mặt nhất quán.
 * @returns Ảnh dạng base64.
 * @throws Lỗi khi tạo ảnh thất bại.
 */
export const generateImage = async (
  prompt: string, 
  referenceImages: string[] = [],
  aspectRatio: AspectRatio = '16:9',
  isVariation: boolean = false
): Promise<string> => {
  const startTime = Date.now();
  
  // Lấy mô hình ảnh đang hoạt động từ modelRegistry.
  const activeImageModel = getActiveModel('image');
  const imageModelId = activeImageModel?.apiModel || activeImageModel?.id || DEFAULT_IMAGE_MODEL_ID;
  const imageEndpoint = activeImageModel?.endpoint;
  const apiKey = checkApiKey('image', activeImageModel?.id);
  const apiBase = getApiBase('image', activeImageModel?.id);
  const requestEndpoint = '/v1/chat/completions';

  try {
    // Các mô hình như qwen-image-2.0 dùng /v1/images/generations.
    if (shouldUseImagesGenerationsEndpoint(imageModelId, imageEndpoint)) {
      const result = await callImagesGenerationsApi({
        apiBase,
        apiKey,
        model: imageModelId,
        prompt,
        aspectRatio,
      });
      addRenderLogWithTokens({
        type: 'keyframe',
        resourceId: 'image-' + Date.now(),
        resourceName: prompt.substring(0, 50) + '...',
        status: 'success',
        model: imageModelId,
        prompt,
        duration: Date.now() - startTime,
      });
      return result;
    }
    // If we have reference images, instruct the model to use them for consistency
    let finalPrompt = prompt;
    if (referenceImages.length > 0) {
      if (isVariation) {
        // Chế độ biến thể: giữ khuôn mặt, thay trang phục/tạo hình.
        finalPrompt = `
      ⚠️⚠️⚠️ CRITICAL REQUIREMENTS - CHARACTER OUTFIT VARIATION ⚠️⚠️⚠️
      
      Reference Images Information:
      - The provided image shows the CHARACTER's BASE APPEARANCE that you MUST use as reference for FACE ONLY.
      
      Task:
      Generate a character image with a NEW OUTFIT/COSTUME based on this description: "${prompt}".
      
      ⚠️ ABSOLUTE REQUIREMENTS (NON-NEGOTIABLE):
      
      1. FACE & IDENTITY - MUST BE 100% IDENTICAL TO REFERENCE:
         • Facial Features: Eyes (color, shape, size), nose structure, mouth shape, facial contours must be EXACTLY the same
         • Hairstyle & Hair Color: Length, color, texture, and style must be PERFECTLY matched (unless prompt specifies hair change)
         • Skin tone and facial structure: MUST remain identical
         • Expression can vary based on prompt
         
      2. OUTFIT/CLOTHING - MUST BE COMPLETELY DIFFERENT FROM REFERENCE:
         • Generate NEW clothing/outfit as described in the prompt
         • DO NOT copy the clothing from the reference image
         • The outfit should match the description provided: "${prompt}"
         • Include all accessories, props, or costume details mentioned in the prompt
         
      3. Body proportions should remain consistent with the reference.
      
      ⚠️ This is an OUTFIT VARIATION task - The face MUST match the reference, but the CLOTHES MUST be NEW as described!
      ⚠️ If the new outfit is not clearly visible and different from the reference, the task has FAILED!
    `;
      } else {
        // Chế độ thường: ưu tiên tính nhất quán hoàn toàn.
        finalPrompt = `
      ⚠️⚠️⚠️ CRITICAL REQUIREMENTS - CHARACTER CONSISTENCY ⚠️⚠️⚠️
      
      Reference Images Information:
      - The FIRST image is the Scene/Environment reference.
      - Any subsequent images are Character references (Base Look or Variation).
      
      Task:
      Generate a cinematic shot matching this prompt: "${prompt}".
      
      ⚠️ ABSOLUTE REQUIREMENTS (NON-NEGOTIABLE):
      1. Scene Consistency:
         - STRICTLY maintain the visual style, lighting, and environment from the scene reference.
      
      2. Character Consistency - HIGHEST PRIORITY:
         If characters are present in the prompt, they MUST be IDENTICAL to the character reference images:
         • Facial Features: Eyes (color, shape, size), nose structure, mouth shape, facial contours must be EXACTLY the same
         • Hairstyle & Hair Color: Length, color, texture, and style must be PERFECTLY matched
         • Clothing & Outfit: Style, color, material, and accessories must be IDENTICAL
         • Body Type: Height, build, proportions must remain consistent
         
      ⚠️ DO NOT create variations or interpretations of the character - STRICT REPLICATION ONLY!
      ⚠️ Character appearance consistency is THE MOST IMPORTANT requirement!
    `;
      }
    }

  // Mô hình ảnh Gemini yêu cầu content dạng mảng đa phương thức.
  const messageContent: Array<
    { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
  > = [{ type: 'text', text: finalPrompt }];
  for (const img of referenceImages) {
    if (!img?.trim()) continue;
    const url = /^data:image\//i.test(img)
      ? img
      : `data:image/png;base64,${img.replace(/^data:image\/[^;]+;base64,/, '')}`;
    messageContent.push({ type: 'image_url', image_url: { url } });
  }

  const requestBody: any = {
    model: imageModelId,
    messages: [{ role: 'user', content: messageContent }],
    max_tokens: 2048,
  };

  const response = await retryOperation(async () => {
    const res = await fetch(`${apiBase}${requestEndpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': '*/*'
      },
      body: JSON.stringify(requestBody)
    });

    if (!res.ok) {
      // Xử lý riêng lỗi 400/500 do bộ lọc nội dung.
      if (res.status === 400) {
        throw new Error('Yêu cầu bị chặn vì an toàn nội dung. Hãy chỉnh prompt khung hình, loại bỏ mô tả bạo lực, máu me hoặc nhạy cảm rồi thử lại.');
      }
      else if (res.status === 500) {
        throw new Error('Hệ thống đang có nhiều yêu cầu. Vui lòng thử lại sau.');
      }
      
      let errorMessage = `Lỗi HTTP: ${res.status}`;
      try {
        const errorText = await res.text();
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error?.message || errorMessage;
        } catch {
          if (errorText) errorMessage = errorText;
        }
      } catch (_) {
        // Dùng thông báo mặc định khi body đã đọc hoặc không phân tích được.
      }
      throw new Error(errorMessage);
    }

    return await res.json();
  });

  const extracted = extractImageFromApiResponse(response);
  if (extracted) {
    const result = await normalizeImageResult(extracted);
    addRenderLogWithTokens({
      type: 'keyframe',
      resourceId: 'image-' + Date.now(),
      resourceName: prompt.substring(0, 50) + '...',
      status: 'success',
      model: imageModelId,
      prompt: prompt,
      duration: Date.now() - startTime,
    });
    return result;
  }

  throw new Error(
    `Tạo ảnh thất bại: mô hình ${imageModelId} không trả về dữ liệu ảnh trong content/data. ` +
      'Mô hình kiểu qwen-image tự động dùng /v1/images/generations; mô hình kiểu Gemini dùng chat/completions.'
  );
  } catch (error: any) {
    // Log failed generation
    addRenderLogWithTokens({
      type: 'keyframe',
      resourceId: 'image-' + Date.now(),
      resourceName: prompt.substring(0, 50) + '...',
      status: 'failed',
      model: imageModelId,
      prompt: prompt,
      error: error.message,
      duration: Date.now() - startTime
    });
    
    throw error;
  }
};

/**
 * Chuyển URL video sang base64.
 * @param url - URL tệp video.
 * @returns Dữ liệu video base64.
 * @throws Lỗi khi tải hoặc chuyển đổi thất bại.
 */
const convertVideoUrlToBase64 = async (url: string): Promise<string> => {
  try {
    // Tải tệp video.
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Tải video thất bại: HTTP ${response.status}`);
    }
    
    // Lấy blob video.
    const blob = await response.blob();
    
    // Chuyển sang base64.
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        resolve(base64String);
      };
      reader.onerror = () => {
        reject(new Error('Chuyển video sang base64 thất bại'));
      };
      reader.readAsDataURL(blob);
    });
  } catch (error: any) {
    console.error('Chuyển URL video sang base64 thất bại:', error);
    throw new Error(`Chuyển đổi video thất bại: ${error.message}`);
  }
};

/**
 * Đổi kích thước ảnh theo chiều rộng và chiều cao mục tiêu.
 * @param base64Data - Dữ liệu ảnh base64 không có tiền tố.
 * @param targetWidth - Chiều rộng mục tiêu.
 * @param targetHeight - Chiều cao mục tiêu.
 * @returns Dữ liệu base64 đã đổi kích thước, không có tiền tố.
 */
const resizeImageToSize = async (base64Data: string, targetWidth: number, targetHeight: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Không thể tạo ngữ cảnh canvas'));
        return;
      }
      // Dùng chế độ cover, giữ tỷ lệ và cắt giữa.
      const scale = Math.max(targetWidth / img.width, targetHeight / img.height);
      const scaledWidth = img.width * scale;
      const scaledHeight = img.height * scale;
      const offsetX = (targetWidth - scaledWidth) / 2;
      const offsetY = (targetHeight - scaledHeight) / 2;
      ctx.drawImage(img, offsetX, offsetY, scaledWidth, scaledHeight);
      // Trả về base64 không có tiền tố.
      const result = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
      resolve(result);
    };
    img.onerror = () => reject(new Error('Tải ảnh thất bại'));
    img.src = `data:image/png;base64,${base64Data}`;
  });
};

/**
 * sora-2专用：使用异步API生成视频
 * 流程：1. 创建任务 -> 2. 轮询状态 -> 3. 下载视频
 * @param prompt - 视频生成提示词
 * @param startImageBase64 - 起始关键帧图像(base64格式，可选)
 * @param apiKey - API密钥
 * @param aspectRatio - 横竖屏比例，支持 '16:9'（横屏）、'9:16'（竖屏）、'1:1'（方形）
 * @param duration - 视频时长，支持 4、8、12 秒
 * @returns 返回视频的base64编码
 */
const generateVideoWithSora2 = async (
  prompt: string, 
  startImageBase64: string | undefined, 
  apiKey: string,
  aspectRatio: AspectRatio = '16:9',
  duration: VideoDuration = 8,
  modelName: string = 'sora-2'
): Promise<string> => {
  console.log(`🎬 Đang tạo video bất đồng bộ (${modelName}, ${aspectRatio}, ${duration} giây)...`);
  
  // 根据横竖屏比例计算视频尺寸
  const videoSize = getSoraVideoSize(aspectRatio);
  const [VIDEO_WIDTH, VIDEO_HEIGHT] = videoSize.split('x').map(Number);
  
  console.log(`📐 Kích thước video: ${VIDEO_WIDTH}x${VIDEO_HEIGHT}`);
  
  // 获取 API 基础 URL
  const apiBase = getApiBase('video', modelName);
  
  // Step 1: 创建视频任务
  const formData = new FormData();
  formData.append('model', modelName);
  formData.append('prompt', prompt);
  formData.append('seconds', String(duration));
  formData.append('size', videoSize);
  
  // 如果有参考图片，调整尺寸后添加到FormData
  if (startImageBase64) {
    const cleanBase64 = startImageBase64.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
    
    // 调整图片尺寸以匹配视频尺寸要求
    console.log(`📐 Đang đổi kích thước ảnh tham chiếu thành ${VIDEO_WIDTH}x${VIDEO_HEIGHT}...`);
    const resizedBase64 = await resizeImageToSize(cleanBase64, VIDEO_WIDTH, VIDEO_HEIGHT);
    
    // 将base64转换为Blob
    const byteCharacters = atob(resizedBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'image/png' });
    formData.append('input_reference', blob, 'reference.png');
    console.log('✅ Đã đổi kích thước và thêm ảnh tham chiếu');
  }
  
  // 创建任务
  const createResponse = await fetch(`${apiBase}/v1/videos`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`
    },
    body: formData
  });
  
  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    throwFromVideoHttpError(createResponse.status, errorText, 'sora');
  }
  
  const createData = await createResponse.json();
  // 响应格式可能是 { id: "sora-2:task_xxx" } 或 { task_id: "xxx" }
  const taskId = createData.id || createData.task_id;
  if (!taskId) {
    throw new Error('Không thể tạo tác vụ video: máy chủ không trả về mã tác vụ');
  }
  
  console.log('📋 Đã tạo tác vụ sora-2, mã tác vụ:', taskId);
  
  // Step 2: 轮询查询任务状态
  const maxPollingTime = 1200000; // 20分钟超时
  const pollingInterval = 5000; // 每5秒查询一次
  const startTime = Date.now();
  
  let videoId: string | null = null;
  let completedStatus: Record<string, unknown> | null = null;

  while (Date.now() - startTime < maxPollingTime) {
    await new Promise(resolve => setTimeout(resolve, pollingInterval));
    
    const statusResponse = await fetch(`${apiBase}/v1/videos/${encodeVideoPathId(taskId)}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    });
    
    if (!statusResponse.ok) {
      console.warn('⚠️ Không thể truy vấn trạng thái tác vụ, đang thử lại...');
      continue;
    }
    
    const statusData = await statusResponse.json();
    const status = statusData.status;
    
    console.log('🔄 Trạng thái tác vụ sora-2:', status, 'tiến độ:', statusData.progress);
    
    if (status === 'completed' || status === 'succeeded') {
      completedStatus = statusData as Record<string, unknown>;
      videoId = resolveSoraVideoDownloadId(statusData as Record<string, unknown>);
      if (!videoId && statusData.outputs?.length) {
        const o0 = statusData.outputs[0];
        videoId = typeof o0 === 'string' ? o0 : o0?.id;
      }
      if (!videoId) {
        videoId = statusData.id || null;
      }
      console.log('✅ Tác vụ hoàn tất, ID dùng để tải:', videoId);
      break;
    } else if (status === 'failed' || status === 'error') {
      throw new Error(formatVideoTaskErrorForUser(statusData.error ?? statusData, statusData.message, 'sora'));
    }
    // 其他状态（pending, processing等）继续轮询
  }

  if (!videoId && !completedStatus) {
    throw new Error('Tạo video hết thời gian chờ (20 phút) hoặc không có mã video');
  }

  console.log('✅ Sora-2 đã tạo xong video, bắt đầu tải; mã tác vụ:', taskId, 'mã tài nguyên:', videoId);

  return downloadSoraCompletedVideo({
    apiBase,
    apiKey,
    taskId,
    completedStatus,
    initialVideoId: videoId,
  });
};

/**
 * 生成视频(Agent 8)
 * 使用antsk视频生成API (veo_3_1 或 sora-2)
 * 通过起始帧和结束帧生成视频片段
 * @param prompt - 视频生成提示词
 * @param startImageBase64 - 起始关键帧图像(base64格式)
 * @param endImageBase64 - 结束关键帧图像(base64格式)
 * @param model - 使用的视频生成模型，'veo' 会根据 aspectRatio 自动选择具体模型，'sora-2' 使用异步API
 * @param aspectRatio - 横竖屏比例，支持 '16:9'（横屏，默认）、'9:16'（竖屏）、'1:1'（方形，仅 sora-2 支持）
 * @param duration - 视频时长（仅 sora-2 支持），支持 4、8、12 秒
 * @returns 返回生成的视频base64编码(而非URL),用于存储到indexedDB
 * @throws 如果视频生成失败则抛出错误
 * @note 视频URL会过期,因此转换为base64存储
 * @note sora-2使用异步API模式(/v1/videos)，veo模型使用同步模式(/v1/chat/completions)
 */
export const generateVideo = async (
  prompt: string, 
  startImageBase64?: string, 
  endImageBase64?: string, 
  model: string = DEFAULT_VIDEO_MODEL_ID,
  aspectRatio: AspectRatio = '16:9',
  duration: VideoDuration = 8
): Promise<string> => {
  const resolvedVideoModel = resolveModel('video', model);
  const requestModel = resolveRequestModel('video', model) || model;
  const apiKey = checkApiKey('video', model);
  const apiBase = getApiBase('video', model);
  const endpoint = resolvedVideoModel?.endpoint || '';
  const isAsyncMode =
    resolvedVideoModel?.params?.mode === 'async' ||
    requestModel === 'sora-2' ||
    requestModel === DEFAULT_VIDEO_MODEL_ID ||
    (requestModel.startsWith('doubao-seedance') && endpoint.includes('/v1/videos'));

  if (isAsyncMode) {
    return generateVideoWithSora2(
      prompt,
      startImageBase64,
      apiKey,
      aspectRatio,
      duration,
      requestModel || DEFAULT_VIDEO_MODEL_ID
    );
  }
  
  // 如果是 veo 模型，根据横竖屏和是否有参考图动态选择模型名称
  let actualModel = requestModel;
  if (actualModel === 'veo' || actualModel.startsWith('veo_3_1')) {
    const hasReferenceImage = !!startImageBase64;
    actualModel = getVeoModelName(hasReferenceImage, aspectRatio);
    console.log(`🎬 Đang dùng mô hình Veo: ${actualModel} (${aspectRatio})`);
    
    // Veo 不支持 1:1 方形视频
    if (aspectRatio === '1:1') {
      console.warn('⚠️ Veo không hỗ trợ video vuông (1:1); sẽ dùng tỷ lệ ngang 16:9');
      actualModel = getVeoModelName(hasReferenceImage, '16:9');
    }
  }
  
  // Veo 模型使用同步模式 (/v1/chat/completions)
  // Clean base64 strings
  const cleanStart = startImageBase64?.replace(/^data:image\/(png|jpeg|jpg);base64,/, '') || '';
  const cleanEnd = endImageBase64?.replace(/^data:image\/(png|jpeg|jpg);base64,/, '') || '';

  // Build request body based on model requirements
  const messages: any[] = [
    { role: 'user', content: prompt }
  ];

  // Add images as content if provided
  if (cleanStart) {
    messages[0].content = [
      { type: 'text', text: prompt },
      { 
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${cleanStart}` }
      }
    ];
  }

  if (cleanEnd) {
    if (Array.isArray(messages[0].content)) {
      messages[0].content.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${cleanEnd}` }
      });
    }
  }

  // Use non-streaming mode with increased timeout for video generation
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1200000); // 20 minutes timeout

  try {
    const response = await retryOperation(async () => {
      const res = await fetch(`${apiBase}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: actualModel,
          messages: messages,
          stream: false,
          temperature: 0.7
        }),
        signal: controller.signal
      });

      if (!res.ok) {
        const errorText = await res.text();
        throwFromVideoHttpError(res.status, errorText, 'veo');
      }

      return res;
    });

    clearTimeout(timeoutId);

    // Parse non-streaming response
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    // Look for video URL in the content
    const urlMatch = content.match(/(https?:\/\/[^\s]+\.mp4)/);
    const videoUrl = urlMatch ? urlMatch[1] : '';

    if (!videoUrl) {
      throw new Error('Tạo video thất bại (không có URL video)');
    }

    console.log('🎬 Đã nhận URL video, đang chuyển sang base64...');
    
    // 将视频URL转换为base64,避免URL过期问题
    try {
      const videoBase64 = await convertVideoUrlToBase64(videoUrl);
      console.log('✅ Đã chuyển video sang base64 để lưu an toàn trong IndexedDB');
      return videoBase64;
    } catch (error: any) {
      console.error('❌ Chuyển video sang base64 thất bại, dùng URL gốc:', error);
      // 如果转换失败,返回原始URL作为降级方案
      return videoUrl;
    }
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Tạo video hết thời gian chờ (20 phút)');
    }
    throw error;
  }
};

const buildContinueScriptPrompt = (existingScript: string, language: string): string => `
Bạn là một biên kịch giàu kinh nghiệm. Hãy đọc kỹ phần kịch bản hiện có dưới đây và viết tiếp diễn biến.

Yêu cầu:
1. Giữ nhất quán phong cách, giọng điệu, tính cách nhân vật và nhịp kể của bản gốc.
2. Phát triển tình tiết tự nhiên, logic và có quan hệ nhân quả rõ ràng; tránh chuyển hướng đột ngột.
3. Tăng xung đột kịch tính và sức nặng cảm xúc một cách hợp lý.
4. Phần viết tiếp dài khoảng 30–50% nội dung hiện có, không quá ngắn hoặc dài dòng.
5. Giữ nguyên định dạng kịch bản gồm mô tả cảnh, thoại và chỉ dẫn sân khấu.
6. Ngôn ngữ đầu ra: ${language}; dùng từ chính xác và tự nhiên.
7. Chỉ xuất phần kịch bản viết tiếp, không thêm giải thích, tiền tố hoặc hậu tố.

Kịch bản hiện có:
${existingScript}

Hãy viết tiếp trực tiếp, không thêm nhãn như “Phần tiếp theo:”.
`;

/** Viết tiếp kịch bản dựa trên nội dung hiện có. */
export const continueScript = async (existingScript: string, language: string = 'Vietnamese', model: string = DEFAULT_CHAT_MODEL_ID): Promise<string> => {
  console.log('✍️ continueScript được gọi - mô hình:', model);
  const startTime = Date.now();

  const prompt = buildContinueScriptPrompt(existingScript, language);

  try {
    const result = await retryOperation(() => chatCompletion(prompt, model, 0.8, 4096));
    const duration = Date.now() - startTime;
    
    await addRenderLogWithTokens({
      type: 'script-parsing',
      resourceId: 'continue-script',
      resourceName: 'AI viết tiếp kịch bản',
      status: 'success',
      model,
      duration,
      prompt: existingScript.substring(0, 200) + '...'
    });
    
    return result;
  } catch (error) {
    console.error('❌ Viết tiếp kịch bản thất bại:', error);
    throw error;
  }
};

/** Viết tiếp kịch bản ở chế độ luồng. */
export const continueScriptStream = async (
  existingScript: string,
  language: string = 'Vietnamese',
  model: string = DEFAULT_CHAT_MODEL_ID,
  onDelta?: (delta: string) => void
): Promise<string> => {
  console.log('✍️ continueScriptStream được gọi - mô hình:', model);
  const startTime = Date.now();

  const prompt = buildContinueScriptPrompt(existingScript, language);

  try {
    const result = await retryOperation(() => chatCompletionStream(prompt, model, 0.8, undefined, 600000, onDelta));
    const duration = Date.now() - startTime;

    await addRenderLogWithTokens({
      type: 'script-parsing',
      resourceId: 'continue-script',
      resourceName: 'AI viết tiếp kịch bản (luồng)',
      status: 'success',
      model,
      duration,
      prompt: existingScript.substring(0, 200) + '...'
    });

    return result;
  } catch (error) {
    console.error('❌ Viết tiếp kịch bản theo luồng thất bại:', error);
    throw error;
  }
};

const buildRewriteScriptPrompt = (originalScript: string, language: string): string => `
Bạn là cố vấn biên kịch chuyên nghiệp, có thế mạnh về cấu trúc, cảm xúc và kịch tính. Hãy viết lại kịch bản dưới đây một cách có hệ thống và sáng tạo để tăng tính liền mạch, trôi chảy và xung đột.

Yêu cầu:
1. Giữ cốt truyện cốt lõi, nhân vật chính và chủ đề của bản gốc.
2. Tối ưu cấu trúc để diễn biến có quan hệ nhân quả rõ ràng và logic.
3. Cải thiện chuyển cảnh để mạch kể tự nhiên.
4. Làm phong phú lời thoại, tăng cá tính, cảm xúc và độ chân thực; tránh máy móc.
5. Tăng xung đột và căng thẳng cảm xúc giữa các nhân vật.
6. Đào sâu nội tâm và cảm xúc nhân vật.
7. Cân bằng cao trào với khoảng lắng, tránh lê thê hoặc quá gấp.
8. Giữ hoặc tăng vừa phải độ dài để nội dung đầy đặn nhưng súc tích.
9. Tuân thủ định dạng kịch bản gồm tiêu đề cảnh, thoại và chỉ dẫn sân khấu.
10. Ngôn ngữ đầu ra: ${language}; bảo đảm văn phong phù hợp thể loại.

Kịch bản gốc:
${originalScript}

Chỉ xuất toàn bộ kịch bản đã viết lại, không thêm lời giải thích.
`;

/** Viết lại toàn bộ kịch bản để cải thiện cấu trúc và mạch kể. */
export const rewriteScript = async (originalScript: string, language: string = 'Vietnamese', model: string = DEFAULT_CHAT_MODEL_ID): Promise<string> => {
  console.log('🔄 rewriteScript được gọi - mô hình:', model);
  const startTime = Date.now();

  const prompt = buildRewriteScriptPrompt(originalScript, language);

  try {
    const result = await retryOperation(() => chatCompletion(prompt, model, 0.7, 8192));
    const duration = Date.now() - startTime;
    
    await addRenderLogWithTokens({
      type: 'script-parsing',
      resourceId: 'rewrite-script',
      resourceName: 'AI viết lại kịch bản',
      status: 'success',
      model,
      duration,
      prompt: originalScript.substring(0, 200) + '...'
    });
    
    return result;
  } catch (error) {
    console.error('❌ Viết lại kịch bản thất bại:', error);
    throw error;
  }
};

/** Viết lại kịch bản ở chế độ luồng. */
export const rewriteScriptStream = async (
  originalScript: string,
  language: string = 'Vietnamese',
  model: string = DEFAULT_CHAT_MODEL_ID,
  onDelta?: (delta: string) => void
): Promise<string> => {
  console.log('🔄 rewriteScriptStream được gọi - mô hình:', model);
  const startTime = Date.now();

  const prompt = buildRewriteScriptPrompt(originalScript, language);

  try {
    const result = await retryOperation(() => chatCompletionStream(prompt, model, 0.7, undefined, 600000, onDelta));
    const duration = Date.now() - startTime;

    await addRenderLogWithTokens({
      type: 'script-parsing',
      resourceId: 'rewrite-script',
      resourceName: 'AI viết lại kịch bản (luồng)',
      status: 'success',
      model,
      duration,
      prompt: originalScript.substring(0, 200) + '...'
    });

    return result;
  } catch (error) {
    console.error('❌ Viết lại kịch bản theo luồng thất bại:', error);
    throw error;
  }
};

/** Tối ưu đồng thời mô tả khung hình đầu và cuối để bảo đảm chuyển tiếp liền mạch. */
export const optimizeBothKeyframes = async (
  actionSummary: string,
  cameraMovement: string,
  sceneInfo: { location: string; time: string; atmosphere: string },
  characterInfo: string[],
  visualStyle: string,
  model: string = DEFAULT_CHAT_MODEL_ID
): Promise<{ startPrompt: string; endPrompt: string }> => {
  console.log('🎨 optimizeBothKeyframes được gọi - mô hình:', model);
  const startTime = Date.now();

  const stylePrompts: { [key: string]: string } = {
    'live-action': 'phim người đóng chân thực, photorealistic, 8K, quay phim chuyên nghiệp',
    'anime': 'anime Nhật Bản, cel-shaded, màu sắc sống động, chất lượng điện ảnh',
    '3d-animation': 'hoạt hình 3D CGI, chất liệu chi tiết, chất lượng Pixar/DreamWorks',
    'cyberpunk': 'thẩm mỹ cyberpunk, ánh sáng neon, công nghệ tương lai',
    'oil-painting': 'tranh sơn dầu, nét cọ rõ, bố cục mỹ thuật cổ điển'
  };

  const styleDesc = stylePrompts[visualStyle] || visualStyle;

  const prompt = `
Bạn là đạo diễn hình ảnh và họa sĩ ý tưởng điện ảnh. Hãy viết mô tả chi tiết cho khung hình đầu và cuối của một cảnh quay dài 8–10 giây.

Thông tin cảnh:
- Địa điểm: ${sceneInfo.location}
- Thời gian: ${sceneInfo.time}
- Không khí: ${sceneInfo.atmosphere}
- Hành động: ${actionSummary}
- Chuyển động máy: ${cameraMovement}
- Nhân vật: ${characterInfo.length > 0 ? characterInfo.join(', ') : 'Không có nhân vật cụ thể'}
- Phong cách: ${styleDesc}

Yêu cầu:
- Khung đầu thiết lập rõ bối cảnh, vị trí, biểu cảm, tư thế, ánh sáng và không gian cho hành động sắp diễn ra.
- Khung cuối thể hiện kết quả hành động, thay đổi cảm xúc, góc nhìn và bố cục do chuyển động máy tạo ra.
- Hai khung phải nhất quán về nhân vật, môi trường, phong cách, màu sắc và có quỹ đạo chuyển động hợp lý.
- Mỗi mô tả là một đoạn tiếng Việt khoảng 100–150 từ, giàu hình ảnh nhưng không gắn nhãn kỹ thuật.
- Bao gồm bố cục, tiền/trung/hậu cảnh, ánh sáng, màu sắc, chi tiết nhân vật, môi trường, chiều sâu trường ảnh và gợi ý chuyển động.

Chỉ trả về JSON hợp lệ:
{
  "startFrame": "Mô tả chi tiết khung hình đầu...",
  "endFrame": "Mô tả chi tiết khung hình cuối..."
}
`;

  try {
    const result = await retryOperation(() => chatCompletion(prompt, model, 0.7, 2048, 'json_object'));
    const duration = Date.now() - startTime;
    
    // Phân tích phản hồi JSON.
    const cleaned = cleanJsonString(result);
    const parsed = JSON.parse(cleaned);
    
    if (!parsed.startFrame || !parsed.endFrame) {
      throw new Error('Định dạng JSON do AI trả về không hợp lệ');
    }
    
    console.log('✅ AI đã tối ưu khung đầu và khung cuối, thời gian:', duration, 'ms');
    
    return {
      startPrompt: parsed.startFrame.trim(),
      endPrompt: parsed.endFrame.trim()
    };
  } catch (error: any) {
    console.error('❌ AI tối ưu khung hình thất bại:', error);
    throw new Error(`AI tối ưu khung hình thất bại: ${error.message}`);
  }
};

/** Tối ưu một khung hình; được giữ để tương thích với luồng cũ. */
export const optimizeKeyframePrompt = async (
  frameType: 'start' | 'end',
  actionSummary: string,
  cameraMovement: string,
  sceneInfo: { location: string; time: string; atmosphere: string },
  characterInfo: string[],
  visualStyle: string,
  model: string = DEFAULT_CHAT_MODEL_ID
): Promise<string> => {
  console.log(`🎨 optimizeKeyframePrompt được gọi - ${frameType === 'start' ? 'khung đầu' : 'khung cuối'} - mô hình:`, model);
  const startTime = Date.now();

  const frameLabel = frameType === 'start' ? 'khung hình đầu' : 'khung hình cuối';
  const frameFocus = frameType === 'start' 
    ? 'trạng thái ban đầu, tư thế mở đầu, chuẩn bị hành động và thiết lập bối cảnh'
    : 'trạng thái cuối, tư thế kết thúc, kết quả hành động và cao trào cảm xúc';

  const stylePrompts: { [key: string]: string } = {
    'live-action': 'phim người đóng chân thực, photorealistic, 8K, quay phim chuyên nghiệp',
    'anime': 'anime Nhật Bản, cel-shaded, màu sắc sống động, chất lượng điện ảnh',
    '3d-animation': 'hoạt hình 3D CGI, chất liệu chi tiết, chất lượng Pixar/DreamWorks',
    'cyberpunk': 'thẩm mỹ cyberpunk, ánh sáng neon, công nghệ tương lai',
    'oil-painting': 'tranh sơn dầu, nét cọ rõ, bố cục mỹ thuật cổ điển'
  };

  const styleDesc = stylePrompts[visualStyle] || visualStyle;

  const prompt = `
Bạn là đạo diễn hình ảnh và họa sĩ ý tưởng điện ảnh. Hãy viết mô tả cho ${frameLabel} của cảnh quay sau.

- Địa điểm: ${sceneInfo.location}
- Thời gian: ${sceneInfo.time}
- Không khí: ${sceneInfo.atmosphere}
- Hành động: ${actionSummary}
- Chuyển động máy: ${cameraMovement}
- Nhân vật: ${characterInfo.length > 0 ? characterInfo.join(', ') : 'Không có nhân vật cụ thể'}
- Phong cách: ${styleDesc}
- Trọng tâm: ${frameFocus}

Mô tả bằng một đoạn tiếng Việt khoảng 100–150 từ. Nêu rõ bố cục, cỡ cảnh, vị trí chủ thể, tiền/trung/hậu cảnh, nguồn sáng, nhiệt độ màu, bóng đổ, biểu cảm, tư thế, trang phục, môi trường, chiều sâu trường ảnh và gợi ý chuyển động. Chỉ mô tả hình ảnh tại đúng thời điểm này; không thêm nhãn, danh sách hay giải thích.
`;

  try {
    const result = await retryOperation(() => chatCompletion(prompt, model, 0.7, 1024));
    const duration = Date.now() - startTime;
    
    console.log(`✅ AI đã tối ưu ${frameLabel}, thời gian:`, duration, 'ms');
    
    return result.trim();
  } catch (error: any) {
    console.error(`❌ AI tối ưu ${frameLabel} thất bại:`, error);
    throw new Error(`AI tối ưu ${frameLabel} thất bại: ${error.message}`);
  }
};

/** Gợi ý hành động nối liền khung đầu và khung cuối. */
export const generateActionSuggestion = async (
  startFramePrompt: string,
  endFramePrompt: string,
  cameraMovement: string,
  model: string = DEFAULT_CHAT_MODEL_ID
): Promise<string> => {
  console.log('🎬 generateActionSuggestion được gọi - mô hình:', model);
  const startTime = Date.now();

  const actionReferenceExamples = `
Tham khảo phong cách: mô tả ngắn gọn nhưng giàu động lực, có một điểm nhấn thị giác rõ ràng, chuyển động máy điện ảnh và hành động khả thi trong 8–10 giây. Với cảnh hành động, ưu tiên nhịp tăng tốc–cao trào–hạ nhịp; với cảnh cảm xúc, ưu tiên vi biểu cảm, cử chỉ và thay đổi ánh sáng có chủ đích.
`;

  const prompt = `
Bạn là đạo diễn hành động và cố vấn kể chuyện điện ảnh. Hãy thiết kế hành động nối tự nhiên từ khung đầu đến khung cuối.

- Khung đầu: ${startFramePrompt}
- Khung cuối: ${endFramePrompt}
- Chuyển động máy: ${cameraMovement}

${actionReferenceExamples}

Yêu cầu:
1. Hành động hoàn tất trong 8–10 giây và có logic không gian rõ ràng.
2. Ưu tiên một cảnh quay liên tục; chỉ dùng tối đa 2–3 cú cắt nhanh khi thực sự cần.
3. Mô tả điểm nhấn hình ảnh, hiệu ứng hoặc chuyển biến cảm xúc và cách máy quay hỗ trợ chúng.
4. Không lặp lại nguyên văn prompt đầu/cuối, không chia thành “Cảnh 1, Cảnh 2”.
5. Chỉ trả về một đoạn mô tả hành động bằng tiếng Việt, súc tích và có tính điện ảnh.
`;

  try {
    const result = await retryOperation(() => chatCompletion(prompt, model, 0.8, 2048));
    const duration = Date.now() - startTime;
    
    console.log('✅ AI đã tạo gợi ý hành động, thời gian:', duration, 'ms');
    
    return result.trim();
  } catch (error: any) {
    console.error('❌ AI tạo gợi ý hành động thất bại:', error);
    throw new Error(`AI tạo gợi ý hành động thất bại: ${error.message}`);
  }
};

/** Viết lại prompt video theo hướng an toàn hơn nhưng giữ ý đồ điện ảnh. */
export const rewritePromptForModeration = async (
  videoPrompt: string,
  model?: string
): Promise<string> => {
  const chatModel = model || getActiveChatModel()?.apiModel || getActiveChatModel()?.id || 'gpt-4o';
  const prompt = `
Bạn là biên tập viên kịch bản và cố vấn an toàn nội dung. Prompt video dưới đây đã bị bộ lọc nội dung chặn.

Hãy viết lại theo hướng nhẹ nhàng hơn mà không thay đổi không khí, diễn biến và ý đồ máy quay:
- Thay mô tả trực diện về bạo lực, máu me, thi thể hoặc thương tích bằng ngôn ngữ gợi tả, không đồ họa.
- Giữ thời gian, địa điểm, hành động, chuyển động máy, ánh sáng và cảm xúc.
- Giữ nguyên ngôn ngữ của văn bản gốc.
- Chỉ xuất prompt hoàn chỉnh đã viết lại, không thêm tiền tố hoặc giải thích.

Prompt gốc:
${videoPrompt}

Prompt đã viết lại:
`;
  const result = await retryOperation(() => chatCompletion(prompt, chatModel, 0.5, 4096));
  return result.trim();
};

/**
 * AI镜头拆分功能 - 将单个镜头拆分为多个细致的子镜头
 * 根据动作描述，按照景别（全景、中景、特写）和视角拆分镜头
 * @param shot - 原始镜头对象
 * @param sceneInfo - 场景信息（地点、时间、氛围）
 * @param characterNames - 角色名称数组
 * @param visualStyle - 视觉风格
 * @param model - 使用的模型，默认DEFAULT_CHAT_MODEL_ID
 * @returns 返回包含子镜头数组的对象
 */
export const splitShotIntoSubShots = async (
  shot: any, // Shot type from types.ts
  sceneInfo: { location: string; time: string; atmosphere: string },
  characterNames: string[],
  visualStyle: string,
  model: string = DEFAULT_CHAT_MODEL_ID
): Promise<{ subShots: any[] }> => {
  console.log('✂️ splitShotIntoSubShots được gọi - mô hình:', model);
  const startTime = Date.now();

  const stylePrompts: { [key: string]: string } = {
    'live-action': 'phim người đóng chân thực',
    'anime': 'anime Nhật Bản',
    '3d-animation': 'hoạt hình 3D CGI',
    'cyberpunk': 'thẩm mỹ cyberpunk',
    'oil-painting': 'mỹ thuật sơn dầu'
  };

  const styleDesc = stylePrompts[visualStyle] || visualStyle;

  const prompt = `
你是一位专业的电影分镜师和导演。你的任务是将一个粗略的镜头描述，拆分为多个细致、专业的子镜头。

## 原始镜头信息

**场景地点：** ${sceneInfo.location}
**场景时间：** ${sceneInfo.time}
**场景氛围：** ${sceneInfo.atmosphere}
**角色：** ${characterNames.length > 0 ? characterNames.join('、') : '无特定角色'}
**视觉风格：** ${styleDesc}
**原始镜头运动：** ${shot.cameraMovement || '未指定'}

**原始动作描述：**
${shot.actionSummary}

${shot.dialogue ? `**对白：** "${shot.dialogue}"

⚠️ **对白处理说明**：原始镜头包含对白。请在拆分时，将对白放在最合适的子镜头中（通常是角色说话的中景或近景镜头），并在该子镜头的actionSummary中明确提及对白内容。其他子镜头不需要包含对白。` : ''}

## 拆分要求

### 核心原则
1. **单一职责**：每个子镜头只负责一个视角或动作细节，避免混合多个视角
2. **时长控制**：每个子镜头时长约2-4秒，总时长保持在8-10秒左右
3. **景别多样化**：合理运用全景、中景、特写等不同景别
4. **连贯性**：子镜头之间要有逻辑的视觉过渡和叙事连贯性

### 拆分维度示例

**景别分类（Shot Size）：**
- **远景 Long Shot / 全景 Wide Shot**：展示整体环境、人物位置关系、空间布局
- **中景 Medium Shot**：展示人物上半身或腰部以上，强调动作和表情
- **近景 Close-up**：展示人物头部或重要物体，强调情感和细节
- **特写 Extreme Close-up**：聚焦关键细节（如手部动作、眼神、物体特写）

**拆分策略：**
- 如果原始描述是"我在书房走向书桌坐下来，打开电脑"，应拆分为：
  1. 全景：展示我从书房门口走向书桌的整体环境
  2. 中景：我走到椅子前准备坐下的动作
  3. 特写：我坐下时身体与椅子接触的瞬间
  4. 近景：我伸手按下电脑开机键或打开笔记本盖

- 如果原始描述是连续的打斗动作，应从不同视角拆分：
  1. 远景：展示双方对峙的整体画面
  2. 中景：第一次攻击动作
  3. 特写：拳头或武器的碰撞细节
  4. 近景：角色面部反应

### 必须包含的字段

每个子镜头必须包含以下信息：

1. **shotSize**（景别）：明确标注景别类型（全景、中景、特写等）
2. **cameraMovement**（镜头运动）：描述镜头如何移动（静止、推进、跟踪、环绕等）
3. **actionSummary**（动作描述）：清晰、具体的动作和画面内容描述（60-100字）
4. **visualFocus**（视觉焦点）：这个镜头的视觉重点是什么（如"人物移动轨迹"、"手部特写"、"面部表情变化"等）
5. **keyframes**（关键帧数组）：包含起始帧(start)和结束帧(end)的视觉描述
   - 每个关键帧必须包含：
     - **type**: "start" 或 "end"
     - **visualPrompt**: 详细的画面视觉描述（用于AI图像生成），包含场景、人物、光影、构图等细节（100-150字）

### 专业镜头运动参考

可从以下类型中选择或自定义：
- 静止镜头 Static Shot
- 推镜头 Dolly Shot / 拉镜头 Zoom Out
- 跟踪镜头 Tracking Shot
- 平移镜头 Pan Shot
- 环绕镜头 Circular Shot
- 俯视镜头 High Angle / 仰视镜头 Low Angle
- 主观视角 POV Shot
- 越肩镜头 Over the Shoulder

## 输出格式

请输出JSON格式，结构如下：

\`\`\`json
{
  "subShots": [
    {
      "shotSize": "全景 Wide Shot",
      "cameraMovement": "静止镜头 Static Shot",
      "actionSummary": "镜头从书房门口的角度，展示整个书房空间，我从门口缓步走向位于房间中央的书桌，背景可见书架、窗户和温暖的灯光。",
      "visualFocus": "整体环境布局和人物移动轨迹",
      "keyframes": [
        {
          "type": "start",
          "visualPrompt": "书房全景，${styleDesc}，我站在门口，身体朝向书桌方向，准备迈步。房间中央是深色木质书桌，背后是装满书籍的书架，窗户透进柔和的自然光，营造温馨的学习氛围。构图采用三分法，人物位于左侧，书桌位于画面中心。"
        },
        {
          "type": "end",
          "visualPrompt": "书房全景，${styleDesc}，我已走到书桌旁边，身体靠近椅子，手即将触碰椅背。画面保持整体环境视角，展示完整的移动轨迹。光线保持一致，强调空间的纵深感。"
        }
      ]
    },
    {
      "shotSize": "中景 Medium Shot",
      "cameraMovement": "跟踪镜头 Tracking Shot",
      "actionSummary": "镜头跟随我走到书桌前，拍摄腰部以上，我伸手拉开椅子，身体微微前倾准备坐下。",
      "visualFocus": "人物上半身动作和与椅子的互动",
      "keyframes": [
        {
          "type": "start",
          "visualPrompt": "中景人物镜头，${styleDesc}，拍摄腰部以上，我正在接近书桌，手臂自然摆动，表情专注。背景虚化的书架和窗户，突出人物主体。侧面光勾勒人物轮廓。"
        },
        {
          "type": "end",
          "visualPrompt": "中景人物镜头，${styleDesc}，我的手已抓住椅背，身体微微前倾，准备坐下的姿态。表情放松，眼神看向座位。背景保持虚化，强调动作细节。"
        }
      ]
    },
    {
      "shotSize": "特写 Close-up",
      "cameraMovement": "静止镜头 Static Shot",
      "actionSummary": "特写镜头聚焦在我的臀部和椅子座面，捕捉我坐下的瞬间，椅子轻微下沉的动作。",
      "visualFocus": "身体与椅子接触的细节瞬间",
      "keyframes": [
        {
          "type": "start",
          "visualPrompt": "特写镜头，${styleDesc}，聚焦椅子座面和我即将坐下的臀部位置，椅子为深色皮革材质，反射柔和光线。身体正在下降，距离椅面约10厘米。浅景深，背景完全虚化。"
        },
        {
          "type": "end",
          "visualPrompt": "特写镜头，${styleDesc}，身体已完全坐在椅子上，座面轻微凹陷，皮革产生自然的皱褶。捕捉接触瞬间的微妙变化，展现材质质感和重量感。"
        }
      ]
    },
    {
      "shotSize": "近景 Close Shot",
      "cameraMovement": "推镜头 Dolly In",
      "actionSummary": "镜头从侧面推进，拍摄我端坐在椅子上，手伸向电脑，按下开机键，屏幕亮起微光照亮脸部。",
      "visualFocus": "手部按键动作和屏幕亮起的瞬间",
      "keyframes": [
        {
          "type": "start",
          "visualPrompt": "近景侧面镜头，${styleDesc}，我端坐在椅子上，上半身和电脑在画面中。手臂伸向笔记本电脑，手指即将触碰键盘或电源键。电脑屏幕暗黑，面部被环境光照亮，表情期待。"
        },
        {
          "type": "end",
          "visualPrompt": "近景侧面镜头，${styleDesc}，镜头推进更近，手指已按下开机键，屏幕亮起柔和的蓝白色光芒，照亮我的脸部轮廓和手部。表情专注，眼神看向屏幕，营造科技氛围。"
        }
      ]
    }
  ]
}
\`\`\`

**关键帧visualPrompt要求**：
- 必须包含视觉风格标记（${styleDesc}）
- 详细描述画面构图、光影、色彩、景深等视觉元素
- 起始帧和结束帧要有明显的视觉差异，体现动作过程
- 长度控制在100-150字，既详细又不过于冗长
- 使用专业的摄影和美术术语

## 重要提示

❌ **避免：**
- 不要在单个子镜头中混合多个视角或景别
- 不要拆分过细导致总时长超过10秒
- 不要使用过于技术化或晦涩的术语
- 不要忽略视觉连贯性

✅ **追求：**
- 每个子镜头职责清晰、画面感强
- 景别和视角多样化但符合叙事逻辑
- 动作描述具体、可执行
- 保持电影级的专业表达

请开始拆分，直接输出JSON格式（不要包含markdown代码块标记）：
`;

  const localizedPrompt = `
Bạn là họa sĩ storyboard và đạo diễn điện ảnh. Hãy chia cảnh quay thô thành các cảnh quay con rõ ràng, chuyên nghiệp.

Thông tin nguồn:
- Địa điểm: ${sceneInfo.location}
- Thời gian: ${sceneInfo.time}
- Không khí: ${sceneInfo.atmosphere}
- Nhân vật: ${characterNames.length > 0 ? characterNames.join(', ') : 'Không có nhân vật cụ thể'}
- Phong cách: ${styleDesc}
- Chuyển động máy ban đầu: ${shot.cameraMovement || 'Chưa chỉ định'}
- Hành động: ${shot.actionSummary}
${shot.dialogue ? `- Thoại: "${shot.dialogue}"` : ''}

Yêu cầu:
1. Mỗi cảnh con chỉ có một góc nhìn hoặc một chi tiết hành động, dài khoảng 2–4 giây; tổng thời lượng 8–10 giây.
2. Kết hợp hợp lý toàn cảnh, trung cảnh, cận cảnh và đặc tả; bảo đảm chuyển tiếp liên tục.
3. Nếu có thoại, đặt toàn bộ câu thoại vào cảnh con phù hợp nhất và nêu rõ trong actionSummary.
4. Mỗi cảnh con phải có shotSize, cameraMovement, actionSummary, visualFocus và hai keyframes loại start/end.
5. Mỗi visualPrompt dài khoảng 100–150 từ tiếng Việt, gồm bố cục, nhân vật, ánh sáng, màu sắc, chiều sâu trường ảnh và phong cách ${styleDesc}.

Chỉ trả về JSON hợp lệ theo cấu trúc:
{
  "subShots": [
    {
      "shotSize": "Cỡ cảnh",
      "cameraMovement": "Chuyển động máy",
      "actionSummary": "Mô tả hành động",
      "visualFocus": "Trọng tâm hình ảnh",
      "keyframes": [
        { "type": "start", "visualPrompt": "Mô tả khung đầu" },
        { "type": "end", "visualPrompt": "Mô tả khung cuối" }
      ]
    }
  ]
}
`;

  try {
    const result = await retryOperation(() => chatCompletion(localizedPrompt, model, 0.7, 4096, 'json_object'));
    const duration = Date.now() - startTime;
    
    // Làm sạch và phân tích JSON.
    const cleaned = cleanJsonString(result);
    const parsed = JSON.parse(cleaned);
    
    if (!parsed.subShots || !Array.isArray(parsed.subShots) || parsed.subShots.length === 0) {
      throw new Error('JSON do AI trả về không hợp lệ hoặc mảng cảnh quay con đang trống');
    }
    
    // Xác thực các trường bắt buộc của mỗi cảnh quay con.
    for (const subShot of parsed.subShots) {
      if (!subShot.shotSize || !subShot.cameraMovement || !subShot.actionSummary || !subShot.visualFocus) {
        throw new Error('Cảnh quay con thiếu shotSize, cameraMovement, actionSummary hoặc visualFocus');
      }
      
      // Xác thực mảng khung hình chính.
      if (!subShot.keyframes || !Array.isArray(subShot.keyframes) || subShot.keyframes.length === 0) {
        throw new Error('Cảnh quay con thiếu mảng keyframes');
      }
      
      // Xác thực từng khung hình.
      for (const kf of subShot.keyframes) {
        if (!kf.type || !kf.visualPrompt) {
          throw new Error('Khung hình thiếu type hoặc visualPrompt');
        }
        if (kf.type !== 'start' && kf.type !== 'end') {
          throw new Error('type của khung hình phải là "start" hoặc "end"');
        }
      }
    }
    
    console.log(`✅ Đã tạo ${parsed.subShots.length} cảnh quay con, thời gian:`, duration, 'ms');
    
    // Ghi nhật ký thành công.
    addRenderLogWithTokens({
      type: 'script-parsing',
      resourceId: `shot-split-${shot.id}-${Date.now()}`,
      resourceName: `Tách cảnh quay - ${shot.actionSummary.substring(0, 30)}...`,
      status: 'success',
      model: model,
      prompt: localizedPrompt.substring(0, 200) + '...',
      duration: duration
    });
    
    return parsed;
  } catch (error: any) {
    console.error('❌ Tách cảnh quay thất bại:', error);
    
    // Ghi nhật ký thất bại.
    addRenderLogWithTokens({
      type: 'script-parsing',
      resourceId: `shot-split-${shot.id}-${Date.now()}`,
      resourceName: `Tách cảnh quay - ${shot.actionSummary.substring(0, 30)}...`,
      status: 'failed',
      model: model,
      prompt: localizedPrompt.substring(0, 200) + '...',
      error: error.message,
      duration: Date.now() - startTime
    });
    
    throw new Error(`Tách cảnh quay thất bại: ${error.message}`);
  }
};

/**
 * AI增强关键帧提示词 - 添加详细的技术规格和视觉细节
 * 使用LLM根据基础提示词生成专业的电影级视觉描述
 * @param basePrompt - 基础提示词(包含场景、角色、动作等基本信息)
 * @param visualStyle - 视觉风格
 * @param cameraMovement - 镜头运动
 * @param frameType - 帧类型(start/end)
 * @param model - 使用的模型,默认DEFAULT_CHAT_MODEL_ID
 * @returns 返回增强后的提示词
 */
export const enhanceKeyframePrompt = async (
  basePrompt: string,
  visualStyle: string,
  cameraMovement: string,
  frameType: 'start' | 'end',
  model: string = DEFAULT_CHAT_MODEL_ID
): Promise<string> => {
  console.log(`🎨 enhanceKeyframePrompt được gọi - ${frameType === 'start' ? 'khung đầu' : 'khung cuối'} - mô hình:`, model);
  const startTime = Date.now();

  const stylePrompts: { [key: string]: string } = {
    'live-action': 'phim người đóng chân thực, photorealistic, 8K Ultra HD',
    'anime': 'anime Nhật Bản, cel-shaded, màu sắc bão hòa',
    '3d-animation': 'hoạt hình 3D CGI, chất lượng kết xuất điện ảnh',
    'cyberpunk': 'thẩm mỹ cyberpunk, ánh sáng neon, công nghệ tương lai',
    'oil-painting': 'mỹ thuật sơn dầu, nét cọ rõ, bố cục cổ điển'
  };

  const styleDesc = stylePrompts[visualStyle] || visualStyle;
  const frameLabel = frameType === 'start' ? 'khung hình đầu' : 'khung hình cuối';

  const prompt = `
你是一位资深的电影摄影指导和视觉特效专家。请基于以下基础提示词,生成一个包含详细技术规格和视觉细节的专业级${frameLabel}描述。

## 基础提示词
${basePrompt}

## 视觉风格
${styleDesc}

## 镜头运动
${cameraMovement}

## ${frameLabel}要求
${frameType === 'start' ? '建立清晰的初始状态、起始姿态、为后续运动预留空间' : '展现最终状态、动作完成、情绪高潮'}

## 任务
请在基础提示词的基础上,添加以下专业的电影级视觉规格描述:

### 1. 技术规格 (Technical Specifications)
- 分辨率规格 (8K等)
- 镜头语言和摄影美学
- 景深控制和焦点策略

### 2. 视觉细节 (Visual Details)  
- 光影层次: 三点布光、阴影与高光的配置
- 色彩饱和度: 色彩分级、色温控制
- 材质质感: 表面纹理、细节丰富度
- 大气效果: 体积光、雾气、粒子、天气效果

### 3. 角色要求 (Character Details) - 如果有角色
⚠️ 最高优先级: 如果提供了角色参考图,必须严格保持人物外观的完全一致性!
- 角色识别: 严格按照参考图中人物的面部特征、发型发色、服装造型
- 面部特征: 五官轮廓、眼睛颜色形状、鼻子嘴巴结构必须与参考图一致
- 发型发色: 头发长度、颜色、质感、发型样式必须完全匹配参考图
- 服装造型: 服装款式、颜色、材质必须与参考图保持一致
- 面部表情: 在保持外观一致的基础上,添加微表情、情绪真实度、眼神方向
- 肢体语言: 在保持体型一致的基础上,展现自然的身体姿态、重心分布、肌肉张力
- 服装细节: 服装的运动感、物理真实性、纹理细节
- 毛发细节: 头发丝、自然的毛发运动

### 4. 环境要求 (Environment Details)
- 背景层次: 前景、中景、背景的深度分离
- 空间透视: 准确的线性透视、大气透视
- 环境光影: 光源的真实性、阴影投射
- 细节丰富度: 环境叙事元素、纹理变化

### 5. 氛围营造 (Mood & Atmosphere)
- 情绪基调与场景情感的匹配
- 色彩心理学的运用
- 视觉节奏的平衡
- 叙事的视觉暗示

### 6. 质量保证 (Quality Assurance)
- 主体清晰度和轮廓
- 背景过渡的自然性
- 光影一致性
- 色彩协调性
- 构图平衡(三分法或黄金比例)
- 动作连贯性

## 输出格式
请使用清晰的分节格式输出,包含上述所有要素。使用中文输出,保持专业性和可读性。

格式示例:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【技术规格】Technical Specifications
• 分辨率: ...

【视觉细节】Visual Details  
• 光影层次: ...
• 色彩饱和度: ...

(依次类推)

请开始创作:
`;

  const localizedPrompt = `
Bạn là giám đốc hình ảnh và chuyên gia hiệu ứng thị giác. Hãy nâng cấp prompt cơ sở thành mô tả ${frameLabel} chuyên nghiệp bằng tiếng Việt.

Prompt cơ sở:
${basePrompt}

Phong cách: ${styleDesc}
Chuyển động máy: ${cameraMovement}
Mục tiêu khung hình: ${frameType === 'start' ? 'thiết lập trạng thái ban đầu và chừa không gian cho chuyển động tiếp theo' : 'thể hiện kết quả hành động và cao trào cảm xúc'}

Hãy bổ sung có cấu trúc:
- Thông số hình ảnh: độ phân giải, ngôn ngữ ống kính, chiều sâu trường ảnh và chiến lược lấy nét.
- Ánh sáng, phân cấp màu, nhiệt độ màu, chất liệu và hiệu ứng khí quyển.
- Nếu có nhân vật tham chiếu, giữ tuyệt đối khuôn mặt, tóc, vóc dáng và trang phục; chỉ thay đổi biểu cảm/tư thế hợp lý.
- Lớp tiền cảnh, trung cảnh, hậu cảnh, phối cảnh và chi tiết kể chuyện của môi trường.
- Sắc thái cảm xúc, nhịp thị giác, độ rõ chủ thể, tính nhất quán ánh sáng và bố cục.

Trả về phần bổ sung rõ ràng, dễ đọc; không nhắc lại yêu cầu.
`;

  try {
    const result = await retryOperation(() => chatCompletion(localizedPrompt, model, 0.7, 3072));
    const duration = Date.now() - startTime;
    
    console.log(`✅ AI đã tăng cường ${frameLabel}, thời gian:`, duration, 'ms');
    
    // Kết hợp prompt cơ sở và phần tăng cường.
    return `${basePrompt}

${result.trim()}`;
  } catch (error: any) {
    console.error(`❌ AI tăng cường ${frameLabel} thất bại:`, error);
    // Trả về prompt cơ sở khi tăng cường thất bại.
    console.warn('⚠️ Đang quay lại prompt cơ sở');
    return basePrompt;
  }
};

