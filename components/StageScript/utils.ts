import { Scene } from '../../types';

export const getFinalValue = (selected: string, customInput: string): string => {
  return selected === 'custom' ? customInput : selected;
};

export const deduplicateScenes = (scenes: Scene[] = []): Scene[] => {
  const seenLocations = new Set<string>();
  return scenes.filter(scene => {
    const normalizedLoc = scene.location.trim().toLowerCase();
    if (seenLocations.has(normalizedLoc)) {
      return false;
    }
    seenLocations.add(normalizedLoc);
    return true;
  });
};

export const getTextStats = (text: string) => {
  return {
    characters: text.length,
    lines: text.split('\n').length,
    words: text.trim() ? text.trim().split(/\s+/).length : 0
  };
};

export const validateConfig = (config: {
  script: string;
  duration: string;
  model: string;
  visualStyle: string;
}): { valid: boolean; error: string | null } => {
  if (!config.script.trim()) {
    return { valid: false, error: 'Hãy nhập nội dung kịch bản.' };
  }
  if (!config.duration) {
    return { valid: false, error: 'Hãy chọn thời lượng mục tiêu.' };
  }
  if (!config.model) {
    return { valid: false, error: 'Hãy chọn hoặc nhập tên model.' };
  }
  if (!config.visualStyle) {
    return { valid: false, error: 'Hãy chọn hoặc nhập phong cách hình ảnh.' };
  }
  return { valid: true, error: null };
};
