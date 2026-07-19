/**
 * 全局配置组件
 * 包含 API Key 配置和折扣广告
 */

import React, { useState, useEffect } from 'react';
import { Key, Loader2, CheckCircle, AlertCircle, ExternalLink, Gift, Sparkles } from 'lucide-react';
import { getGlobalApiKey } from '../../services/modelRegistry';
import { verifyApiKey } from '../../services/modelService';
import { setGlobalApiKey } from '../../services/geminiService';

interface GlobalSettingsProps {
  onRefresh: () => void;
}

const GlobalSettings: React.FC<GlobalSettingsProps> = ({ onRefresh }) => {
  const [apiKey, setApiKey] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [verifyMessage, setVerifyMessage] = useState('');

  useEffect(() => {
    const currentKey = getGlobalApiKey() || '';
    setApiKey(currentKey);
    if (currentKey) {
      setVerifyStatus('success');
      setVerifyMessage('API Key đã được cấu hình');
    }
  }, []);

  const handleVerifyAndSave = async () => {
    if (!apiKey.trim()) {
      setVerifyStatus('error');
      setVerifyMessage('Vui lòng nhập API Key');
      return;
    }

    setIsVerifying(true);
    setVerifyStatus('idle');
    setVerifyMessage('');

    try {
      const result = await verifyApiKey(apiKey.trim());
      
      if (result.success) {
        setVerifyStatus('success');
        setVerifyMessage('Xác thực thành công! API Key đã được lưu');
        setGlobalApiKey(apiKey.trim());
        onRefresh();
      } else {
        setVerifyStatus('error');
        setVerifyMessage(result.message);
      }
    } catch (error: any) {
      setVerifyStatus('error');
      setVerifyMessage(error.message || 'Có lỗi trong quá trình xác thực');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleClearKey = () => {
    setApiKey('');
    setVerifyStatus('idle');
    setVerifyMessage('');
    setGlobalApiKey('');
    onRefresh();
  };

  return (
    <div className="space-y-6">
      {/* 折扣广告卡片 */}
      <div className="bg-gradient-to-r from-cyan-300/10 via-sky-400/10 to-fuchsia-400/10 border border-cyan-200/20 rounded-2xl p-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-300 to-sky-400 flex items-center justify-center flex-shrink-0">
            <Gift className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-white mb-1 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-yellow-400" />
              Kết nối các mô hình AI
            </h3>
            <p className="text-xs text-zinc-400 mb-3 leading-relaxed">
              Hỗ trợ mô hình văn bản, hình ảnh và video; có thể thêm model tùy chỉnh tương thích OpenAI.
              Cấu hình linh hoạt theo nhà cung cấp và lưu toàn bộ thông tin truy cập ngay trên thiết bị của bạn.
            </p>
            <div className="flex items-center gap-3">
              <a 
                href="https://github.com/leozvu/liemcainhe#cau-hinh-api"
                target="_blank" 
                rel="noreferrer"
                className="px-4 py-2 bg-cyan-300 text-slate-950 text-xs font-bold rounded-xl hover:bg-cyan-200 transition-colors inline-flex items-center gap-1.5"
              >
                Xem hướng dẫn
                <ExternalLink className="w-3 h-3" />
              </a>
              {/* 使用教程已隐藏 */}
            </div>
          </div>
        </div>
      </div>

      {/* API Key 配置 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Key className="w-4 h-4 text-cyan-300" />
          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
            API Key toàn cục
          </label>
        </div>
        
        <div className="space-y-3">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setVerifyStatus('idle');
              setVerifyMessage('');
            }}
            placeholder="Nhập API Key của bạn..."
            className="w-full bg-white/[0.06] border border-white/10 text-white px-4 py-3 text-sm rounded-xl focus:border-cyan-300/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/10 transition-all font-mono placeholder:text-slate-500"
            disabled={isVerifying}
          />
          
          {/* 状态提示 */}
          {verifyMessage && (
            <div className={`flex items-center gap-2 text-xs ${
              verifyStatus === 'success' ? 'text-green-400' : 'text-red-400'
            }`}>
              {verifyStatus === 'success' ? (
                <CheckCircle className="w-3.5 h-3.5" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5" />
              )}
              {verifyMessage}
            </div>
          )}

          {/* 说明文字 */}
          <p className="text-[10px] text-zinc-600 leading-relaxed">
            API Key toàn cục được dùng cho mọi lời gọi mô hình. Bạn cũng có thể đặt API Key riêng cho từng nhà cung cấp.
          </p>

          {/* 操作按钮 */}
          <div className="flex gap-3">
            {getGlobalApiKey() && (
              <button
                onClick={handleClearKey}
                className="flex-1 py-3 bg-white/[0.06] hover:bg-white/10 text-zinc-400 hover:text-white text-xs font-bold uppercase tracking-wider transition-colors rounded-xl border border-white/10"
              >
                Xóa Key
              </button>
            )}
            <button
              onClick={handleVerifyAndSave}
              disabled={isVerifying || !apiKey.trim()}
              className="flex-1 py-3 bg-cyan-300 text-slate-950 font-bold text-xs uppercase tracking-wider rounded-xl hover:bg-cyan-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isVerifying ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Đang xác thực...
                </>
              ) : (
                'Xác thực và lưu'
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 提示 */}
      <div className="p-4 bg-white/[0.045] rounded-2xl border border-white/10">
        <h4 className="text-xs font-bold text-zinc-400 mb-2">Hướng dẫn cấu hình</h4>
        <ul className="text-[10px] text-zinc-600 space-y-1 list-disc list-inside">
          <li>API Key toàn cục được dùng cho các mô hình tích hợp sẵn</li>
          <li>Có thể điều chỉnh tham số model như temperature và số token trong từng nhóm</li>
          <li>Hỗ trợ thêm model tùy chỉnh từ dịch vụ API khác</li>
          <li>Mọi cấu hình chỉ được lưu trong trình duyệt, không tự động tải lên máy chủ</li>
        </ul>
      </div>
    </div>
  );
};

export default GlobalSettings;
