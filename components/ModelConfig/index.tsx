/**
 * Hộp thoại quản lý và cấu hình mô hình.
 */

import React, { useRef, useState } from 'react';
import { X, Settings, MessageSquare, Image, Video, Key } from 'lucide-react';
import { ModelType } from '../../types/model';
import ModelList from './ModelList';
import GlobalSettings from './GlobalSettings';

interface ModelConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'global' | 'chat' | 'image' | 'video';

const ModelConfigModal: React.FC<ModelConfigModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<TabType>('global');
  const [refreshKey, setRefreshKey] = useState(0);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const pointerDownOutsideRef = useRef(false);

  const refresh = () => setRefreshKey(k => k + 1);

  if (!isOpen) return null;

  const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: 'global', label: 'Cấu hình chung', icon: <Key className="w-4 h-4" /> },
    { id: 'chat', label: 'Mô hình hội thoại', icon: <MessageSquare className="w-4 h-4" /> },
    { id: 'image', label: 'Mô hình hình ảnh', icon: <Image className="w-4 h-4" /> },
    { id: 'video', label: 'Mô hình video', icon: <Video className="w-4 h-4" /> },
  ];

  return (
    <div 
      className="fixed inset-0 z-[200] flex items-center justify-center"
      onPointerDown={(e) => {
        // Chỉ cho phép đóng khi thao tác bắt đầu ở bên ngoài hộp thoại.
        const targetNode = e.target as Node;
        pointerDownOutsideRef.current = modalRef.current ? !modalRef.current.contains(targetNode) : true;
      }}
      onPointerUp={(e) => {
        // Tránh đóng nhầm khi chọn văn bản hoặc kéo chuột từ trong ra ngoài.
        if (!pointerDownOutsideRef.current) return;
        const targetNode = e.target as Node;
        const isOutside = modalRef.current ? !modalRef.current.contains(targetNode) : true;
        pointerDownOutsideRef.current = false;
        if (isOutside) onClose();
      }}
      onPointerCancel={() => {
        pointerDownOutsideRef.current = false;
      }}
    >
      {/* Lớp nền */}
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-xl" />

      {/* Hộp thoại */}
      <div 
        className="relative z-10 mx-4 flex max-h-[88vh] w-full max-w-4xl flex-col rounded-[1.75rem] border border-cyan-200/15 bg-slate-950/90 shadow-2xl shadow-cyan-950/30 backdrop-blur-xl animate-in zoom-in-95 fade-in duration-200"
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Tiêu đề */}
        <div className="flex items-center justify-between p-6 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-cyan-300/10 border border-cyan-200/20 flex items-center justify-center">
              <Settings className="w-5 h-5 text-cyan-300" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Cấu hình mô hình</h2>
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-mono">THIẾT LẬP MÔ HÌNH</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/30"
            aria-label="Đóng cấu hình mô hình"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Chuyển nhóm */}
        <div className="flex flex-shrink-0 overflow-x-auto border-b border-white/10">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex min-h-11 min-w-max flex-1 items-center justify-center gap-2 border-b-2 px-4 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${
                activeTab === tab.id
                  ? 'text-cyan-100 border-cyan-300 bg-cyan-300/10'
                  : 'text-zinc-500 border-transparent hover:text-zinc-300 hover:bg-white/[0.03]'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Nội dung */}
        <div className="flex-1 overflow-y-auto p-6" key={refreshKey}>
          {activeTab === 'global' ? (
            <GlobalSettings onRefresh={refresh} />
          ) : (
            <ModelList 
              type={activeTab as ModelType} 
              onRefresh={refresh}
            />
          )}
        </div>

        {/* Chân hộp thoại */}
        <div className="px-6 py-4 border-t border-white/10 bg-white/[0.04] rounded-b-[1.75rem] flex-shrink-0 flex items-center justify-between">
          <p className="text-[10px] text-zinc-600 font-mono">
            Cấu hình chỉ được lưu trong trình duyệt
          </p>
          <button
            onClick={onClose}
            className="h-11 rounded-xl bg-cyan-300 px-5 text-xs font-bold text-slate-950 transition-colors hover:bg-cyan-200 focus:outline-none focus:ring-2 focus:ring-cyan-100/50"
          >
            Hoàn tất
          </button>
        </div>
      </div>
    </div>
  );
};

export default ModelConfigModal;
