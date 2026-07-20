import {
  ChatOptions,
  ImageGenerateOptions,
  VideoGenerateOptions,
  AspectRatio,
  VideoDuration,
} from '../types/model';

import { callChatApi, verifyApiKey as verifyChatApiKey, ApiKeyError } from './adapters/chatAdapter';
import { callImageApi } from './adapters/imageAdapter';
import { callVideoApi } from './adapters/videoAdapter';
import {
  getGlobalApiKey,
  getActiveVideoModel,
} from './modelRegistry';
import { setGlobalApiKey as setGeminiApiKey } from './geminiService';
import { parseModelJson } from './jsonResponse';

export { ApiKeyError };

export const chat = async (options: ChatOptions): Promise<string> => {
  return callChatApi(options);
};

export const chatJson = async (options: Omit<ChatOptions, 'responseFormat'>): Promise<string> => {
  return callChatApi({ ...options, responseFormat: 'json' });
};

export const generateImage = async (options: ImageGenerateOptions): Promise<string> => {
  return callImageApi(options);
};

export const generateVideo = async (options: VideoGenerateOptions): Promise<string> => {
  return callVideoApi(options);
};

export const parseScript = async (options: {
  rawText: string;
  language: string;
  visualStyle: string;
}): Promise<any> => {
  const prompt = buildScriptParsePrompt(options.rawText, options.language, options.visualStyle);
  const result = await chatJson({ prompt, timeout: 600000 });
  return parseModelJson(result);
};

export const generateShots = async (options: {
  scriptData: any;
}): Promise<any[]> => {
  const prompt = buildShotGenerationPrompt(options.scriptData);
  const result = await chatJson({ prompt, timeout: 600000 });
  const parsed = parseModelJson<any>(result);
  return parsed.shots || [];
};

export const generateVisualPrompts = async (options: {
  type: 'character' | 'scene';
  data: any;
  genre: string;
  visualStyle: string;
  language: string;
}): Promise<{ visualPrompt: string; negativePrompt: string }> => {
  const prompt = buildVisualPromptGenerationPrompt(options);
  const result = await chatJson({ prompt });
  return parseModelJson(result);
};

export const optimizeKeyframePrompt = async (options: {
  frameType: 'start' | 'end';
  actionSummary: string;
  cameraMovement: string;
  sceneInfo: string;
  characterInfo: string;
  visualStyle: string;
}): Promise<string> => {
  const prompt = buildKeyframeOptimizationPrompt(options);
  return chat({ prompt });
};

export const generateActionSuggestion = async (options: {
  startFramePrompt: string;
  endFramePrompt: string;
  cameraMovement: string;
}): Promise<string> => {
  const prompt = buildActionSuggestionPrompt(options);
  return chat({ prompt });
};

export const splitShot = async (options: {
  shot: any;
  sceneInfo: string;
  characterNames: string[];
  visualStyle: string;
}): Promise<{ subShots: any[] }> => {
  const prompt = buildShotSplitPrompt(options);
  const result = await chatJson({ prompt });
  return parseModelJson(result);
};

export const verifyApiKey = async (apiKey: string): Promise<{ success: boolean; message: string }> => {
  return verifyChatApiKey(apiKey);
};

export const getApiKey = (): string | undefined => {
  return getGlobalApiKey();
};

export const setApiKey = (apiKey: string): void => {
  setGeminiApiKey(apiKey);
};

export const getVideoModelCapabilities = (): {
  supportedAspectRatios: AspectRatio[];
  supportedDurations: VideoDuration[];
  defaultAspectRatio: AspectRatio;
  defaultDuration: VideoDuration;
} => {
  const model = getActiveVideoModel();
  if (!model) {
    return {
      supportedAspectRatios: ['16:9', '9:16', '1:1'],
      supportedDurations: [4, 8, 12],
      defaultAspectRatio: '16:9',
      defaultDuration: 8,
    };
  }
  
  return {
    supportedAspectRatios: model.params.supportedAspectRatios,
    supportedDurations: model.params.supportedDurations,
    defaultAspectRatio: model.params.defaultAspectRatio,
    defaultDuration: model.params.defaultDuration,
  };
};

function buildScriptParsePrompt(rawText: string, language: string, visualStyle: string): string {
  return `Bạn là trợ lý biên kịch chuyên nghiệp. Hãy phân tích kịch bản hoặc câu chuyện sau thành dữ liệu có cấu trúc.

Nội dung kịch bản:
${rawText}

Yêu cầu:
- Ngôn ngữ đầu ra: ${language}
- Phong cách hình ảnh: ${visualStyle}
- Trích xuất tiêu đề, thể loại, tóm tắt, nhân vật (tên, giới tính, tuổi, tính cách) và bối cảnh (địa điểm, thời gian, không khí)
- Tạo các đoạn truyện có liên kết đến bối cảnh tương ứng

Chỉ trả về một đối tượng JSON hợp lệ theo cấu trúc:
{
  "title": "string",
  "genre": "string", 
  "logline": "string",
  "characters": [{"id": "string", "name": "string", "gender": "string", "age": "string", "personality": "string", "variations": []}],
  "scenes": [{"id": "string", "location": "string", "time": "string", "atmosphere": "string"}],
  "storyParagraphs": [{"id": number, "text": "string", "sceneRefId": "string"}]
}`;
}

