/**
 * Thẻ cấu hình cho từng mô hình.
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Trash2, ToggleLeft, ToggleRight, CheckCircle, Circle } from 'lucide-react';
import { 
  ModelDefinition, 
  ChatModelParams,
  ImageModelParams,
  VideoModelParams,
  AspectRatio,
  VideoDuration
} from '../../types/model';

interface ModelCardProps {
  model: ModelDefinition;
  isExpanded: boolean;
  isActive: boolean;
  onToggleExpand: () => void;
  onUpdate: (updates: Partial<ModelDefinition>) => void;
  onDelete: () => void;
  onSetActive: () => void;
}

const ModelCard: React.FC<ModelCardProps> = ({
  model,
  isExpanded,
  isActive,
  onToggleExpand,
  onUpdate,
  onDelete,
  onSetActive,
}) => {
  const [editParams, setEditParams] = useState<any>(model.params);
  const [editApiKey, setEditApiKey] = useState<string>(model.apiKey || '');

  const handleParamChange = (key: string, value: any) => {
    const newParams = { ...editParams, [key]: value };
    setEditParams(newParams);
    onUpdate({ params: newParams } as any);
  };

  const handleToggleEnabled = () => {
    onUpdate({ isEnabled: !model.isEnabled });
  };

  const handleApiKeyChange = (value: string) => {
    setEditApiKey(value);
    onUpdate({ apiKey: value.trim() || undefined });
  };

  const renderChatParams = (params: ChatModelParams) => (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="text-[10px] text-zinc-500 block mb-1">Mức độ sáng tạo</label>
        <input
          type="number"
          min="0"
          max="2"
          step="0.1"
          value={editParams.temperature}
          onChange={(e) => handleParamChange('temperature', parseFloat(e.target.value))}
          className="w-full bg-white/[0.06] border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
        />
      </div>
      <div>
        <label className="text-[10px] text-zinc-500 block mb-1">Token tối đa</label>
        <input
          type="number"
          min="1"
          max="128000"
          value={editParams.maxTokens ?? ''}
          onChange={(e) => {
            const value = e.target.value;
            handleParamChange('maxTokens', value === '' ? undefined : parseInt(value));
          }}
          placeholder="Để trống nếu không giới hạn"
          className="w-full bg-white/[0.06] border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
        />
        <p className="text-[9px] text-zinc-600 mt-1">Để trống nếu không giới hạn số token</p>
      </div>
    </div>
  );

  const renderImageParams = (params: ImageModelParams) => (
    <div>
      <label className="text-[10px] text-zinc-500 block mb-1">Tỷ lệ mặc định</label>
      <div className="flex gap-2">
        {/* Lấy tỷ lệ được hỗ trợ từ cấu hình mô hình. */}
        {(params.supportedAspectRatios || ['16:9', '9:16']).map((ratio) => (
          <button
            key={ratio}
            onClick={() => handleParamChange('defaultAspectRatio', ratio)}
            className={`px-3 py-1.5 text-xs rounded transition-colors ${
              editParams.defaultAspectRatio === ratio
                ? 'bg-cyan-300 text-slate-950'
                : 'bg-white/[0.06] text-zinc-400 hover:bg-white/10'
            }`}
          >
            {ratio === '16:9' ? 'Ngang' : ratio === '9:16' ? 'Dọc' : 'Vuông'}
          </button>
        ))}
      </div>
    </div>
  );

  const renderVideoParams = (params: VideoModelParams) => (
    <div className="space-y-4">
      <div>
        <label className="text-[10px] text-zinc-500 block mb-1">Tỷ lệ mặc định</label>
        <div className="flex gap-2">
          {editParams.supportedAspectRatios.map((ratio: AspectRatio) => (
            <button
              key={ratio}
              onClick={() => handleParamChange('defaultAspectRatio', ratio)}
              className={`px-3 py-1.5 text-xs rounded transition-colors ${
                editParams.defaultAspectRatio === ratio
                  ? 'bg-cyan-300 text-slate-950'
                  : 'bg-white/[0.06] text-zinc-400 hover:bg-white/10'
              }`}
            >
              {ratio === '16:9' ? 'Ngang' : ratio === '9:16' ? 'Dọc' : 'Vuông'}
            </button>
          ))}
        </div>
      </div>
      {editParams.supportedDurations.length > 1 && (
        <div>
          <label className="text-[10px] text-zinc-500 block mb-1">Thời lượng mặc định</label>
          <div className="flex gap-2">
            {editParams.supportedDurations.map((duration: VideoDuration) => (
              <button
                key={duration}
                onClick={() => handleParamChange('defaultDuration', duration)}
                className={`px-3 py-1.5 text-xs rounded transition-colors ${
                  editParams.defaultDuration === duration
                    ? 'bg-cyan-300 text-slate-950'
                    : 'bg-white/[0.06] text-zinc-400 hover:bg-white/10'
                }`}
              >
                {duration} giây
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="text-[10px] text-zinc-600">
        Chế độ:
        {editParams.mode === 'sync'
          ? 'Đồng bộ'
          : 'Bất đồng bộ'}
      </div>
    </div>
  );

  const apiModel = model.apiModel || model.id;

  return (
    <div 
      className={`bg-white/[0.045] border rounded-2xl overflow-hidden transition-all ${
        isActive ? 'border-cyan-300/50 bg-cyan-300/5' : 'border-white/10'
      } ${!model.isEnabled ? 'opacity-60' : ''}`}
    >
      {/* Tiêu đề */}
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1">
          {/* Thông tin mô hình */}
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white">{model.name}</span>
              {model.isBuiltIn && (
                <span className="px-1.5 py-0.5 bg-zinc-700 text-zinc-400 text-[9px] rounded">Tích hợp sẵn</span>
              )}
            </div>
            <p className="text-[10px] text-zinc-500 mt-0.5">
              Tên mô hình API: {apiModel}
              {model.id !== apiModel && ` · ID nội bộ: ${model.id}`}
              {model.endpoint && ` · ${model.endpoint}`}
              {model.description && ` · ${model.description}`}
            </p>
          </div>
        </div>

        {/* Thao tác */}
        <div className="flex items-center gap-2">
          {/* Chọn mô hình */}
          {model.isEnabled && !isActive && (
            <button
              onClick={onSetActive}
              className="px-2.5 py-1 bg-cyan-300 text-slate-950 text-[10px] font-bold rounded-xl hover:bg-cyan-200 transition-colors flex items-center gap-1"
              title="Sử dụng mô hình này"
            >
              <Circle className="w-3 h-3" />
              Sử dụng
            </button>
          )}
          
          {/* Trạng thái đang dùng */}
          {isActive && (
            <span className="px-2.5 py-1 bg-cyan-300/15 text-cyan-200 text-[10px] font-bold rounded-xl flex items-center gap-1 border border-cyan-200/15">
              <CheckCircle className="w-3 h-3" />
              Đang dùng
            </span>
          )}

          {/* Bật hoặc tắt */}
          <button
            onClick={handleToggleEnabled}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
            title={model.isEnabled ? 'Tắt' : 'Bật'}
          >
            {model.isEnabled ? (
              <ToggleRight className="w-5 h-5 text-cyan-300" />
            ) : (
              <ToggleLeft className="w-5 h-5" />
            )}
          </button>

          {/* Chỉ mô hình tùy chỉnh mới có thể xóa. */}
          {!model.isBuiltIn && (
            <button
              onClick={onDelete}
              className="text-zinc-500 hover:text-red-400 transition-colors"
              title="Xóa"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}

          {/* Mở rộng hoặc thu gọn */}
          <button
            onClick={onToggleExpand}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {isExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Tham số mở rộng */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-0 border-t border-white/10">
          <div className="pt-4 space-y-4">
            {/* Khóa API riêng của mô hình */}
            <div>
              <label className="text-[10px] text-zinc-500 block mb-1">
                Khóa API riêng (tùy chọn)
              </label>
              <input
                type="password"
                value={editApiKey}
                onChange={(e) => handleApiKeyChange(e.target.value)}
                placeholder="Để trống để dùng khóa của nhà cung cấp"
                className="w-full bg-white/[0.06] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 font-mono"
              />
              {model.apiKey && (
                <p className="text-[9px] text-green-500 mt-1">✓ Đã cấu hình khóa riêng</p>
              )}
            </div>
            
            {model.type === 'chat' && renderChatParams(model.params)}
            {model.type === 'image' && renderImageParams(model.params)}
            {model.type === 'video' && renderVideoParams(model.params)}
          </div>
        </div>
      )}
    </div>
  );
};

export default ModelCard;
