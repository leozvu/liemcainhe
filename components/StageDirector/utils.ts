import { Shot, ProjectState, Keyframe } from '../../types';
import { VISUAL_STYLE_PROMPTS, VIDEO_PROMPT_TEMPLATES } from './constants';
import { getCameraMovementCompositionGuide } from './cameraMovementGuides';
import { buildShotReferenceImages } from '../../services/consistencyService';

export const getRefImagesForShot = (shot: Shot, scriptData: ProjectState['scriptData']): string[] => {
  return buildShotReferenceImages(shot, scriptData);
};

export const buildKeyframePrompt = (
  basePrompt: string,
  visualStyle: string,
  cameraMovement: string,
  frameType: 'start' | 'end'
): string => {
  const stylePrompt = VISUAL_STYLE_PROMPTS[visualStyle] || visualStyle;
  const cameraGuide = getCameraMovementCompositionGuide(cameraMovement, frameType);
  
  const frameSpecificGuide = frameType === 'start' 
    ? `[YÊU CẦU KHUNG HÌNH BẮT ĐẦU] Thiết lập trạng thái ban đầu và không khí bối cảnh rõ ràng. Vị trí, tư thế và biểu cảm ban đầu của nhân vật/vật thể phải cụ thể, chừa không gian thị giác cho chuyển động tiếp theo.`
    : `[YÊU CẦU KHUNG HÌNH KẾT THÚC] Thể hiện trạng thái cuối sau khi hành động hoàn thành, gồm vị trí, tư thế và thay đổi cảm xúc của nhân vật/vật thể, đồng thời phản ánh góc nhìn mới do chuyển động máy quay.`;

  const characterConsistencyGuide = `[YÊU CẦU NHẤT QUÁN NHÂN VẬT — TỐI QUAN TRỌNG]
Nếu có ảnh tham chiếu nhân vật, ngoại hình trong khung hình phải tuân thủ nghiêm ngặt ảnh đó:
• Khuôn mặt: đường nét, màu và hình dạng mắt, cấu trúc mũi và miệng phải giống hệt
• Tóc: chiều dài, màu, chất tóc và kiểu tóc phải nhất quán
• Trang phục: kiểu dáng, màu sắc, chất liệu và phụ kiện phải khớp ảnh tham chiếu
• Hình thể: tỷ lệ cơ thể, chiều cao và thể trạng phải được giữ nguyên
Đây là yêu cầu ưu tiên cao nhất, không được thỏa hiệp.`;

  return `${basePrompt}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[PHONG CÁCH HÌNH ẢNH]
${stylePrompt}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[CHUYỂN ĐỘNG MÁY QUAY]
${cameraMovement} (${frameType === 'start' ? 'Khung hình bắt đầu' : 'Khung hình kết thúc'})

[HƯỚNG DẪN BỐ CỤC]
${cameraGuide}

${frameSpecificGuide}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${characterConsistencyGuide}`;
};

export const buildKeyframePromptWithAI = async (
  basePrompt: string,
  visualStyle: string,
  cameraMovement: string,
  frameType: 'start' | 'end',
  enhanceWithAI: boolean = true
): Promise<string> => {
  const basicPrompt = buildKeyframePrompt(basePrompt, visualStyle, cameraMovement, frameType);
  
  if (!enhanceWithAI) {
    return basicPrompt;
  }
  
  // Nhập động để tránh phụ thuộc vòng với dịch vụ mô hình.
  try {
    const { enhanceKeyframePrompt } = await import('../../services/geminiService');
    const enhanced = await enhanceKeyframePrompt(basicPrompt, visualStyle, cameraMovement, frameType);
    return enhanced;
  } catch (error) {
    console.error('Không thể tăng cường bằng AI, chuyển sang câu lệnh cơ bản:', error);
    return basicPrompt;
  }
};