function buildShotGenerationPrompt(scriptData: any): string {
  return `Bạn là đạo diễn điện ảnh chuyên nghiệp. Hãy tạo danh sách cảnh quay cho kịch bản sau.

Dữ liệu kịch bản:
${JSON.stringify(scriptData, null, 2)}

Mỗi cảnh quay cần có:
- sceneId: mã bối cảnh tham chiếu
- actionSummary: diễn biến trong cảnh quay
- dialogue: lời thoại nếu có
- cameraMovement: chuyển động máy quay
- shotSize: cỡ cảnh như toàn, trung hoặc cận
- characters: danh sách mã nhân vật xuất hiện

Chỉ trả về một đối tượng JSON hợp lệ:
{
  "shots": [
    {
      "id": "string",
      "sceneId": "string",
      "actionSummary": "string",
      "dialogue": "string",
      "cameraMovement": "string",
      "shotSize": "string",
      "characters": ["string"],
      "keyframes": []
    }
  ]
}`;
}

function buildVisualPromptGenerationPrompt(options: {
  type: 'character' | 'scene';
  data: any;
  genre: string;
  visualStyle: string;
  language: string;
}): string {
  const { type, data, genre, visualStyle, language } = options;
  
  if (type === 'character') {
    return `Hãy tạo câu lệnh hình ảnh chi tiết cho nhân vật sau:
Tên: ${data.name}
Giới tính: ${data.gender}
Tuổi: ${data.age}
Tính cách: ${data.personality}

Thể loại: ${genre}
Phong cách hình ảnh: ${visualStyle}
Ngôn ngữ đầu ra: ${language}

Chỉ trả về JSON:
{
  "visualPrompt": "mô tả chi tiết để tạo ảnh",
  "negativePrompt": "những yếu tố cần tránh"
}`;
  } else {
    return `Hãy tạo câu lệnh hình ảnh chi tiết cho bối cảnh sau:
Địa điểm: ${data.location}
Thời gian: ${data.time}
Không khí: ${data.atmosphere}

Thể loại: ${genre}
Phong cách hình ảnh: ${visualStyle}
Ngôn ngữ đầu ra: ${language}

Chỉ trả về JSON:
{
  "visualPrompt": "mô tả chi tiết để tạo ảnh",
  "negativePrompt": "những yếu tố cần tránh"
}`;
  }
}

function buildKeyframeOptimizationPrompt(options: {
  frameType: 'start' | 'end';
  actionSummary: string;
  cameraMovement: string;
  sceneInfo: string;
  characterInfo: string;
  visualStyle: string;
}): string {
  return `Hãy tối ưu câu lệnh cho khung hình ${options.frameType === 'start' ? 'đầu' : 'cuối'}:

Hành động: ${options.actionSummary}
Máy quay: ${options.cameraMovement}
Bối cảnh: ${options.sceneInfo}
Nhân vật: ${options.characterInfo}
Phong cách hình ảnh: ${options.visualStyle}

Hãy tạo một câu lệnh điện ảnh chi tiết để sinh ảnh. Chỉ trả về nội dung câu lệnh bằng tiếng Việt.`;
}

function buildActionSuggestionPrompt(options: {
  startFramePrompt: string;
  endFramePrompt: string;
  cameraMovement: string;
}): string {
  return `Hãy đề xuất mô tả hành động kết nối hai khung hình chính sau:

Khung hình đầu: ${options.startFramePrompt}
Khung hình cuối: ${options.endFramePrompt}
Chuyển động máy quay: ${options.cameraMovement}

Viết một câu ngắn gọn mô tả quá trình chuyển tiếp. Chỉ trả về nội dung hành động bằng tiếng Việt.`;
}

function buildShotSplitPrompt(options: {
  shot: any;
  sceneInfo: string;
  characterNames: string[];
  visualStyle: string;
}): string {
  return `Hãy tách cảnh quay sau thành nhiều cảnh quay con:

Cảnh quay: ${JSON.stringify(options.shot)}
Bối cảnh: ${options.sceneInfo}
Nhân vật: ${options.characterNames.join(', ')}
Phong cách hình ảnh: ${options.visualStyle}

Chỉ trả về JSON với nội dung mô tả bằng tiếng Việt:
{
  "subShots": [
    {
      "actionSummary": "string",
      "cameraMovement": "string",
      "characters": ["string"]
    }
  ]
}`;
}
