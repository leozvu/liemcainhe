/**
 * Bộ chọn mô hình dùng chung cho các chức năng tạo nội dung.
 */

import React from 'react';
import { Cpu, ChevronDown } from 'lucide-react';
import { 
  ModelType, 
  ModelDefinition,
  ChatModelDefinition,
  ImageModelDefinition,
  VideoModelDefinition,
} from '../types/model';
import {
  getChatModels,
  getImageModels,
  getVideoModels,
} from '../services/modelRegistry';
import { migrateDeprecatedChatModelId, migrateDeprecatedVideoModelId } from '../types/model';

interface ModelSelectorProps {
  type: ModelType;
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
}

const typeLabels: Record<ModelType, string> = {
  chat: 'Mô hình hội thoại',
  image: 'Mô hình hình ảnh',
  video: 'Mô hình video',
};

const ModelSelector: React.FC<ModelSelectorProps> = ({
  type,
  value,
  onChange,
  disabled = false,
  compact = false,
  label,
}) => {
  // Chỉ lấy các mô hình đúng loại và đang được bật.
  const getModels = (): ModelDefinition[] => {
    let models: ModelDefinition[] = [];
    switch (type) {
      case 'chat':
        models = getChatModels();
        break;
      case 'image':
        models = getImageModels();
        break;
      case 'video':
        models = getVideoModels();
        break;
    }
    return models.filter(m => m.isEnabled);
  };

  const models = getModels();
  const resolvedValue =
    type === 'chat'
      ? migrateDeprecatedChatModelId(value)
      : type === 'video'
        ? migrateDeprecatedVideoModelId(value)
        : value;
  const selectedModel = models.find(m => m.id === resolvedValue);
  const showOrphanOption =
    (type === 'chat' || type === 'video') &&
    !!resolvedValue &&
    !models.some((m) => m.id === resolvedValue);

  if (compact) {
    return (
      <div className="relative">
        <select
          value={resolvedValue}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="appearance-none bg-white/[0.06] border border-white/10 text-white text-xs rounded-xl px-3 py-1.5 pr-7 focus:border-cyan-300/40 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {showOrphanOption && (
            <option value={resolvedValue}>{resolvedValue}</option>
          )}
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500 pointer-events-none" />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {label && (
        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-1">
          <Cpu className="w-3 h-3" />
          {label}
        </label>
      )}
      <div className="relative">
        <select
          value={resolvedValue}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full appearance-none bg-white/[0.06] border border-white/10 text-white text-xs rounded-xl px-3 py-2.5 pr-8 focus:border-cyan-300/40 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {showOrphanOption && (
            <option value={resolvedValue}>{resolvedValue}</option>
          )}
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name} {model.description ? `- ${model.description}` : ''}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
      </div>
      {selectedModel && !compact && (
        <p className="text-[9px] text-zinc-600">
          ID: {selectedModel.id}
        </p>
      )}
    </div>
  );
};

export default ModelSelector;

/**
 * Bộ chọn mô hình video kèm thông tin chế độ hỗ trợ.
 */
export const VideoModelSelector: React.FC<{
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => {
  const models = getVideoModels().filter(m => m.isEnabled);
  const selectedModel = models.find(m => m.id === value) as VideoModelDefinition | undefined;
  
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
        Mô hình video
      </label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full appearance-none bg-white/[0.06] border border-white/10 text-white text-xs rounded-xl px-3 py-2.5 pr-8 focus:border-cyan-300/40 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {models.map((model) => {
            const videoModel = model as VideoModelDefinition;
            const modeLabel = videoModel.params.mode === 'async' ? 'Bất đồng bộ' : 'Đồng bộ';
            return (
              <option key={model.id} value={model.id}>
                {model.name} ({modeLabel})
              </option>
            );
          })}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
      </div>
      {selectedModel && (
        <p className="text-[9px] text-zinc-600">
          Chế độ: {selectedModel.params.mode === 'async' ? 'Bất đồng bộ (cần thăm dò)' : 'Đồng bộ (trả kết quả trực tiếp)'}
          {selectedModel.params.supportedDurations.length > 1 && 
            ` · Thời lượng hỗ trợ: ${selectedModel.params.supportedDurations.join('/')} giây`
          }
        </p>
      )}
    </div>
  );
};
