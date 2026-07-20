import React from 'react';
import { Play, Download, FileVideo, Loader2 } from 'lucide-react';
import { STYLES, DownloadState } from './constants';
import { useAlert } from '../GlobalAlert';

interface Props {
  completedShotsCount: number;
  totalShots: number;
  progress: number;
  downloadState: DownloadState;
  onPreview: () => void;
  onDownloadMaster: () => void;
}

const ActionButtons: React.FC<Props> = ({
  completedShotsCount,
  totalShots,
  progress,
  downloadState,
  onPreview,
  onDownloadMaster
}) => {
  const { showAlert } = useAlert();
  const { isDownloading, phase, progress: downloadProgress } = downloadState;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <button 
        onClick={onPreview}
        disabled={completedShotsCount === 0}
        className={completedShotsCount > 0 ? STYLES.button.primary : STYLES.button.disabled}
      >
        <Play className="w-4 h-4" />
        Xem trước video ({completedShotsCount}/{totalShots})
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
        {isDownloading ? `${phase} ${downloadProgress}%` : 'Tải gói dựng (.zip)'}
      </button>
      
      <button 
        className={STYLES.button.tertiary}
        onClick={() => showAlert('Tính năng đang được phát triển', { type: 'info', title: 'Thông báo' })}
      >
        <FileVideo className="w-4 h-4" />
        Xuất EDL / XML
      </button>
    </div>
  );
};

export default ActionButtons;
