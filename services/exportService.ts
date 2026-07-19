import { ProjectState } from '../types';

async function downloadFile(urlOrBase64: string): Promise<Blob> {
  if (urlOrBase64.startsWith('data:video/')) {
    const base64Data = urlOrBase64.split(',')[1];
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new Blob([bytes], { type: 'video/mp4' });
  }
  
  const response = await fetch(urlOrBase64);
  if (!response.ok) {
    throw new Error(`Tải xuống thất bại: ${response.statusText}`);
  }
  return await response.blob();
}

export async function downloadMasterVideo(
  project: ProjectState,
  onProgress?: (phase: string, progress: number) => void
): Promise<void> {
  try {
    const completedShots = project.shots.filter(shot => shot.interval?.videoUrl);
    
    if (completedShots.length === 0) {
      throw new Error('Không có đoạn video nào để xuất');
    }

    onProgress?.('Đang tải thư viện ZIP...', 0);
    
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    onProgress?.('Đang tải các đoạn video...', 10);

    for (let i = 0; i < completedShots.length; i++) {
      const shot = completedShots[i];
      const videoUrl = shot.interval!.videoUrl!;
      const shotNum = String(i + 1).padStart(3, '0');
      const fileName = `shot_${shotNum}.mp4`;
      
      try {
        const videoBlob = await downloadFile(videoUrl);
        zip.file(fileName, videoBlob);
        
        const progress = 10 + Math.round((i + 1) / completedShots.length * 75);
        onProgress?.(`Đang tải (${i + 1}/${completedShots.length})...`, progress);
      } catch (err) {
        console.error(`Tải đoạn video ${i + 1} thất bại:`, err);
      }
    }

    onProgress?.('Đang tạo tệp ZIP...', 85);

    const zipBlob = await zip.generateAsync(
      { type: 'blob' },
      (metadata) => {
        const progress = 85 + Math.round(metadata.percent / 10);
        onProgress?.('Đang nén...', progress);
      }
    );

    onProgress?.('Đang chuẩn bị tải xuống...', 95);

    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.scriptData?.title || project.title || 'master'}_videos.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    onProgress?.('Hoàn tất!', 100);
  } catch (error) {
    console.error('Xuất video thất bại:', error);
    throw error;
  }
}

export function estimateTotalDuration(project: ProjectState): number {
  return project.shots.reduce((acc, shot) => {
    return acc + (shot.interval?.duration || 10);
  }, 0);
}

export async function downloadSourceAssets(
  project: ProjectState,
  onProgress?: (phase: string, progress: number) => void
): Promise<void> {
  try {
    onProgress?.('Đang tải thư viện ZIP...', 0);
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    const assets: { url: string; path: string }[] = [];

    if (project.scriptData?.characters) {
      for (const char of project.scriptData.characters) {
        if (char.referenceImage) {
          assets.push({
            url: char.referenceImage,
            path: `characters/${char.name.replace(/[\/\\?%*:|"<>]/g, '_')}_base.jpg`
          });
        }
        if (char.variations) {
          for (const variation of char.variations) {
            if (variation.referenceImage) {
              assets.push({
                url: variation.referenceImage,
                path: `characters/${char.name.replace(/[\/\\?%*:|"<>]/g, '_')}_${variation.name.replace(/[\/\\?%*:|"<>]/g, '_')}.jpg`
              });
            }
          }
        }
      }
    }

    if (project.scriptData?.scenes) {
      for (const scene of project.scriptData.scenes) {
        if (scene.referenceImage) {
          assets.push({
            url: scene.referenceImage,
            path: `scenes/${scene.location.replace(/[\/\\?%*:|"<>]/g, '_')}.jpg`
          });
        }
      }
    }

    if (project.shots) {
      for (let i = 0; i < project.shots.length; i++) {
        const shot = project.shots[i];
        const shotNum = String(i + 1).padStart(3, '0');
        
        if (shot.keyframes) {
          for (const keyframe of shot.keyframes) {
            if (keyframe.imageUrl) {
              assets.push({
                url: keyframe.imageUrl,
                path: `shots/shot_${shotNum}_${keyframe.type}_frame.jpg`
              });
            }
          }
        }

        if (shot.interval?.videoUrl) {
          assets.push({
            url: shot.interval.videoUrl,
            path: `videos/shot_${shotNum}.mp4`
          });
        }
      }
    }

    if (assets.length === 0) {
      throw new Error('Không có tài nguyên để tải xuống');
    }

    onProgress?.('Đang tải tài nguyên...', 5);

    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      try {
        const blob = await downloadFile(asset.url);
        zip.file(asset.path, blob);
        
        const progress = 5 + Math.round((i + 1) / assets.length * 80);
        onProgress?.(`Đang tải (${i + 1}/${assets.length})...`, progress);
      } catch (error) {
        console.error(`Tải tài nguyên thất bại: ${asset.path}`, error);
      }
    }

    onProgress?.('Đang tạo tệp ZIP...', 90);

    const zipBlob = await zip.generateAsync(
      { type: 'blob' },
      (metadata) => {
        const progress = 90 + Math.round(metadata.percent / 10);
        onProgress?.('Đang nén...', progress);
      }
    );

    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.scriptData?.title || project.title || 'project'}_source_assets.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    onProgress?.('Hoàn tất!', 100);
  } catch (error) {
    console.error('Tải tài nguyên gốc thất bại:', error);
    throw error;
  }
}
