/**
 * Biểu mẫu thêm mô hình tùy chỉnh và địa chỉ API.
 */

import React, { useState } from 'react';
import { Check, X } from 'lucide-react';
import { 
  ModelType, 
  ModelDefinition,
  ChatModelParams,
  ImageModelParams,
  VideoModelParams,
  DEFAULT_CHAT_PARAMS,
  DEFAULT_IMAGE_PARAMS,
  DEFAULT_VIDEO_PARAMS_SORA,
  DEFAULT_VIDEO_PARAMS_VEO,
  DEFAULT_PROVIDER_ID,
} from '../../types/model';
import { getProviders } from '../../services/modelRegistry';
import { useAlert } from '../GlobalAlert';

interface AddModelFormProps {
  type: ModelType;
  onSave: (model: Omit<ModelDefinition, 'id' | 'isBuiltIn'>) => void;
  onCancel: () => void;
}

const AddModelForm: React.FC<AddModelFormProps> = ({ type, onSave, onCancel }) => {
  const allowedProviders = getProviders().filter((provider) =>
    provider.supportedModelTypes.includes(type)
  );
  const defaultProvider = allowedProviders[0];
  const { showAlert } = useAlert();
  
  const [name, setName] = useState('');
  const [apiModel, setApiModel] = useState('');
  const [description, setDescription] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [videoMode, setVideoMode] = useState<'sync' | 'async'>('async');
  const [selectedProviderId, setSelectedProviderId] = useState(
    defaultProvider?.id || DEFAULT_PROVIDER_ID
  );
  
  const selectedProvider = allowedProviders.find((provider) => provider.id === selectedProviderId);

  const handleSave = () => {
    if (!name.trim() || !apiModel.trim()) {
      showAlert('Vui lòng nhập tên hiển thị và tên mô hình API', { type: 'warning' });
      return;
    }

    const providerId = selectedProviderId;
    if (!selectedProvider) {
      showAlert('Vui lòng chọn nhà cung cấp hỗ trợ loại mô hình này', { type: 'warning' });
      return;
    }

    // Thiết lập tham số mặc định theo loại mô hình.
    let params: ChatModelParams | ImageModelParams | VideoModelParams;
    
    if (type === 'chat') {
      params = { ...DEFAULT_CHAT_PARAMS };
    } else if (type === 'image') {
      params = { ...DEFAULT_IMAGE_PARAMS };
    } else {
      if (selectedProvider.protocol === 'replicate' || videoMode === 'async') {
        params = { ...DEFAULT_VIDEO_PARAMS_SORA };
      } else {
        params = { ...DEFAULT_VIDEO_PARAMS_VEO };
      }
    }

    const model: Omit<ModelDefinition, 'id' | 'isBuiltIn'> = {
      name: name.trim(),
      apiModel: apiModel.trim(),
      type,
      providerId,
      endpoint: endpoint.trim() || undefined,
      description: description.trim() || undefined,
      apiKey: apiKey.trim() || undefined,
      isEnabled: true,
      params,
    } as any;

    onSave(model);
  };

  return (
    <div className="bg-white/[0.045] border border-white/10 rounded-2xl p-4 space-y-4">
      <h4 className="text-sm font-bold text-white">Thêm mô hình tùy chỉnh</h4>

      <div>
        <label htmlFor={`provider-${type}`} className="mb-1.5 block text-[10px] text-zinc-500">
          Nhà cung cấp *
        </label>
        <select
          id={`provider-${type}`}
          value={selectedProviderId}
          onChange={(event) => setSelectedProviderId(event.target.value)}
          className="h-11 w-full rounded-xl border border-white/10 bg-zinc-900 px-3 text-xs text-white outline-none focus:border-cyan-300/40 focus:ring-2 focus:ring-cyan-300/10"
        >
          {allowedProviders.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[9px] text-zinc-600">
          Chỉ hiển thị nhà cung cấp hỗ trợ {type === 'chat' ? 'hội thoại' : type === 'image' ? 'hình ảnh' : 'video'}.
        </p>
      </div>
      
      {/* Thông tin cơ bản */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-[10px] text-zinc-500 block mb-1">Tên hiển thị *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ví dụ: GPT-4 Turbo"
            className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 text-xs text-white placeholder:text-slate-500"
          />
        </div>
        <div>
          <label className="text-[10px] text-zinc-500 block mb-1">Tên mô hình API * (có thể trùng mô hình tích hợp)</label>
          <input
            type="text"
            value={apiModel}
            onChange={(e) => setApiModel(e.target.value)}
            placeholder="Ví dụ: gpt-4-turbo, claude-3-opus"
            className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 font-mono text-xs text-white placeholder:text-slate-500"
          />
          <p className="text-[9px] text-zinc-600 mt-1">
            Trường này được gửi trong tham số mô hình của API; ID nội bộ sẽ được tạo tự động
          </p>
        </div>
      </div>

      <div>
        <label className="text-[10px] text-zinc-500 block mb-1">Mô tả (tùy chọn)</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Mô tả ngắn về mô hình"
          className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 text-xs text-white placeholder:text-slate-500"
        />
      </div>

      {/* Địa chỉ API */}
      <div>
        <label className="text-[10px] text-zinc-500 block mb-1">Đường dẫn API</label>
        <input
          type="text"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          placeholder={
            selectedProvider?.protocol === 'replicate'
              ? 'Để trống để tự suy ra từ tên mô hình'
              : type === 'chat'
                ? '/v1/chat/completions'
                : type === 'image'
                  ? '/v1/images/generations'
                  : '/v1/videos'
          }
          className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 font-mono text-xs text-white placeholder:text-slate-500"
        />
        <p className="text-[9px] text-zinc-600 mt-1">
          Để trống để dùng đường dẫn mặc định
        </p>
      </div>

      {/* Khóa API riêng của mô hình */}
      <div>
        <label className="text-[10px] text-zinc-500 block mb-1">Khóa API (tùy chọn)</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={`Để trống để dùng khóa của ${selectedProvider?.name || 'nhà cung cấp'}`}
          className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 font-mono text-xs text-white placeholder:text-slate-500"
        />
        <p className="text-[9px] text-zinc-600 mt-1">
          Chỉ nhập khi mô hình này dùng khóa khác với khóa nhà cung cấp
        </p>
      </div>

      {/* Tùy chọn dành cho mô hình video */}
      {type === 'video' && selectedProvider?.protocol !== 'replicate' && (
        <div>
          <label className="text-[10px] text-zinc-500 block mb-1">Chế độ API</label>
          <div className="flex gap-2">
            <button
              onClick={() => setVideoMode('sync')}
              className={`h-11 flex-1 rounded text-xs transition-colors ${
                videoMode === 'sync'
                  ? 'bg-cyan-300 text-slate-950'
                  : 'bg-white/[0.06] text-zinc-400 hover:bg-white/10'
              }`}
            >
              Đồng bộ (hoàn tất hội thoại)
            </button>
            <button
              onClick={() => setVideoMode('async')}
              className={`h-11 flex-1 rounded text-xs transition-colors ${
                videoMode === 'async'
                  ? 'bg-cyan-300 text-slate-950'
                  : 'bg-white/[0.06] text-zinc-400 hover:bg-white/10'
              }`}
            >
              Bất đồng bộ (nhóm Sora)
            </button>
          </div>
          <p className="text-[9px] text-zinc-600 mt-1">
            Đồng bộ trả kết quả trực tiếp; bất đồng bộ tạo tác vụ rồi kiểm tra trạng thái đến khi hoàn tất
          </p>
        </div>
      )}

      {/* Thao tác */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={handleSave}
          className="flex h-11 flex-1 items-center justify-center gap-1 rounded-xl bg-cyan-300 text-xs font-bold text-slate-950 transition-colors hover:bg-cyan-200"
        >
          <Check className="w-3 h-3" />
          Thêm mô hình
        </button>
        <button
          onClick={onCancel}
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-xs text-zinc-400 transition-colors hover:bg-white/15"
          aria-label="Hủy thêm mô hình"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};

export default AddModelForm;
