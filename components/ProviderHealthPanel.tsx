import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, WifiOff } from 'lucide-react';
import { API_ERROR_CATEGORY_LABELS, ApiErrorCategory } from '../services/apiErrorLocalization';
import {
  HEALTH_WINDOW_MS,
  ProviderHealth,
  ProviderHealthStatus,
  describeProviderHealth,
  getProviderHealth,
} from '../services/providerHealthService';
import { getProviderById } from '../services/modelRegistry';

/**
 * Bảng theo dõi sức khoẻ từng nhà cung cấp.
 *
 * Đọc từ nhật ký usage đã có, không gọi mạng, nên mở bảng này không phát sinh
 * chi phí và không đụng tới hạn mức của nhà cung cấp nào.
 */

const WINDOW_OPTIONS = [
  { label: '1 giờ', value: HEALTH_WINDOW_MS },
  { label: '6 giờ', value: 6 * 60 * 60 * 1000 },
  { label: '24 giờ', value: 24 * 60 * 60 * 1000 },
];

const STATUS_STYLE: Record<ProviderHealthStatus, { chip: string; icon: React.ReactNode; label: string }> = {
  healthy: {
    chip: 'border-emerald-300/25 bg-emerald-400/[.08] text-emerald-100',
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    label: 'Bình thường',
  },
  degraded: {
    chip: 'border-amber-300/30 bg-amber-400/[.08] text-amber-100',
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    label: 'Chập chờn',
  },
  down: {
    chip: 'border-rose-300/30 bg-rose-500/[.09] text-rose-100',
    icon: <WifiOff className="h-3.5 w-3.5" />,
    label: 'Mất kết nối',
  },
  unknown: {
    chip: 'border-white/[.08] bg-white/[.03] text-zinc-400',
    icon: <Activity className="h-3.5 w-3.5" />,
    label: 'Chưa đủ dữ liệu',
  },
};

const providerLabel = (providerId: string): string => getProviderById(providerId)?.name || providerId;

const ProviderHealthPanel: React.FC<{ isActive: boolean }> = ({ isActive }) => {
  const [windowMs, setWindowMs] = useState(HEALTH_WINDOW_MS);
  const [health, setHealth] = useState<ProviderHealth[]>([]);
  const [refreshedAt, setRefreshedAt] = useState<number>(0);

  const refresh = () => {
    setHealth(getProviderHealth(Date.now(), windowMs));
    setRefreshedAt(Date.now());
  };

  useEffect(() => {
    if (!isActive) return;
    refresh();
    // Nhật ký chỉ đổi khi có lời gọi AI mới, nên nhịp một phút là đủ.
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, windowMs]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-xl text-sm text-zinc-400">
          Suy ra từ nhật ký sử dụng đã ghi, không gọi mạng nên mở bảng này không tốn phí. Nhà cung cấp
          bị đánh dấu mất kết nối sẽ tạm bị bỏ qua khi định tuyến.
        </p>
        <div className="flex items-end gap-2">
          <label className="block">
            <span className="eg-kicker">Khoảng thời gian</span>
            <select
              className="eg-input mt-2"
              value={windowMs}
              onChange={(event) => setWindowMs(Number(event.target.value))}
            >
              {WINDOW_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <button type="button" className="eg-button-secondary min-h-11 px-4" onClick={refresh}>
            <RefreshCw className="mr-2 inline h-4 w-4" />Làm mới
          </button>
        </div>
      </div>

      {health.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500">
          Chưa có lời gọi AI nào trong khoảng thời gian này. Chạy thử một tác vụ rồi quay lại.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {health.map((item) => {
            const style = STATUS_STYLE[item.status];
            const errors = Object.entries(item.errorsByCategory) as [ApiErrorCategory, number][];
            return (
              <li key={item.providerId} className="eg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white">
                      {providerLabel(item.providerId)}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                      {describeProviderHealth(item)}
                    </p>
                  </div>
                  <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium ${style.chip}`}>
                    {style.icon}
                    {style.label}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                  <span>{item.requests} lượt</span>
                  <span className="text-emerald-300/70">{item.successes} thành công</span>
                  {item.failures > 0 && <span className="text-rose-300/70">{item.failures} lỗi</span>}
                  {item.medianDurationMs !== null && (
                    <span>trung vị {(item.medianDurationMs / 1000).toFixed(1)}s</span>
                  )}
                </div>

                {errors.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t eg-divider pt-3">
                    {errors
                      .sort((left, right) => right[1] - left[1])
                      .map(([category, count]) => (
                        <span key={category} className="eg-chip">
                          {API_ERROR_CATEGORY_LABELS[category]} · {count}
                        </span>
                      ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {refreshedAt > 0 && (
        <p className="eg-mono mt-4 text-[10px] uppercase tracking-wider text-zinc-700">
          Cập nhật lúc {new Date(refreshedAt).toLocaleTimeString('vi-VN')}
        </p>
      )}
    </div>
  );
};

export default ProviderHealthPanel;
