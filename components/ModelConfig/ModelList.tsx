/**
 * Danh sách mô hình theo từng nhóm và trạng thái sử dụng.
 */

import React, { useState, useEffect } from 'react';
import { Plus, Info, CheckCircle, Search } from 'lucide-react';
import { 
  ModelType, 
  ModelDefinition, 
  ModelProvider,
} from '../../types/model';
import {
  getModels,
  updateModel,
  registerModel,
  removeModel,
  getActiveModelsConfig,
  setActiveModel,
  getProviderById,
} from '../../services/modelRegistry';
import { useAlert } from '../GlobalAlert';
import ModelCard from './ModelCard';
import AddModelForm from './AddModelForm';

interface ModelListProps {
  type: ModelType;
  onRefresh: () => void;
}

const typeDescriptions: Record<ModelType, string> = {
  chat: 'Dùng để phân tích kịch bản, tạo bảng phân cảnh và tối ưu câu lệnh',
  image: 'Dùng để tạo ý tưởng nhân vật, bối cảnh và khung hình chính',
  video: 'Dùng để tạo các đoạn video',
};

const ModelList: React.FC<ModelListProps> = ({ type, onRefresh }) => {
  const [models, setModels] = useState<ModelDefinition[]>([]);
  const [isAddingModel, setIsAddingModel] = useState(false);
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null);
  const [activeModelId, setActiveModelId] = useState<string>('');
  const [query, setQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState('all');
  const { showAlert } = useAlert();

  useEffect(() => {
    loadModels();
    setQuery('');
    setProviderFilter('all');
  }, [type]);

  const providerOptions = Array.from(new Set<string>(models.map((model) => model.providerId)))
    .map((providerId) => getProviderById(providerId))
    .filter((provider): provider is ModelProvider => Boolean(provider));
  const normalizedQuery = query.trim().toLocaleLowerCase('vi-VN');
  const visibleModels = models.filter((model) => {
    if (providerFilter !== 'all' && model.providerId !== providerFilter) return false;
    if (!normalizedQuery) return true;
    return [model.name, model.apiModel, model.description]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase('vi-VN').includes(normalizedQuery));
  });

  const loadModels = () => {
    const allModels = getModels(type);
    setModels(allModels);
    // Lấy mô hình đang được sử dụng.
    const activeConfig = getActiveModelsConfig();
    setActiveModelId(activeConfig[type]);
  };

  const handleSetActiveModel = (modelId: string) => {
    if (setActiveModel(type, modelId)) {
      setActiveModelId(modelId);
      const model = models.find(m => m.id === modelId);
      const provider = model ? getProviderById(model.providerId) : null;
      showAlert(
        `Đã chuyển sang ${model?.name}${provider ? ` (${provider.name})` : ''}`,
        { type: 'success' }
      );
      onRefresh();
    } else {
      showAlert('Không thể kích hoạt mô hình. Hãy bảo đảm mô hình đã được bật.', { type: 'error' });
    }
  };

  const handleUpdateModel = (modelId: string, updates: Partial<ModelDefinition>) => {
    if (updateModel(modelId, updates)) {
      loadModels();
      onRefresh();
    }
  };

  const handleDeleteModel = (modelId: string) => {
    showAlert('Bạn có chắc muốn xóa mô hình này?', {
      type: 'warning',
      showCancel: true,
      onConfirm: () => {
        if (removeModel(modelId)) {
          loadModels();
          onRefresh();
          showAlert('Đã xóa mô hình', { type: 'success' });
        }
      }
    });
  };

  const handleAddModel = (model: Omit<ModelDefinition, 'id' | 'isBuiltIn'>) => {
    try {
      registerModel(model);
      setIsAddingModel(false);
      loadModels();
      onRefresh();
      showAlert('Đã thêm mô hình', { type: 'success' });
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'Không thể thêm mô hình', { type: 'error' });
    }
  };

  const handleToggleExpand = (modelId: string) => {
    setExpandedModelId(expandedModelId === modelId ? null : modelId);
  };

  return (
    <div className="space-y-4">
      {/* Mô tả nhóm mô hình */}
      <div className="mb-4">
        <p className="text-xs text-zinc-400">{typeDescriptions[type]}</p>
      </div>

      {/* Mô hình đang sử dụng */}
      <div className="bg-cyan-300/10 border border-cyan-200/20 rounded-2xl p-3">
        <div className="flex items-center gap-2 mb-1">
          <CheckCircle className="w-4 h-4 text-cyan-300" />
          <span className="text-xs font-bold text-cyan-200">Đang sử dụng</span>
        </div>
        {(() => {
          const activeModel = models.find(m => m.id === activeModelId);
          const provider = activeModel ? getProviderById(activeModel.providerId) : null;
          return (
            <p className="text-[11px] text-zinc-300">
              <span className="font-medium">{activeModel?.name || 'Chưa chọn'}</span>
              {provider && (
                <span className="text-zinc-500 ml-2">
                  → {provider.name} ({provider.baseUrl})
                </span>
              )}
            </p>
          );
        })()}
      </div>

      {/* Thông tin hướng dẫn */}
      <div className="bg-white/[0.045] border border-white/10 rounded-2xl p-3 flex items-start gap-2">
        <Info className="w-4 h-4 text-zinc-500 flex-shrink-0 mt-0.5" />
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          Nhấn “Sử dụng mô hình này” để chuyển mô hình hoạt động. Khi mô hình tùy chỉnh có nhà cung cấp riêng, yêu cầu API sẽ được gửi đến địa chỉ tương ứng.
          Mở rộng thẻ mô hình để điều chỉnh tham số.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <label className="relative block">
          <span className="sr-only">Tìm mô hình</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm theo tên hoặc mã model…"
            className="eg-input w-full pl-9 pr-3 text-xs"
          />
        </label>
        <label>
          <span className="sr-only">Lọc theo nhà cung cấp</span>
          <select
            value={providerFilter}
            onChange={(event) => setProviderFilter(event.target.value)}
            className="eg-input w-full px-3 text-xs"
          >
            <option value="all">Tất cả nhà cung cấp</option>
            {providerOptions.map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.name}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-[10px] text-zinc-600">
        Hiển thị {visibleModels.length}/{models.length} mô hình
      </p>

      {/* Danh sách mô hình */}
      <div className="space-y-2">
        {visibleModels.map((model) => (
          <ModelCard
            key={model.id}
            model={model}
            isExpanded={expandedModelId === model.id}
            isActive={activeModelId === model.id}
            onToggleExpand={() => handleToggleExpand(model.id)}
            onUpdate={(updates) => handleUpdateModel(model.id, updates)}
            onDelete={() => handleDeleteModel(model.id)}
            onSetActive={() => handleSetActiveModel(model.id)}
          />
        ))}
        {visibleModels.length === 0 && (
          <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-xs text-zinc-600">
            Không tìm thấy mô hình phù hợp.
          </div>
        )}
      </div>

      {/* Thêm mô hình */}
      {isAddingModel ? (
        <AddModelForm
          type={type}
          onSave={handleAddModel}
          onCancel={() => setIsAddingModel(false)}
        />
      ) : (
        <button
          onClick={() => setIsAddingModel(true)}
          className="w-full py-3 border border-dashed border-zinc-700 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 hover:border-zinc-500 transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Thêm mô hình tùy chỉnh
        </button>
      )}
    </div>
  );
};

export default ModelList;
