import { ScriptData, Shot, Character, Scene, AspectRatio, VideoDuration } from "../types";
import {
  DEFAULT_CHAT_MODEL_ID,
  DEFAULT_IMAGE_MODEL_ID,
  DEFAULT_VIDEO_MODEL_ID,
  DEFAULT_PROVIDER_ID,
  SHOPAIKEY_PROVIDER_ID,
  ChatModelDefinition,
  ImageModelDefinition,
  MediaExecutionContext,
  VideoModelDefinition,
} from '../types/model';
import {
  shouldUseImagesGenerationsEndpoint,
  callImagesGenerationsApi,
  extractImageFromApiResponse,
  normalizeImageResult,
} from './imageGenerationHelpers';
import { addRenderLogWithTokens } from './renderLogService';
import { throwFromVideoHttpError, formatVideoTaskErrorForUser } from './videoHttpErrors';
import { resolveSoraVideoDownloadId, downloadSoraCompletedVideo, encodeVideoPathId } from './soraVideoResolve';
import { localizeApiErrorMessage } from './apiErrorLocalization';
import {
  setGlobalApiKey as setRegistryApiKey,
  getApiBaseUrlForModel,
  getApiKeyForModel,
  getModelById,
  getModels,
  getActiveModel,
  getActiveChatModel,
  getProviderById,
  getApiBaseUrlForProvider,
} from './modelRegistry';
import { callImageApi } from './adapters/imageAdapter';
import { callVideoApi } from './adapters/videoAdapter';
import { callChatApi } from './adapters/chatAdapter';
import { verifyProviderApiKey } from './providerService';
import { parseModelJson } from './jsonResponse';
import { assertGenerationAllowed } from './promptPreflight';
import { selectImageModelForGeneration } from './imageModelSelection';
import {
  buildMediaInputSignature,
  createBillableHttpError,
  createConfirmedBillableFailure,
  executeBillableMedia,
  submitPaidTaskSafely,
} from './mediaExecutionService';

export class ApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiKeyError';
  }
}

export const setGlobalApiKey = (key: string) => {
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
  
  throw new ApiKeyError('Thiếu khóa API của nhà cung cấp đang chọn. Hãy mở Cấu hình mô hình để thêm khóa.');
};

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
  return getApiBaseUrlForProvider(DEFAULT_PROVIDER_ID);
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

