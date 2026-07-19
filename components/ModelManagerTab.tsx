import React, { useState, useEffect } from 'react';
import { 
  Server, 
  MessageSquare, 
  Image, 
  Video, 
  Plus, 
  Trash2, 
  Edit2, 
  Check, 
  X, 
  ExternalLink,
  Sparkles,
  Gift
} from 'lucide-react';
import { useAlert } from './GlobalAlert';
import { 
  ModelProvider, 
  ModelConfig, 
  AspectRatio, 
  VideoDuration 
} from '../types';
import {
  getModelManagerState,
  getProviders,
  getCurrentConfig,
  addProvider,
  updateProvider,
  deleteProvider,
  updateChatModelConfig,
  updateImageModelConfig,
  updateVideoModelConfig,
  setDefaultAspectRatio,
  setDefaultVideoDuration,
  AVAILABLE_CHAT_MODELS,
  AVAILABLE_IMAGE_MODELS,
  AVAILABLE_VIDEO_MODELS
} from '../services/modelConfigService';

interface ModelManagerTabProps {
  onConfigChange?: () => void;
}

const ModelManagerTab: React.FC<ModelManagerTabProps> = ({ onConfigChange }) => {
  const { showAlert } = useAlert();
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [config, setConfig] = useState<ModelConfig | null>(null);
  const [defaultAspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [defaultVideoDuration, setDuration] = useState<VideoDuration>(8);
  
  // Trạng thái chỉnh sửa
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', baseUrl: '', apiKey: '' });
  const [isAddingProvider, setIsAddingProvider] = useState(false);
  const [newProviderForm, setNewProviderForm] = useState({ name: '', baseUrl: '', apiKey: '' });

  // Tải cấu hình
  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = () => {
    const state = getModelManagerState();
    setProviders(state.providers);
    setConfig(state.currentConfig);
    setAspectRatio(state.defaultAspectRatio);
    setDuration(state.defaultVideoDuration);
  };

  // Thêm nhà cung cấp
  const handleAddProvider = () => {
    if (!newProviderForm.name.trim() || !newProviderForm.baseUrl.trim()) return;
    
    addProvider({
      name: newProviderForm.name.trim(),
      baseUrl: newProviderForm.baseUrl.trim(),
      apiKey: newProviderForm.apiKey.trim() || undefined,
      isDefault: false
    });
    
    setNewProviderForm({ name: '', baseUrl: '', apiKey: '' });
    setIsAddingProvider(false);
    loadConfig();
    onConfigChange?.();
  };

  // Bắt đầu chỉnh sửa nhà cung cấp
  const handleStartEdit = (provider: ModelProvider) => {
    setEditingProviderId(provider.id);
    setEditForm({
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey || ''
    });
  };

  // Lưu chỉnh sửa
  const handleSaveEdit = (id: string) => {
    updateProvider(id, {
      name: editForm.name.trim(),
      baseUrl: editForm.baseUrl.trim(),
      apiKey: editForm.apiKey.trim() || undefined
    });
    setEditingProviderId(null);
    loadConfig();
    onConfigChange?.();
  };

  // Xóa nhà cung cấp
  const handleDeleteProvider = (id: string) => {
    showAlert('Bạn có chắc muốn xóa nhà cung cấp này?', {
      type: 'warning',
      showCancel: true,
      onConfirm: () => {
        deleteProvider(id);
        loadConfig();
        onConfigChange?.();
        showAlert('Đã xóa nhà cung cấp', { type: 'success' });
      }
    });
  };

  // Cập nhật cấu hình mô hình
  const handleChatModelChange = (modelName: string) => {
    updateChatModelConfig({ modelName });
    loadConfig();
    onConfigChange?.();
  };

  const handleVideoModelChange = (value: string, type: 'sora' | 'veo') => {
    updateVideoModelConfig({ modelName: value, type });
    loadConfig();
    onConfigChange?.();
  };

  const handleAspectRatioChange = (ratio: AspectRatio) => {
    setDefaultAspectRatio(ratio);
    setAspectRatio(ratio);
    onConfigChange?.();
  };

  const handleDurationChange = (duration: VideoDuration) => {
    setDefaultVideoDuration(duration);
    setDuration(duration);
    onConfigChange?.();
  };

  if (!config) return null;

  return (
    <div className="space-y-6">
      {/* Thẻ giới thiệu kết nối mô hình */}
      <div className="bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10 border border-indigo-500/30 rounded-xl p-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center flex-shrink-0">
            <Gift className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-white mb-1 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-yellow-400" />
              Kết nối các mô hình AI
            </h3>
            <p className="text-xs text-zinc-400 mb-3 leading-relaxed">
              Egoric Studio hỗ trợ các mô hình hội thoại, tạo ảnh và tạo video qua API tương thích OpenAI.
              Xem tài liệu dự án để cấu hình nhà cung cấp phù hợp với quy trình của bạn.
            </p>
            <div className="flex items-center gap-3">
              <a 
                href="https://github.com/leozvu/liemcainhe#cấu-hình-mô-hình"
                target="_blank" 
                rel="noreferrer"
                className="px-4 py-2 bg-white text-black text-xs font-bold rounded-lg hover:bg-zinc-200 transition-colors inline-flex items-center gap-1.5"
              >
                Xem hướng dẫn
                <ExternalLink className="w-3 h-3" />
              </a>
              {/* Có thể bổ sung liên kết hỗ trợ tại đây. */}
            </div>
          </div>
        </div>
      </div>

      {/* Danh sách nhà cung cấp */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
            <Server className="w-3.5 h-3.5" />
            Nhà cung cấp API
          </label>
          {!isAddingProvider && (
            <button
              onClick={() => setIsAddingProvider(true)}
              className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              Thêm nhà cung cấp
            </button>
          )}
        </div>

        <div className="space-y-2">
          {/* Biểu mẫu thêm nhà cung cấp */}
          {isAddingProvider && (
            <div className="bg-zinc-900/50 border border-zinc-700 rounded-lg p-3 space-y-2">
              <input
                type="text"
                placeholder="Tên nhà cung cấp"
                value={newProviderForm.name}
                onChange={(e) => setNewProviderForm({ ...newProviderForm, name: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 text-white px-3 py-2 text-xs rounded focus:border-indigo-500 focus:outline-none"
              />
              <input
                type="text"
                placeholder="URL API cơ sở (ví dụ: https://api.example.com)"
                value={newProviderForm.baseUrl}
                onChange={(e) => setNewProviderForm({ ...newProviderForm, baseUrl: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 text-white px-3 py-2 text-xs rounded focus:border-indigo-500 focus:outline-none font-mono"
              />
              <input
                type="password"
                placeholder="API Key riêng (không bắt buộc; để trống để dùng khóa toàn cục)"
                value={newProviderForm.apiKey}
                onChange={(e) => setNewProviderForm({ ...newProviderForm, apiKey: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 text-white px-3 py-2 text-xs rounded focus:border-indigo-500 focus:outline-none font-mono"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleAddProvider}
                  disabled={!newProviderForm.name.trim() || !newProviderForm.baseUrl.trim()}
                  className="flex-1 py-2 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                >
                  <Check className="w-3 h-3" />
                  Xác nhận thêm
                </button>
                <button
                  onClick={() => {
                    setIsAddingProvider(false);
                    setNewProviderForm({ name: '', baseUrl: '', apiKey: '' });
                  }}
                  className="px-4 py-2 bg-zinc-800 text-zinc-400 text-xs rounded hover:bg-zinc-700"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}

          {/* Danh sách nhà cung cấp */}
          {providers.map((provider) => (
            <div 
              key={provider.id}
              className={`bg-zinc-900/50 border rounded-lg p-3 ${
                provider.isDefault ? 'border-indigo-500/50' : 'border-zinc-800'
              }`}
            >
              {editingProviderId === provider.id ? (
                // Chế độ chỉnh sửa
                <div className="space-y-2">
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 text-white px-3 py-2 text-xs rounded focus:border-indigo-500 focus:outline-none"
                    disabled={provider.isBuiltIn}
                  />
                  <input
                    type="text"
                    value={editForm.baseUrl}
                    onChange={(e) => setEditForm({ ...editForm, baseUrl: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 text-white px-3 py-2 text-xs rounded focus:border-indigo-500 focus:outline-none font-mono"
                    disabled={provider.isBuiltIn}
                  />
                  <input
                    type="password"
                    placeholder="API Key riêng (không bắt buộc)"
                    value={editForm.apiKey}
                    onChange={(e) => setEditForm({ ...editForm, apiKey: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 text-white px-3 py-2 text-xs rounded focus:border-indigo-500 focus:outline-none font-mono"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSaveEdit(provider.id)}
                      className="flex-1 py-2 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-500 flex items-center justify-center gap-1"
                    >
                      <Check className="w-3 h-3" />
                      Lưu
                    </button>
                    <button
                      onClick={() => setEditingProviderId(null)}
                      className="px-4 py-2 bg-zinc-800 text-zinc-400 text-xs rounded hover:bg-zinc-700"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ) : (
                // Chế độ hiển thị
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{provider.name}</span>
                      {provider.isDefault && (
                        <span className="px-1.5 py-0.5 bg-indigo-500/20 text-indigo-400 text-[10px] rounded">Mặc định</span>
                      )}
                      {provider.isBuiltIn && (
                        <span className="px-1.5 py-0.5 bg-zinc-700 text-zinc-400 text-[10px] rounded">Tích hợp</span>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-500 font-mono mt-0.5">{provider.baseUrl}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleStartEdit(provider)}
                      className="p-1.5 text-zinc-500 hover:text-white transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    {!provider.isBuiltIn && (
                      <button
                        onClick={() => handleDeleteProvider(provider.id)}
                        className="p-1.5 text-zinc-500 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Chọn mô hình */}
      <div className="grid grid-cols-1 gap-4">
        {/* Mô hình hội thoại */}
        <div>
          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
            <MessageSquare className="w-3.5 h-3.5" />
            Mô hình hội thoại
          </label>
          <select
            value={config.chatModel.modelName}
            onChange={(e) => handleChatModelChange(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 text-white px-3 py-2.5 text-xs rounded-lg focus:border-indigo-500 focus:outline-none"
          >
            {AVAILABLE_CHAT_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.name} - {m.description}
              </option>
            ))}
          </select>
        </div>

        {/* Mô hình video */}
        <div>
          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
            <Video className="w-3.5 h-3.5" />
            Mô hình video
          </label>
          <select
            value={`${config.videoModel.type}:${config.videoModel.modelName}`}
            onChange={(e) => {
              const [type, value] = e.target.value.split(':');
              handleVideoModelChange(value, type as 'sora' | 'veo');
            }}
            className="w-full bg-zinc-900 border border-zinc-800 text-white px-3 py-2.5 text-xs rounded-lg focus:border-indigo-500 focus:outline-none"
          >
            {AVAILABLE_VIDEO_MODELS.map((m) => (
              <option key={m.value} value={`${m.type}:${m.value}`}>
                {m.name} - {m.description}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Cài đặt mặc định */}
      <div className="pt-4 border-t border-zinc-900">
        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3 block">
          Cài đặt tạo nội dung mặc định
        </label>
        
        <div className="grid grid-cols-2 gap-4">
          {/* Tỷ lệ khung hình mặc định */}
          <div>
            <label className="text-[10px] text-zinc-600 mb-1.5 block">Tỷ lệ mặc định</label>
            <div className="flex gap-1">
              {(['16:9', '9:16', '1:1'] as AspectRatio[]).map((ratio) => (
                <button
                  key={ratio}
                  onClick={() => handleAspectRatioChange(ratio)}
                  className={`flex-1 py-2 text-xs rounded transition-colors ${
                    defaultAspectRatio === ratio
                      ? 'bg-indigo-600 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                  }`}
                >
                  {ratio === '16:9' ? 'Ngang' : ratio === '9:16' ? 'Dọc' : 'Vuông'}
                </button>
              ))}
            </div>
          </div>

          {/* Thời lượng mặc định */}
          <div>
            <label className="text-[10px] text-zinc-600 mb-1.5 block">Thời lượng mặc định (Sora)</label>
            <div className="flex gap-1">
              {([4, 8, 12] as VideoDuration[]).map((d) => (
                <button
                  key={d}
                  onClick={() => handleDurationChange(d)}
                  className={`flex-1 py-2 text-xs rounded transition-colors ${
                    defaultVideoDuration === d
                      ? 'bg-indigo-600 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                  }`}
                >
                  {d} giây
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModelManagerTab;
