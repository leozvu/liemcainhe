import React from 'react';
import { Play, Download, FileVideo, Loader2, Scissors, X } from 'lucide-react';
import { STYLES, DownloadState } from './constants';

interface Props {
  completedShotsCount: number;
  totalShots: number;
  progress: number;
  downloadState: DownloadState;
  renderState: DownloadState;
  onPreview: () => void;
  onRenderMaster: () => void;
  onCancelRender: () => void;
  onDownloadMaster: () => void;
  onExportTimeline: () => void;
}

const ActionButtons: React.FC<Props> = ({
  completedShotsCount,
  totalShots,
  progress,
  downloadState,
  renderState,
  onPreview,
  onRenderMaster,
  onCancelRender,
  onDownloadMaster,
  onExportTimeline,
}) => {
  const { isDownloading, phase, progress: downloadProgress } = downloadState;
  const { isDownloading: isRendering, phase: renderPhase, progress: renderProgress } = renderState;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <button 
        onClick={onPreview}
        disabled={completedShotsCount === 0}
        className={completedShotsCount > 0 ? STYLES.button.primary : STYLES.button.disabled}
      >
        <Play className="w-4 h-4" />
        Xem trước video ({completedShotsCount}/{totalShots})
      </button>

      <button
        onClick={isRendering ? onCancelRender : onRenderMaster}
        disabled={progress < 100 && !isRendering}
        className={isRendering ? STYLES.button.loading : progress === 100 ? STYLES.button.secondary : STYLES.button.disabled}
      >
        {isRendering ? <X className="h-4 w-4" /> : <Scissors className="h-4 w-4" />}
        {isRendering ? `${renderPhase} ${renderProgress}% · Hủy` : 'Ghép & tải MP4'}
      </button>

      <button 
        onClick={onDownloadMaster}
        disabled={progress < 100 || isDownloading} 
        className={
          isDownloading
            ? STYLES.button.loading
            : progress === 100 
            ? STYLES.button.secondary
            : STYLES.button.disabled
        }
      >
        {isDownloading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Download className="w-4 h-4" />
        )}
        {isDownloading ? `${phase} ${downloadProgress}%` : 'Gói dựng dự phòng (.zip)'}
      </button>
      
      <button 
        className={STYLES.button.tertiary}
        onClick={onExportTimeline}
      >
        <FileVideo className="w-4 h-4" />
        Xuất EDL / XML / SRT
      </button>
    </div>
  );
};

export default ActionButtons;