export const verifyApiKey = async (key: string): Promise<{ success: boolean; message: string }> => {
  return verifyProviderApiKey(DEFAULT_PROVIDER_ID, key);
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
      const isRetryableError = !e.modelRoutingExhausted && (
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
        e.status >= 500
      );
      
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
  const resolvedModel = resolveModel('chat', model) as ChatModelDefinition | undefined;
  return callChatApi({
    prompt,
    responseFormat: responseFormat === 'json_object' ? 'json' : 'text',
    timeout,
    overrideParams: { temperature, maxTokens },
  }, resolvedModel);
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
  const resolvedModel = resolveModel('chat', model) as ChatModelDefinition | undefined;
  if (resolvedModel?.providerId === SHOPAIKEY_PROVIDER_ID) {
    // Tuyến nội bộ ưu tiên độ tin cậy và fallback có kiểm soát. Trả kết quả
    // một lần cho UI thay vì giữ một đường SSE cũ bỏ qua router trung tâm.
    const result = await callChatApi({
      prompt,
      responseFormat: responseFormat === 'json_object' ? 'json' : 'text',
      timeout,
      overrideParams: { temperature },
    }, resolvedModel);
    onDelta?.(result);
    return result;
  }
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
      throw new Error(localizeApiErrorMessage(errorMessage, response.status));
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
 * Tác vụ 1 và 2: cấu trúc và phân rã kịch bản dài theo hai giai đoạn.
 * Giai đoạn 1 chỉ trích xuất tiêu đề, thể loại, tóm tắt, nhân vật và bối cảnh.
 * Giai đoạn 2 trích xuất các đoạn truyện theo từng cảnh rồi hợp nhất.
 */
export const parseScriptToData = async (rawText: string, language: string = 'Vietnamese', model: string = DEFAULT_CHAT_MODEL_ID, visualStyle: string = 'live-action'): Promise<ScriptData> => {
  console.log('📝 parseScriptToData được gọi (hai giai đoạn) - mô hình:', model, 'phong cách:', visualStyle);
  const startTime = Date.now();
  const inputText = rawText.slice(0, SCRIPT_INPUT_MAX_CHARS);
  if (rawText.length > SCRIPT_INPUT_MAX_CHARS) {
    console.warn(`[parseScriptToData] Kịch bản đã được cắt còn ${SCRIPT_INPUT_MAX_CHARS} ký tự; độ dài ban đầu: ${rawText.length}`);
  }

  try {
    // Giai đoạn 1: chỉ trích xuất cấu trúc, chưa gồm các đoạn truyện.
    const structurePrompt = `
Phân tích nội dung và trả về đối tượng JSON bằng ngôn ngữ: ${language}.

Yêu cầu:
1. Trích xuất tiêu đề, thể loại và tóm tắt bằng ${language}.
2. Trích xuất nhân vật gồm id, tên, giới tính, tuổi và tính cách.
3. Trích xuất bối cảnh gồm id, địa điểm, thời gian và không khí.
Không trả về storyParagraphs ở bước này.

Nội dung đầu vào:
"${inputText}"

Chỉ trả về JSON hợp lệ theo cấu trúc sau, không kèm storyParagraphs:
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
      parsed = parseModelJson(text);
    } catch (e) {
      console.error('Không thể phân tích JSON cấu trúc kịch bản:', e);
      console.error('Phản hồi gốc (500 ký tự đầu):', responseText.slice(0, 500));
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

    // Giai đoạn 2: trích xuất các đoạn truyện theo từng cảnh.
    const storyParagraphs: { id: number; text: string; sceneRefId: string }[] = [];
    let nextId = 1;

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const scenePrompt = `
Dựa trên kịch bản và danh sách bối cảnh dưới đây, chỉ trích xuất các đoạn truyện thuộc bối cảnh này.
Bối cảnh cần trích xuất: id="${scene.id}", địa điểm="${scene.location}".

Toàn bộ kịch bản:
"${inputText}"

Tất cả mã bối cảnh để tham chiếu: ${scenes.map((s: any) => s.id).join(', ')}

Chỉ trả về một mảng JSON. Mỗi phần tử có dạng: {"id": number, "text": string, "sceneRefId": "${scene.id}"}.
Dùng các đoạn văn ngắn. Ngôn ngữ: ${language}.
`;

      try {
        if (i > 0) await new Promise((r) => setTimeout(r, 800));
        const paraResponse = await retryOperation(() =>
          chatCompletion(scenePrompt, model, 0.5, PARAGRAPHS_CHUNK_MAX_TOKENS, 'json_object')
        );
        const paraCleaned = cleanJsonString(paraResponse);
        let arr: any[] = [];
        try {
          const parsedPara = parseModelJson<any>(paraCleaned);
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
Chia câu chuyện thành các đoạn văn liên kết với bối cảnh. Ngôn ngữ: ${language}.
Kịch bản:
"${inputText.slice(0, 60000)}"

Các bối cảnh (dùng đúng sceneRefId này): ${JSON.stringify(scenes.map((s: any) => ({ id: s.id, location: s.location })))}

Chỉ trả về JSON hợp lệ: { "storyParagraphs": [ {"id": number, "text": "string", "sceneRefId": "string"} ] }
`;
      try {
        const fallbackResp = await retryOperation(() =>
          chatCompletion(fallbackPrompt, model, 0.6, LONG_FORM_MAX_TOKENS, 'json_object')
        );
        const fallbackParsed = parseModelJson<any>(cleanJsonString(fallbackResp));
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
    console.log('🎨 Đang tạo câu lệnh hình ảnh cho nhân vật và bối cảnh...', `phong cách: ${visualStyle}`);
    for (let i = 0; i < characters.length; i++) {
      try {
        if (i > 0) await new Promise((resolve) => setTimeout(resolve, 1500));
        const prompts = await generateVisualPrompts('character', characters[i], genre, model, visualStyle, language);
        characters[i].visualPrompt = prompts.visualPrompt;
        (characters[i] as any).negativePrompt = prompts.negativePrompt;
      } catch (e) {
        console.error(`Không thể tạo câu lệnh hình ảnh cho nhân vật ${characters[i].name}:`, e);
      }
    }
    for (let i = 0; i < scenes.length; i++) {
      try {
        if (i > 0 || characters.length > 0) await new Promise((resolve) => setTimeout(resolve, 1500));
        const prompts = await generateVisualPrompts('scene', scenes[i], genre, model, visualStyle, language);
        scenes[i].visualPrompt = prompts.visualPrompt;
        (scenes[i] as any).negativePrompt = prompts.negativePrompt;
      } catch (e) {
        console.error(`Không thể tạo câu lệnh hình ảnh cho bối cảnh ${scenes[i].location}:`, e);
      }
    }

    console.log('✅ Đã tạo xong câu lệnh hình ảnh');
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
      Bạn là một nhà quay phim chuyên nghiệp. Hãy tạo danh sách cảnh quay chi tiết cho Bối cảnh ${index + 1}.
      Ngôn ngữ đầu ra: ${lang}.
      
      PHONG CÁCH HÌNH ẢNH BẮT BUỘC: ${stylePrompt}
      Mọi trường 'visualPrompt' phải mô tả cảnh quay theo phong cách "${visualStyle}" này.
      
      Chi tiết bối cảnh:
      Địa điểm: ${scene.location}
      Thời gian: ${scene.time}
      Không khí: ${scene.atmosphere}
      
      Hành động trong bối cảnh:
      "${paragraphs.slice(0, 12000)}"
      
      Ngữ cảnh:
      Thể loại: ${scriptData.genre}
      Phong cách hình ảnh: ${visualStyle} (${stylePrompt})
      Thời lượng mục tiêu của toàn kịch bản: ${scriptData.targetDuration || 'Tiêu chuẩn'}
      Tổng số cảnh quay dự kiến: ${totalShotsNeeded} cảnh, mỗi cảnh tương ứng 10 giây video
      Số cảnh quay cho bối cảnh này: khoảng ${shotsPerScene} cảnh
      
      Nhân vật:
      ${JSON.stringify(scriptData.characters.map(c => ({ id: c.id, name: c.name, desc: c.visualPrompt || c.personality })))}

      Danh mục chuyển động máy quay chuyên nghiệp:
      - Trượt ngang sang trái
      - Trượt ngang sang phải
      - Lia trái
      - Lia phải
      - Di chuyển thẳng lên
      - Di chuyển thẳng xuống
      - Ngẩng máy lên
      - Hạ máy xuống
      - Thu nhỏ hoặc lùi xa
      - Phóng to hoặc tiến gần
      - Dolly tiến hoặc lùi
      - Quay vòng quanh chủ thể
      - Góc máy qua vai
      - Lia máy
      - Góc máy thấp
      - Góc máy cao
      - Bám theo chủ thể
      - Máy cầm tay
      - Máy quay cố định
      - Góc nhìn chủ quan
      - Góc nhìn từ trên cao
      - Quay vòng 360 độ
      - Bám song song
      - Bám chéo
      - Xoay máy
      - Chuyển động chậm
      - Tua nhanh thời gian
      - Góc máy nghiêng
      - Dolly zoom điện ảnh

      Hướng dẫn:
      1. Tạo đúng ${shotsPerScene} cảnh quay cho bối cảnh này; có thể dao động từ ${shotsPerScene - 1} đến ${shotsPerScene + 1} nếu cần để mạch truyện tự nhiên.
      2. Mỗi cảnh quay dài 10 giây. Tổng số cảnh phải khớp công thức: ${targetSeconds} giây ÷ 10 = ${totalShotsNeeded} cảnh trên toàn bộ kịch bản.
      3. Không vượt quá ${shotsPerScene + 1} cảnh cho bối cảnh này. Chỉ chọn những khoảnh khắc quan trọng nhất.
      4. 'cameraMovement': Chọn một chuyển động trong danh mục trên hoặc mô tả chuyển động sáng tạo khác bằng ${lang}.
      5. 'shotSize': Ghi rõ cỡ cảnh, ví dụ đặc tả, cận, trung hoặc toàn.
      6. 'actionSummary': Mô tả chi tiết diễn biến trong cảnh quay bằng ${lang}.
      7. 'visualPrompt': Mô tả chi tiết để tạo ảnh theo phong cách ${visualStyle}, viết bằng ${lang}, có từ khóa đặc trưng của phong cách và không quá 50 từ.
      
      Chỉ trả về một đối tượng JSON hợp lệ theo đúng cấu trúc sau, không dùng Markdown và không thêm giải thích:
      {
        "shots": [
          {
            "id": "string",
            "sceneId": "${scene.id}",
            "actionSummary": "string",
            "dialogue": "string (để trống nếu không có)",
            "cameraMovement": "string",
            "shotSize": "string",
            "characters": ["string"],
            "keyframes": [
              {"id": "string", "type": "start|end", "visualPrompt": "string (phải có từ khóa phong cách ${visualStyle})"}
            ]
          }
        ]
      }
    `;

    let responseText = '';
    try {
      responseText = await retryOperation(() => chatCompletion(prompt, model, 0.7, LONG_FORM_MAX_TOKENS, 'json_object'));
      const text = cleanJsonString(responseText);
      const parsed = parseModelJson<any>(text);

      // Chế độ JSON buộc phản hồi là đối tượng; hỗ trợ cả mảng cũ và cấu trúc cảnh quay mới.
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
      console.error(`Không thể tạo cảnh quay cho bối cảnh ${scene.id}`, e);
      try {
        console.error(`  ↳ mã bối cảnh=${scene.id}, thứ tự bối cảnh=${index}, đoạn phản hồi=`, String(responseText || '').slice(0, 500));
      } catch {
        // Bỏ qua lỗi đọc nội dung phản hồi.
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
  'live-action': 'hình ảnh chân thực, chất lượng phim điện ảnh, diễn viên người thật, quay phim chuyên nghiệp, ánh sáng tự nhiên, độ phân giải 8K',
  'anime': 'phong cách hoạt hình Nhật Bản, đổ bóng theo mảng, màu sắc rực rỡ, đôi mắt biểu cảm, tư thế năng động, chất lượng điện ảnh',
  '2d-animation': 'hoạt hình 2D cổ điển, nét vẽ tay, đường nét mượt mà, nhân vật giàu biểu cảm, phông nền như tranh vẽ',
  '3d-animation': 'hoạt hình 3D CGI chất lượng cao, tán xạ dưới bề mặt, chất liệu chi tiết, nhân vật cách điệu',
  'cyberpunk': 'thẩm mỹ tương lai công nghệ cao, ánh sáng neon, đường phố mưa ướt, màn hình ba chiều, tương phản mạnh',
  'oil-painting': 'phong cách tranh sơn dầu, nét cọ rõ, chất liệu phong phú, bố cục mỹ thuật cổ điển, chất lượng trưng bày',
};

const NEGATIVE_PROMPTS: { [key: string]: string } = {
  'live-action': 'hoạt hình, minh họa, tranh vẽ, dựng hình 3D, CGI, chất lượng thấp, mờ, nhiễu hạt, dấu chìm, chữ, biểu trưng, chữ ký, khuôn mặt méo, giải phẫu sai, thừa chi, bàn tay biến dạng, nghiệp dư',
  'anime': 'ảnh chân thực, dựng hình 3D, hoạt hình phương Tây, giải phẫu sai, thừa chi, tay chân biến dạng, mờ, dấu chìm, chữ, biểu trưng, khuôn mặt vẽ lỗi, thừa ngón, thiếu ngón, tỷ lệ sai',
  '2d-animation': 'ảnh chân thực, 3D, chất lượng thấp, vỡ hạt, mờ, dấu chìm, chữ, giải phẫu sai, biến dạng, nét vẽ nghiệp dư, phong cách thiếu nhất quán, bản phác thô',
  '3d-animation': 'ảnh chân thực, 2D, phẳng, vẽ tay, đa giác thấp, cấu trúc lưới lỗi, lỗi chất liệu, xuyên vật thể, chất lượng thấp, mờ, dấu chìm, chữ, chuyển động thiếu tự nhiên',
  'cyberpunk': 'ánh sáng ban ngày rực, đồng quê, trung cổ, giả tưởng, hoạt hình, công nghệ thấp, dấu chìm, chữ, biểu trưng, chất lượng thấp, mờ, nghiệp dư',
  'oil-painting': 'mỹ thuật số, ảnh chân thực, dựng hình 3D, hoạt hình, chất lượng thấp, mờ, dấu chìm, chữ, nghiệp dư, màu bùn, bề mặt bị xử lý quá mức',
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
     prompt = `Bạn là chuyên gia thiết kế câu lệnh tạo ảnh theo phong cách ${visualStyle}.

Hãy tạo mô tả hình ảnh chi tiết cho nhân vật theo cấu trúc sau:

Dữ liệu nhân vật:
- Tên: ${char.name}
- Giới tính: ${char.gender}
- Tuổi: ${char.age}
- Tính cách: ${char.personality}

CẤU TRÚC BẮT BUỘC (đầu ra bằng ${language}):
1. Nhận dạng cốt lõi: [dân tộc, tuổi, giới tính, vóc dáng]
2. Đặc điểm khuôn mặt: [mắt, mũi, dáng mặt, tông da và nét phân biệt]
3. Kiểu tóc: [màu, độ dài, chất tóc và kiểu tóc]
4. Trang phục: [bộ đồ chi tiết phù hợp thể loại ${genre}]
5. Tư thế và biểu cảm: [ngôn ngữ cơ thể, nét mặt phù hợp tính cách]
6. Chất lượng kỹ thuật: ${stylePrompt}

QUY TẮC QUAN TRỌNG:
- Mục 1–3 là đặc điểm CỐ ĐỊNH để giữ nhất quán giữa mọi biến thể
- Dùng chi tiết hình ảnh cụ thể, có thể tái hiện
- Viết thành một đoạn duy nhất, ngăn cách bằng dấu phẩy
- Bắt buộc thể hiện rõ phong cách ${visualStyle}
- Độ dài 60–90 từ
- Chỉ tập trung vào yếu tố có thể nhìn thấy trong ảnh

Chỉ trả về nội dung câu lệnh hình ảnh, không giải thích.`;
   } else {
     const scene = data as Scene;
     prompt = `Bạn là chuyên gia quay phim và thiết kế câu lệnh hình ảnh cho tác phẩm phong cách ${visualStyle}.

Hãy tạo câu lệnh bối cảnh điện ảnh theo cấu trúc sau:

Dữ liệu bối cảnh:
- Địa điểm: ${scene.location}
- Thời gian: ${scene.time}
- Không khí: ${scene.atmosphere}
- Thể loại: ${genre}

CẤU TRÚC BẮT BUỘC (đầu ra bằng ${language}):
1. Môi trường: [địa điểm, kiến trúc hoặc yếu tố tự nhiên]
2. Ánh sáng: [hướng, nhiệt độ màu, độ mềm/cứng và nguồn sáng chính]
3. Bố cục: [góc máy, quy tắc khung hình và các lớp chiều sâu]
4. Không khí: [tâm trạng, thời tiết, sương/bụi/mưa và hiệu ứng môi trường]
5. Bảng màu: [màu chủ đạo, sắc độ ấm/lạnh và độ bão hòa]
6. Chất lượng kỹ thuật: ${stylePrompt}

QUY TẮC QUAN TRỌNG:
- Dùng thuật ngữ quay phim chuyên nghiệp
- Nêu rõ nguồn và hướng sáng
- Có hướng dẫn bố cục như quy tắc một phần ba, đường dẫn thị giác và độ sâu trường ảnh
- Viết thành một đoạn duy nhất, ngăn cách bằng dấu phẩy
- Nhấn mạnh phong cách ${visualStyle} xuyên suốt
- Độ dài 70–110 từ
- Tập trung vào yếu tố tạo tâm trạng và chất lượng điện ảnh

Chỉ trả về nội dung câu lệnh hình ảnh, không giải thích.`;
   }

   const visualPrompt = await retryOperation(() => chatCompletion(prompt, model, 0.7, 1024));
   
   return {
     visualPrompt: visualPrompt.trim(),
     negativePrompt: negativePrompt
   };
};

/**
 * Tạo ảnh qua API hình ảnh hoặc giao thức hoàn tất hội thoại tương thích.
 * @param prompt - Prompt tạo ảnh.
 * @param referenceImages - Ảnh tham chiếu base64; ảnh đầu là bối cảnh, các ảnh sau là nhân vật.
 * @param aspectRatio - Tỷ lệ 16:9 hoặc 9:16; một số mô hình không hỗ trợ 1:1.
 * @param isVariation - Chế độ biến thể trang phục, giữ khuôn mặt nhất quán.
 * @returns Ảnh dạng base64.
 * @throws Lỗi khi tạo ảnh thất bại.
 */
const generateImageOnce = async (
  prompt: string, 
  referenceImages: string[] = [],
  aspectRatio: AspectRatio = '16:9',
  isVariation: boolean = false,
  modelId?: string,
  usageResourceId?: string,
  onProviderAccepted?: () => void | Promise<void>,
  onProviderTaskId?: (taskId: string) => void | Promise<void>,
): Promise<string> => {
  // Chặn trước khi tiêu tiền. Chỉ luật cục bộ nên không tốn phí, không thêm
  // độ trễ, và chỉ chặn những lỗi chắc chắn sai.
  assertGenerationAllowed(prompt, 'image');

  const startTime = Date.now();

  // Tôn trọng model người dùng chọn. Nếu tác vụ không có ảnh tham chiếu nhưng
  // model chỉ hỗ trợ chỉnh ảnh, tự chuyển sang model text-to-image cùng provider.
  const requestedImageModel = resolveModel('image', modelId) as ImageModelDefinition | undefined;
  const imageModels = getModels('image').filter((item): item is ImageModelDefinition => item.type === 'image');
  const activeImageModel = selectImageModelForGeneration(
    imageModels,
    requestedImageModel,
    referenceImages.length > 0,
    (candidateId) => Boolean(getApiKeyForModel(candidateId)),
  );
  const imageModelId = activeImageModel?.apiModel || activeImageModel?.id || DEFAULT_IMAGE_MODEL_ID;
  const imageEndpoint = activeImageModel?.endpoint;
  const apiKey = checkApiKey('image', activeImageModel?.id);
  const apiBase = getApiBase('image', activeImageModel?.id);
  const requestEndpoint = '/v1/chat/completions';

  try {
    const imageProvider = activeImageModel
      ? getProviderById(activeImageModel.providerId)
      : undefined;
    if (activeImageModel && (imageProvider?.protocol === 'replicate' || imageProvider?.protocol === 'kie' || imageProvider?.protocol === 'shopaikey')) {
      const providerPrompt = referenceImages.length
        ? isVariation
          ? `${prompt}\n\nYêu cầu bắt buộc: giữ nguyên khuôn mặt, mái tóc, màu tóc, tông da và tỷ lệ cơ thể từ ảnh tham chiếu; thay toàn bộ trang phục theo mô tả mới và thể hiện trang phục rõ ràng.`
          : `${prompt}\n\nYêu cầu bắt buộc: duy trì chính xác khuôn mặt, mái tóc, trang phục, tỷ lệ nhân vật, ánh sáng và bối cảnh từ các ảnh tham chiếu.`
        : prompt;
      const rawResult = await callImageApi(
        {
          prompt: providerPrompt,
          referenceImages,
          aspectRatio,
          usageResourceId,
          onProviderAccepted,
          onProviderTaskId,
        },
        activeImageModel
      );
      const result = await normalizeImageResult(rawResult);
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

    // Các mô hình như qwen-image-2.0 dùng /v1/images/generations.
    if (shouldUseImagesGenerationsEndpoint(imageModelId, imageEndpoint)) {
      const result = await callImagesGenerationsApi({
        apiBase,
        apiKey,
        model: imageModelId,
        prompt,
        aspectRatio,
        onProviderAccepted,
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
    // Nếu có ảnh tham chiếu, yêu cầu mô hình duy trì tính nhất quán.
    let finalPrompt = prompt;
    if (referenceImages.length > 0) {
      if (isVariation) {
        // Chế độ biến thể: giữ khuôn mặt, thay trang phục/tạo hình.
        finalPrompt = `
      ⚠️⚠️⚠️ YÊU CẦU QUAN TRỌNG — BIẾN THỂ TRANG PHỤC ⚠️⚠️⚠️

      Thông tin ảnh tham chiếu:
      - Ảnh cung cấp tạo hình gốc của NHÂN VẬT; chỉ dùng làm tham chiếu nhận dạng khuôn mặt.

      Nhiệm vụ:
      Tạo ảnh nhân vật với TRANG PHỤC MỚI dựa trên mô tả: "${prompt}".

      ⚠️ YÊU CẦU BẮT BUỘC:

      1. KHUÔN MẶT VÀ NHẬN DẠNG — PHẢI GIỐNG HỆT THAM CHIẾU:
         • Mắt, mũi, miệng và đường nét khuôn mặt phải khớp chính xác.
         • Độ dài, màu, chất và kiểu tóc phải nhất quán, trừ khi câu lệnh yêu cầu đổi tóc.
         • Tông da và cấu trúc khuôn mặt không được thay đổi.
         • Biểu cảm có thể thay đổi theo câu lệnh.

      2. TRANG PHỤC — PHẢI KHÁC HOÀN TOÀN ẢNH THAM CHIẾU:
         • Tạo trang phục mới đúng mô tả trong câu lệnh.
         • Không sao chép quần áo từ ảnh tham chiếu.
         • Trang phục phải khớp mô tả: "${prompt}".
         • Bao gồm đầy đủ phụ kiện, đạo cụ và chi tiết phục trang được nhắc đến.

      3. Giữ nguyên tỷ lệ cơ thể của nhân vật.

      ⚠️ Đây là tác vụ thay trang phục: khuôn mặt phải giữ nguyên, quần áo phải mới và hiện rõ.
      ⚠️ Nếu trang phục mới không rõ ràng hoặc không khác ảnh tham chiếu, kết quả không đạt yêu cầu.
    `;
      } else {
        // Chế độ thường: ưu tiên tính nhất quán hoàn toàn.
        finalPrompt = `
      ⚠️⚠️⚠️ YÊU CẦU QUAN TRỌNG — NHẤT QUÁN NHÂN VẬT ⚠️⚠️⚠️

      Thông tin ảnh tham chiếu:
      - Ảnh ĐẦU TIÊN là tham chiếu bối cảnh hoặc môi trường.
      - Các ảnh tiếp theo là tham chiếu nhân vật, gồm tạo hình gốc hoặc biến thể.

      Nhiệm vụ:
      Tạo cảnh quay điện ảnh phù hợp câu lệnh: "${prompt}".

      ⚠️ YÊU CẦU BẮT BUỘC:
      1. Nhất quán bối cảnh:
         - Giữ nghiêm ngặt phong cách hình ảnh, ánh sáng và môi trường từ ảnh tham chiếu.

      2. Nhất quán nhân vật — ƯU TIÊN CAO NHẤT:
         Nếu câu lệnh có nhân vật, họ phải giống hệt ảnh tham chiếu:
         • Khuôn mặt: màu, dáng và kích thước mắt; cấu trúc mũi, miệng và đường nét phải khớp chính xác.
         • Tóc: độ dài, màu, chất tóc và kiểu tóc phải nhất quán.
         • Trang phục: kiểu dáng, màu sắc, chất liệu và phụ kiện phải giống hệt.
         • Vóc dáng: chiều cao, thể hình và tỷ lệ cơ thể không được thay đổi.

      ⚠️ Không tự tạo biến thể hoặc diễn giải lại nhân vật; chỉ tái tạo đúng tham chiếu.
      ⚠️ Nhất quán ngoại hình nhân vật là yêu cầu quan trọng nhất.
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

  const response = await submitPaidTaskSafely(async () => {
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
        throw createBillableHttpError('Yêu cầu bị chặn vì an toàn nội dung. Hãy chỉnh câu lệnh khung hình, loại bỏ mô tả bạo lực, máu me hoặc nhạy cảm rồi thử lại.', res.status);
      }
      else if (res.status === 500) {
        throw createBillableHttpError('Hệ thống đang có nhiều yêu cầu. Vui lòng thử lại sau.', res.status);
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
      throw createBillableHttpError(localizeApiErrorMessage(errorMessage, res.status), res.status);
    }

    await onProviderAccepted?.();
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
    // Ghi nhật ký tác vụ tạo nội dung thất bại.
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
 * Cổng chung cho mọi lần tạo ảnh từ UI cũ. Khi có execution context, tác vụ
 * được claim bền vững trước khi provider nhận request; khi chưa có context vẫn
 * chặn được double-click trong cùng tab bằng Promise dùng chung.
 */
export const generateImage = async (
  prompt: string,
  referenceImages: string[] = [],
  aspectRatio: AspectRatio = '16:9',
  isVariation: boolean = false,
  modelId?: string,
  usageResourceId?: string,
  execution?: MediaExecutionContext,
): Promise<string> => executeBillableMedia({
  context: execution,
  mediaType: 'image',
  resourceId: usageResourceId,
  inputSignature: buildMediaInputSignature({
    modelId,
    prompt,
    referenceImages,
    aspectRatio,
    isVariation,
  }),
  operation: ({ onProviderAccepted, onProviderTaskId }) => generateImageOnce(
    prompt,
    referenceImages,
    aspectRatio,
    isVariation,
    modelId,
    usageResourceId,
    onProviderAccepted,
    onProviderTaskId,
  ),
});

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
 * Tạo video riêng cho Sora-2 bằng API bất đồng bộ.
 * Quy trình: tạo tác vụ, kiểm tra trạng thái rồi tải video.
 * @param prompt - Câu lệnh tạo video.
 * @param startImageBase64 - Khung hình đầu ở định dạng base64, không bắt buộc.
 * @param apiKey - Khóa API.
 * @param aspectRatio - Tỷ lệ khung hình: 16:9, 9:16 hoặc 1:1.
 * @param duration - Thời lượng video: 4, 8 hoặc 12 giây.
 * @returns Video ở định dạng base64.
 */
const generateVideoWithSora2 = async (
  prompt: string, 
  startImageBase64: string | undefined, 
  apiKey: string,
  aspectRatio: AspectRatio = '16:9',
  duration: VideoDuration = 8,
  modelName: string = 'sora-2',
  onProviderAccepted?: () => void | Promise<void>,
  onProviderTaskId?: (taskId: string) => void | Promise<void>,
): Promise<string> => {
  console.log(`🎬 Đang tạo video bất đồng bộ (${modelName}, ${aspectRatio}, ${duration} giây)...`);
  
  // Tính kích thước video theo tỷ lệ khung hình.
  const videoSize = getSoraVideoSize(aspectRatio);
  const [VIDEO_WIDTH, VIDEO_HEIGHT] = videoSize.split('x').map(Number);
  
  console.log(`📐 Kích thước video: ${VIDEO_WIDTH}x${VIDEO_HEIGHT}`);
  
  // Lấy URL cơ sở của API.
  const apiBase = getApiBase('video', modelName);
  
  // Bước 1: tạo tác vụ video.
  const formData = new FormData();
  formData.append('model', modelName);
  formData.append('prompt', prompt);
  formData.append('seconds', String(duration));
  formData.append('size', videoSize);
  
  // Nếu có ảnh tham chiếu, đổi kích thước rồi thêm vào biểu mẫu dữ liệu.
  if (startImageBase64) {
    const cleanBase64 = startImageBase64.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
    
    // Đổi kích thước ảnh theo yêu cầu của video.
    console.log(`📐 Đang đổi kích thước ảnh tham chiếu thành ${VIDEO_WIDTH}x${VIDEO_HEIGHT}...`);
    const resizedBase64 = await resizeImageToSize(cleanBase64, VIDEO_WIDTH, VIDEO_HEIGHT);
    
    // Chuyển base64 thành Blob.
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
  
  // Gửi yêu cầu tạo tác vụ.
  const createResponse = await submitPaidTaskSafely(async () => {
    const response = await fetch(`${apiBase}/v1/videos`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      body: formData
    });
    if (!response.ok) {
      const errorText = await response.text();
      throwFromVideoHttpError(response.status, errorText, 'sora');
    }
    return response;
  });
  await onProviderAccepted?.();
  
  const createData = await createResponse.json();
  // Phản hồi có thể dùng trường id hoặc task_id.
  const taskId = createData.id || createData.task_id;
  if (!taskId) {
    throw new Error('Không thể tạo tác vụ video: máy chủ không trả về mã tác vụ');
  }
  await onProviderTaskId?.(String(taskId));
  
  console.log('📋 Đã tạo tác vụ sora-2, mã tác vụ:', taskId);
  
  // Bước 2: kiểm tra trạng thái tác vụ theo chu kỳ.
  const maxPollingTime = 1200000; // Hết thời gian chờ sau 20 phút.
  const pollingInterval = 5000; // Kiểm tra mỗi 5 giây.
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
      throw createConfirmedBillableFailure(
        formatVideoTaskErrorForUser(statusData.error ?? statusData, statusData.message, 'sora'),
      );
    }
    // Tiếp tục kiểm tra với các trạng thái đang chờ hoặc đang xử lý.
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
 * Tạo đoạn video từ khung hình đầu và khung hình cuối.
 * @param prompt - Câu lệnh tạo video.
 * @param startImageBase64 - Khung hình đầu ở định dạng base64.
 * @param endImageBase64 - Khung hình cuối ở định dạng base64.
 * @param model - Mô hình video; Veo tự chọn biến thể theo tỷ lệ, Sora-2 dùng API bất đồng bộ.
 * @param aspectRatio - Tỷ lệ khung hình 16:9, 9:16 hoặc 1:1.
 * @param duration - Thời lượng video 4, 8 hoặc 12 giây với Sora-2.
 * @returns Video base64 để lưu trong IndexedDB.
 * @throws Lỗi khi quá trình tạo video thất bại.
 * @note URL video có thể hết hạn nên kết quả được chuyển sang base64.
 */
const generateVideoOnce = async (
  prompt: string, 
  startImageBase64?: string, 
  endImageBase64?: string, 
  model: string = DEFAULT_VIDEO_MODEL_ID,
  aspectRatio: AspectRatio = '16:9',
  duration: VideoDuration = 8,
  usageResourceId?: string,
  onProviderAccepted?: () => void | Promise<void>,
  onProviderTaskId?: (taskId: string) => void | Promise<void>,
): Promise<string> => {
  // Video là lời gọi đắt nhất trong app, nên cổng chặn ở đây đáng giá nhất.
  assertGenerationAllowed(prompt, 'video');

  const resolvedVideoModel = resolveModel('video', model) as VideoModelDefinition | undefined;
  const requestModel = resolveRequestModel('video', model) || model;
  const apiKey = checkApiKey('video', model);
  const apiBase = getApiBase('video', model);
  const endpoint = resolvedVideoModel?.endpoint || '';
  const videoProvider = resolvedVideoModel
    ? getProviderById(resolvedVideoModel.providerId)
    : undefined;
  if (resolvedVideoModel && (videoProvider?.protocol === 'replicate' || videoProvider?.protocol === 'kie' || videoProvider?.protocol === 'shopaikey')) {
    const outputUrl = await callVideoApi(
      {
        prompt,
        startImage: startImageBase64,
        endImage: endImageBase64,
        aspectRatio,
        duration,
        usageResourceId,
        onProviderAccepted,
        onProviderTaskId,
      },
      resolvedVideoModel
    );
    if (/^https?:\/\//i.test(outputUrl)) {
      try {
        return await convertVideoUrlToBase64(outputUrl);
      } catch (error) {
        console.warn(`Không thể lưu cục bộ video ${videoProvider.name}, sẽ dùng URL kết quả:`, error);
      }
    }
    return outputUrl;
  }
  const isAsyncMode =
    resolvedVideoModel?.params?.mode === 'async' ||
    requestModel === 'sora-2' ||
    requestModel === DEFAULT_VIDEO_MODEL_ID;

  if (isAsyncMode) {
    return generateVideoWithSora2(
      prompt,
      startImageBase64,
      apiKey,
      aspectRatio,
      duration,
      requestModel || DEFAULT_VIDEO_MODEL_ID,
      onProviderAccepted,
      onProviderTaskId,
    );
  }
  
  // Với Veo, tự chọn biến thể theo tỷ lệ và sự hiện diện của ảnh tham chiếu.
  let actualModel = requestModel;
  if (actualModel === 'veo' || actualModel.startsWith('veo_3_1')) {
    const hasReferenceImage = !!startImageBase64;
    actualModel = getVeoModelName(hasReferenceImage, aspectRatio);
    console.log(`🎬 Đang dùng mô hình Veo: ${actualModel} (${aspectRatio})`);
    
    // Veo không hỗ trợ video vuông 1:1.
    if (aspectRatio === '1:1') {
      console.warn('⚠️ Veo không hỗ trợ video vuông (1:1); sẽ dùng tỷ lệ ngang 16:9');
      actualModel = getVeoModelName(hasReferenceImage, '16:9');
    }
  }
  
  // Mô hình Veo dùng chế độ đồng bộ qua /v1/chat/completions.
  // Làm sạch chuỗi base64.
  const cleanStart = startImageBase64?.replace(/^data:image\/(png|jpeg|jpg);base64,/, '') || '';
  const cleanEnd = endImageBase64?.replace(/^data:image\/(png|jpeg|jpg);base64,/, '') || '';

  // Tạo nội dung yêu cầu theo đặc điểm của mô hình.
  const messages: any[] = [
    { role: 'user', content: prompt }
  ];

  // Thêm ảnh vào nội dung nếu có.
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

  // Không truyền phát và dùng thời gian chờ dài hơn cho tác vụ video.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1200000); // 20 minutes timeout

  try {
    const response = await submitPaidTaskSafely(async () => {
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

      await onProviderAccepted?.();
      return res;
    });

    clearTimeout(timeoutId);

    // Đọc phản hồi không truyền phát.
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    // Tìm URL video trong nội dung trả về.
    const urlMatch = content.match(/(https?:\/\/[^\s]+\.mp4)/);
    const videoUrl = urlMatch ? urlMatch[1] : '';

    if (!videoUrl) {
      throw new Error('Tạo video thất bại (không có URL video)');
    }

    console.log('🎬 Đã nhận URL video, đang chuyển sang base64...');
    
    // Chuyển URL video sang base64 để tránh hết hạn.
    try {
      const videoBase64 = await convertVideoUrlToBase64(videoUrl);
      console.log('✅ Đã chuyển video sang base64 để lưu an toàn trong IndexedDB');
      return videoBase64;
    } catch (error: any) {
      console.error('❌ Chuyển video sang base64 thất bại, dùng URL gốc:', error);
      // Nếu chuyển đổi thất bại, dùng URL gốc làm phương án dự phòng.
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

/** Cổng chống gửi trùng cho toàn bộ luồng video positional API. */
export const generateVideo = async (
  prompt: string,
  startImageBase64?: string,
  endImageBase64?: string,
  model: string = DEFAULT_VIDEO_MODEL_ID,
  aspectRatio: AspectRatio = '16:9',
  duration: VideoDuration = 8,
  usageResourceId?: string,
  execution?: MediaExecutionContext,
): Promise<string> => executeBillableMedia({
  context: execution,
  mediaType: 'video',
  resourceId: usageResourceId,
  inputSignature: buildMediaInputSignature({
    model,
    prompt,
    startImageBase64,
    endImageBase64,
    aspectRatio,
    duration,
  }),
  operation: ({ onProviderAccepted, onProviderTaskId }) => generateVideoOnce(
    prompt,
    startImageBase64,
    endImageBase64,
    model,
    aspectRatio,
    duration,
    usageResourceId,
    onProviderAccepted,
    onProviderTaskId,
  ),
});

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
- Mỗi mô tả là một đoạn tiếng Việt khoảng 80–120 từ, giàu hình ảnh nhưng không gắn nhãn kỹ thuật.
- Bao gồm bố cục, tiền/trung/hậu cảnh, ánh sáng, màu sắc, chi tiết nhân vật, môi trường, chiều sâu trường ảnh và gợi ý chuyển động.

Chỉ trả về JSON hợp lệ:
{
  "startFrame": "Mô tả chi tiết khung hình đầu...",
  "endFrame": "Mô tả chi tiết khung hình cuối..."
}
`;

  try {
    const result = await retryOperation(() => chatCompletion(prompt, model, 0.7, 4096, 'json_object'));
    const duration = Date.now() - startTime;

    // Nếu phản hồi JSON bị ngắt giữa chuỗi, thử dùng phần đã sửa. Khi vẫn thiếu
    // một khung, chuyển sang hai yêu cầu văn bản độc lập thay vì chặn quy trình.
    let parsed: { startFrame?: string; endFrame?: string } = {};
    try {
      parsed = parseModelJson(cleanJsonString(result));
    } catch (parseError) {
      console.warn('JSON tối ưu hai khung bị hỏng; chuyển sang tạo từng khung:', parseError);
    }

    if (!parsed.startFrame?.trim() || !parsed.endFrame?.trim()) {
      const startPrompt = parsed.startFrame?.trim() || await optimizeKeyframePrompt(
        'start', actionSummary, cameraMovement, sceneInfo, characterInfo, visualStyle, model,
      );
      const endPrompt = parsed.endFrame?.trim() || await optimizeKeyframePrompt(
        'end', actionSummary, cameraMovement, sceneInfo, characterInfo, visualStyle, model,
      );
      return { startPrompt, endPrompt };
    }
    
    console.log('✅ AI đã tối ưu khung đầu và khung cuối, thời gian:', duration, 'ms');
    
    return {
      startPrompt: parsed.startFrame.trim(),
      endPrompt: parsed.endFrame.trim()
    };
  } catch (error: any) {
    console.error('❌ AI tối ưu khung hình thất bại:', error);
    throw error instanceof Error ? error : new Error('Không thể tối ưu khung hình');
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
    throw error instanceof Error ? error : new Error(`Không thể tối ưu ${frameLabel}`);
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
 * Dùng AI chia một cảnh quay thành các cảnh con chi tiết theo cỡ cảnh và góc máy.
 * @param shot - Cảnh quay ban đầu.
 * @param sceneInfo - Địa điểm, thời gian và không khí của cảnh.
 * @param characterNames - Danh sách tên nhân vật.
 * @param visualStyle - Phong cách hình ảnh.
 * @param model - Mô hình sử dụng; mặc định là DEFAULT_CHAT_MODEL_ID.
 * @returns Đối tượng chứa danh sách cảnh quay con.
 */
export const splitShotIntoSubShots = async (
  shot: any, // Kiểu Shot được định nghĩa trong types.ts.
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
    const parsed = parseModelJson<any>(cleaned);
    
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
 * Dùng AI bổ sung thông số kỹ thuật và chi tiết điện ảnh cho câu lệnh khung hình.
 * @param basePrompt - Câu lệnh cơ sở gồm cảnh, nhân vật và hành động.
 * @param visualStyle - Phong cách hình ảnh.
 * @param cameraMovement - Chuyển động máy quay.
 * @param frameType - Loại khung hình đầu hoặc cuối.
 * @param model - Mô hình sử dụng; mặc định là DEFAULT_CHAT_MODEL_ID.
 * @returns Câu lệnh đã được tăng cường.
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
    
    // Kết hợp câu lệnh cơ sở và phần tăng cường.
    return `${basePrompt}

${result.trim()}`;
  } catch (error: any) {
    console.error(`❌ AI tăng cường ${frameLabel} thất bại:`, error);
    // Trả về câu lệnh cơ sở khi tăng cường thất bại.
    console.warn('⚠️ Đang quay lại câu lệnh cơ sở');
    return basePrompt;
  }
};