export const buildVideoPrompt = (
  actionSummary: string,
  cameraMovement: string,
  videoModel: 'sora-2' | 'veo' | 'veo_3_1_t2v_fast_landscape' | 'veo_3_1_t2v_fast_portrait' | 'veo_3_1_i2v_s_fast_fl_landscape' | 'veo_3_1_i2v_s_fast_fl_portrait' | string,
  language: string
): string => {
  if (!videoModel.toLowerCase().includes('veo')) {
    return VIDEO_PROMPT_TEMPLATES.sora2.standard
      .replace('{actionSummary}', actionSummary)
      .replace('{cameraMovement}', cameraMovement)
      .replace('{language}', language);
  } else {
    return VIDEO_PROMPT_TEMPLATES.veo.simple
      .replace('{actionSummary}', actionSummary)
      .replace('{cameraMovement}', cameraMovement)
      .replace('{language}', language);
  }
};

export const extractBasePrompt = (fullPrompt: string, fallback: string): string => {
  const vietnameseIndex = fullPrompt.indexOf('\n\nPhong cách hình ảnh:');
  const legacyIndex = fullPrompt.indexOf(atob('CgpWaXN1YWwgU3R5bGU6'));
  const visualStyleIndex = vietnameseIndex > 0 ? vietnameseIndex : legacyIndex;
  if (visualStyleIndex > 0) {
    return fullPrompt.substring(0, visualStyleIndex);
  }
  return fullPrompt || fallback;
};

export const generateId = (prefix: string): string => {
  return `${prefix}-${Date.now()}`;
};

export const delay = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

export const convertImageToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      resolve(event.target?.result as string);
    };
    reader.onerror = () => {
      reject(new Error('Không thể đọc tệp'));
    };
    reader.readAsDataURL(file);
  });
};

export const createKeyframe = (
  id: string,
  type: 'start' | 'end',
  visualPrompt: string,
  imageUrl?: string,
  status: 'pending' | 'generating' | 'completed' | 'failed' = 'pending'
): Keyframe => {
  return {
    id,
    type,
    visualPrompt,
    imageUrl,
    status
  };
};

export const updateKeyframeInShot = (
  shot: Shot,
  type: 'start' | 'end',
  keyframe: Keyframe
): Shot => {
  const newKeyframes = [...(shot.keyframes || [])];
  const idx = newKeyframes.findIndex(k => k.type === type);
  
  if (idx >= 0) {
    newKeyframes[idx] = keyframe;
  } else {
    newKeyframes.push(keyframe);
  }
  
  return { ...shot, keyframes: newKeyframes };
};

export const generateSubShotIds = (originalShotId: string, count: number): string[] => {
  const ids: string[] = [];
  for (let i = 1; i <= count; i++) {
    ids.push(`${originalShotId}-${i}`);
  }
  return ids;
};

export const createSubShot = (
  originalShot: Shot,
  subShotData: any,
  subShotId: string
): Shot => {
  const keyframes: any[] = [];
  if (subShotData.keyframes && Array.isArray(subShotData.keyframes)) {
    subShotData.keyframes.forEach((kf: any) => {
      if (kf.type && kf.visualPrompt) {
        keyframes.push({
          id: `${subShotId}-${kf.type}`,
          type: kf.type,
          visualPrompt: kf.visualPrompt,
          status: 'pending'
        });
      }
    });
  }
  
  return {
    id: subShotId,
    sceneId: originalShot.sceneId,
    actionSummary: subShotData.actionSummary,
    dialogue: undefined,
    cameraMovement: subShotData.cameraMovement,
    shotSize: subShotData.shotSize,
    characters: [...originalShot.characters],
    characterVariations: { ...originalShot.characterVariations },
    keyframes: keyframes,
    videoModel: originalShot.videoModel
  };
};

export const replaceShotWithSubShots = (
  shots: Shot[],
  originalShotId: string,
  subShots: Shot[]
): Shot[] => {
  const originalIndex = shots.findIndex(s => s.id === originalShotId);
  
  if (originalIndex === -1) {
    console.error(`Không tìm thấy cảnh quay có ID ${originalShotId}`);
    return shots;
  }
  
  const newShots = [
    ...shots.slice(0, originalIndex),
    ...subShots,
    ...shots.slice(originalIndex + 1)
  ];
  
  return newShots;
};
