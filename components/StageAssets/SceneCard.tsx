import React, { useState } from 'react';
import { MapPin, Check, Loader2, Trash2, Edit2, AlertCircle, FolderPlus, LockKeyhole, LockKeyholeOpen } from 'lucide-react';
import { AspectRatio, GenerationLock } from '../../types';
import PromptEditor from './PromptEditor';
import ImageUploadButton from './ImageUploadButton';

interface SceneCardProps {
  scene: {
    id: string;
    location: string;
    time: string;
    atmosphere: string;
    visualPrompt?: string;
    referenceImage?: string;
    status?: 'pending' | 'generating' | 'completed' | 'failed';
    lock?: GenerationLock;
  };
  isGenerating: boolean;
  onGenerate: () => void;
  onUpload: (file: File) => void;
  onPromptSave: (newPrompt: string) => void;
  onImageClick: (imageUrl: string) => void;
  onDelete: () => void;
  onUpdateInfo: (updates: { location?: string; time?: string; atmosphere?: string }) => void;
  onAddToLibrary: () => void;
  currentModelId: string;
  currentAspectRatio: AspectRatio;
  onLockGeneration: () => void;
  onUnlockGeneration: () => void;
}

const SceneCard: React.FC<SceneCardProps> = ({
  scene,
  isGenerating,
  onGenerate,
  onUpload,
  onPromptSave,
  onImageClick,
  onDelete,
  onUpdateInfo,
  onAddToLibrary,
  currentModelId,
  currentAspectRatio,
  onLockGeneration,
  onUnlockGeneration,
}) => {
  const [isEditingLocation, setIsEditingLocation] = useState(false);
  const [isEditingTime, setIsEditingTime] = useState(false);
  const [isEditingAtmosphere, setIsEditingAtmosphere] = useState(false);
  const [editLocation, setEditLocation] = useState(scene.location);
  const [editTime, setEditTime] = useState(scene.time);
  const [editAtmosphere, setEditAtmosphere] = useState(scene.atmosphere);

  const handleSaveLocation = () => {
    if (editLocation.trim()) {
      onUpdateInfo({ location: editLocation.trim() });
      setIsEditingLocation(false);
    }
  };

  const handleSaveTime = () => {
    if (editTime.trim()) {
      onUpdateInfo({ time: editTime.trim() });
      setIsEditingTime(false);
    }
  };

  const handleSaveAtmosphere = () => {
    if (editAtmosphere.trim()) {
      onUpdateInfo({ atmosphere: editAtmosphere.trim() });
      setIsEditingAtmosphere(false);
    }
  };

  return (
    <div className="bg-white/[0.045] border border-white/10 rounded-2xl overflow-hidden flex flex-col group hover:border-cyan-200/35 transition-all hover:shadow-xl hover:shadow-cyan-950/20 backdrop-blur">
      <div 
        className="aspect-video bg-slate-950/70 relative cursor-pointer"
        onClick={() => scene.referenceImage && onImageClick(scene.referenceImage)}
      >
        {scene.referenceImage ? (
          <>
            <img src={scene.referenceImage} alt={scene.location} className="w-full h-full object-cover" />
            <div className="absolute top-2 right-2 p-1 bg-cyan-300 text-slate-950 rounded-lg shadow-lg shadow-cyan-500/20 backdrop-blur">
              <Check className="w-3 h-3" />
            </div>
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-zinc-700 p-4 text-center">
            {isGenerating ? (
              <>
                <Loader2 className="w-10 h-10 mb-3 animate-spin text-cyan-300" />
                <span className="text-[10px] text-zinc-500">Đang tạo...</span>
              </>
            ) : scene.status === 'failed' ? (
              <>
                <AlertCircle className="w-10 h-10 mb-3 text-red-500" />
                <span className="text-[10px] text-red-500 mb-2">Tạo ảnh thất bại</span>
                <ImageUploadButton
                  variant="inline"
                  size="small"
                  onUpload={onUpload}
                  onGenerate={onGenerate}
                  isGenerating={isGenerating}
                  uploadLabel="Tải lên"
                  generateLabel="Thử lại"
                />
              </>
            ) : (
              <>
                <MapPin className="w-10 h-10 mb-3 opacity-10" />
                <ImageUploadButton
                  variant="inline"
                  size="medium"
                  onUpload={onUpload}
                  onGenerate={onGenerate}
                  isGenerating={isGenerating}
                  uploadLabel="Tải lên"
                  generateLabel="Tạo ảnh"
                />
              </>
            )}
          </div>
        )}
      </div>
      
      <div className="p-3 border-t border-white/10 bg-slate-950/35">
        <div className="flex justify-between items-center mb-1">
          {isEditingLocation ? (
            <input
              type="text"
              value={editLocation}
              onChange={(e) => setEditLocation(e.target.value)}
              onBlur={handleSaveLocation}
              onKeyPress={(e) => e.key === 'Enter' && handleSaveLocation()}
              autoFocus
              className="font-bold text-zinc-200 text-sm bg-white/[0.06] border border-white/10 rounded-xl px-2 py-1 flex-1 mr-2 focus:outline-none focus:border-cyan-300/40"
            />
          ) : (
            <div className="flex items-center gap-2 flex-1 group/location">
              <h3 className="font-bold text-zinc-200 text-sm truncate">{scene.location}</h3>
              <button
                onClick={() => {
                  setEditLocation(scene.location);
                  setIsEditingLocation(true);
                }}
                className="opacity-0 group-hover/location:opacity-100 text-zinc-500 hover:text-zinc-300 transition-opacity flex-shrink-0"
              >
                <Edit2 className="w-3 h-3" />
              </button>
            </div>
          )}
          {isEditingTime ? (
            <input
              type="text"
              value={editTime}
              onChange={(e) => setEditTime(e.target.value)}
              onBlur={handleSaveTime}
              onKeyPress={(e) => e.key === 'Enter' && handleSaveTime()}
              autoFocus
              className="px-1.5 py-0.5 bg-white/[0.06] border border-white/10 text-zinc-300 text-[9px] rounded-lg uppercase font-mono focus:outline-none focus:border-cyan-300/40 w-24"
            />
          ) : (
            <span
              onClick={() => {
                setEditTime(scene.time);
                setIsEditingTime(true);
              }}
              className="px-1.5 py-0.5 bg-cyan-300/10 text-cyan-100/55 text-[9px] rounded-full border border-cyan-200/10 uppercase font-mono cursor-pointer hover:bg-cyan-300/15 hover:text-cyan-100 transition-colors"
            >
              {scene.time}
            </span>
          )}
        </div>
        {isEditingAtmosphere ? (
          <input
            type="text"
            value={editAtmosphere}
            onChange={(e) => setEditAtmosphere(e.target.value)}
            onBlur={handleSaveAtmosphere}
            onKeyPress={(e) => e.key === 'Enter' && handleSaveAtmosphere()}
            autoFocus
            className="text-[10px] text-zinc-300 w-full bg-white/[0.06] border border-white/10 rounded-xl px-2 py-1 mb-3 focus:outline-none focus:border-cyan-300/40"
          />
        ) : (
          <p
            onClick={() => {
              setEditAtmosphere(scene.atmosphere);
              setIsEditingAtmosphere(true);
            }}
            className="text-[10px] text-zinc-500 line-clamp-1 mb-3 cursor-pointer hover:text-zinc-300 transition-colors"
          >
            {scene.atmosphere}
          </p>
        )}

        <div className="mt-3 pt-3 border-t border-white/10">
          <PromptEditor
            prompt={scene.visualPrompt || ''}
            onSave={onPromptSave}
            label="Câu lệnh bối cảnh"
            placeholder="Nhập mô tả hình ảnh bối cảnh..."
            maxHeight="max-h-[120px]"
          />
        </div>

        {scene.referenceImage && (
          <div className="mt-3 pt-3 border-t border-white/10">
            <ImageUploadButton
              variant="separate"
              hasImage={true}
              onUpload={onUpload}
              onGenerate={onGenerate}
              isGenerating={isGenerating}
              uploadLabel="Tải ảnh lên"
            />
          </div>
        )}

        <div className="mt-3 pt-3 border-t border-white/10">
          <div className={`rounded-xl border px-3 py-2.5 ${scene.lock ? 'border-cyan-200/25 bg-cyan-300/[0.055]' : 'border-white/10 bg-black/10'}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">Khóa bối cảnh</p>
                <p className="text-[9px] text-zinc-600 truncate mt-0.5">
                  {scene.lock ? `${scene.lock.modelId} · ${scene.lock.aspectRatio || currentAspectRatio}` : 'Giữ cùng model và tỷ lệ cho mọi shot'}
                </p>
              </div>
              <button
                type="button"
                onClick={scene.lock ? onUnlockGeneration : onLockGeneration}
                disabled={isGenerating}
                title={scene.lock ? 'Mở khóa bối cảnh' : `Khóa ${currentModelId} · ${currentAspectRatio}`}
                aria-pressed={Boolean(scene.lock)}
                aria-label={scene.lock ? `Mở khóa bối cảnh ${scene.location}` : `Khóa model và tỷ lệ cho bối cảnh ${scene.location}`}
                className={`w-11 h-11 shrink-0 rounded-xl grid place-items-center border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 disabled:opacity-30 ${scene.lock
                  ? 'border-cyan-200/25 bg-cyan-300/10 text-cyan-200 hover:bg-cyan-300/15'
                  : 'border-white/10 bg-white/[0.04] text-zinc-500 hover:text-white hover:bg-white/[0.08]'}`}
              >
                {scene.lock ? <LockKeyhole className="w-3.5 h-3.5" /> : <LockKeyholeOpen className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-white/10">
          <button
            onClick={onAddToLibrary}
            disabled={isGenerating}
            className="w-full py-2 bg-white/[0.06] hover:bg-white/10 text-zinc-300 hover:text-white border border-white/10 hover:border-cyan-300/30 rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <FolderPlus className="w-3 h-3" />
            Thêm vào thư viện
          </button>
        </div>

        <div className="mt-3 pt-3 border-t border-white/10">
          <button
            onClick={onDelete}
            disabled={isGenerating}
            className="w-full py-2 bg-transparent hover:bg-red-950/10 text-red-400 hover:text-red-300 border border-red-500/50 hover:border-red-400 rounded text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-3 h-3" />
            Xóa bối cảnh
          </button>
        </div>
      </div>
    </div>
  );
};

export default SceneCard;
