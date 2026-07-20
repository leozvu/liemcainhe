import { ProjectState, VoiceTake } from '../types';

const safeName = (value: string) => value.replace(/[\/\\?%*:|"<>]/g, '_').trim() || 'untitled';

const triggerBlobDownload = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

const escapeXml = (value: string) => value.replace(/[<>&"']/g, (character) => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
}[character] || character));

const secondsToSrt = (seconds: number) => {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor((milliseconds % 3600000) / 60000);
  const secs = Math.floor((milliseconds % 60000) / 1000);
  const ms = milliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
};

const framesToTimecode = (frames: number, fps = 25) => {
  const hours = Math.floor(frames / (fps * 3600));
  const minutes = Math.floor((frames % (fps * 3600)) / (fps * 60));
  const seconds = Math.floor((frames % (fps * 60)) / fps);
  const remainingFrames = frames % fps;
  return [hours, minutes, seconds, remainingFrames].map((value) => String(value).padStart(2, '0')).join(':');
};

const buildSubtitleFile = (project: ProjectState) => {
  let cursor = 0;
  let subtitleIndex = 0;
  return project.shots.flatMap((shot) => {
    const duration = shot.interval?.duration || 10;
    const start = cursor;
    cursor += duration;
    if (!shot.dialogue?.trim()) return [];
    subtitleIndex += 1;
    return [`${subtitleIndex}\n${secondsToSrt(start)} --> ${secondsToSrt(cursor)}\n${shot.dialogue.trim()}\n`];
  }).join('\n');
};

const buildEdlFile = (project: ProjectState) => {
  const fps = 25;
  let recordFrames = fps * 3600;
  const events = project.shots.map((shot, index) => {
    const durationFrames = Math.round((shot.interval?.duration || 10) * fps);
    const event = String(index + 1).padStart(3, '0');
    const reel = `S${String(index + 1).padStart(5, '0')}`;
    const recordIn = recordFrames;
    recordFrames += durationFrames;
    return `${event}  ${reel} V     C        00:00:00:00 ${framesToTimecode(durationFrames, fps)} ${framesToTimecode(recordIn, fps)} ${framesToTimecode(recordFrames, fps)}\n* FROM CLIP NAME: shot_${String(index + 1).padStart(3, '0')}.mp4`;
  });
  return `TITLE: ${project.scriptData?.title || project.title}\nFCM: NON-DROP FRAME\n\n${events.join('\n\n')}\n`;
};

const buildFcpxmlFile = (project: ProjectState) => {
  let cursor = 0;
  const resources = project.shots.map((shot, index) => {
    const duration = shot.interval?.duration || 10;
    return `<asset id="r${index + 2}" name="shot_${String(index + 1).padStart(3, '0')}" src="file:///video/shot_${String(index + 1).padStart(3, '0')}.mp4" start="0s" duration="${duration}s" hasVideo="1"/>`;
  }).join('');
  const clips = project.shots.map((shot, index) => {
    const duration = shot.interval?.duration || 10;
    const offset = cursor;
    cursor += duration;
    return `<asset-clip name="shot_${String(index + 1).padStart(3, '0')}" ref="r${index + 2}" offset="${offset}s" start="0s" duration="${duration}s"><note>${escapeXml(shot.dialogue || shot.actionSummary || '')}</note></asset-clip>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.10"><resources><format id="r1" name="FFVideoFormat1080p25" frameDuration="1/25s" width="1920" height="1080"/>${resources}</resources><library><event name="Egoric Film Studio"><project name="${escapeXml(project.scriptData?.title || project.title)}"><sequence format="r1" duration="${cursor}s" tcStart="3600s" tcFormat="NDF"><spine>${clips}</spine></sequence></project></event></library></fcpxml>`;
};

export async function downloadEditorialPackage(project: ProjectState): Promise<void> {
  if (!project.shots.length) throw new Error('Dự án chưa có cảnh quay để xuất timeline');
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('subtitles_vi.srt', buildSubtitleFile(project) || '');
  zip.file('timeline_25fps.edl', buildEdlFile(project));
  zip.file('timeline.fcpxml', buildFcpxmlFile(project));
  zip.file('README.txt', 'Gói timeline Egoric Film Studio\n\n- timeline_25fps.edl: CMX 3600, 25fps.\n- timeline.fcpxml: Final Cut Pro XML; khi nhập hãy relink tới thư mục video.\n- subtitles_vi.srt: phụ đề tiếng Việt theo thời lượng từng cảnh.');
  triggerBlobDownload(await zip.generateAsync({ type: 'blob' }), `${safeName(project.scriptData?.title || project.title)}_egoric_timeline.zip`);
}

const getSelectedVoiceTakes = (project: ProjectState): VoiceTake[] => {
  const studio = project.voiceStudio;
  if (!studio) return [];
  return project.shots.flatMap((shot) => {
    const take = studio.takes.find((item) => item.id === studio.selectedTakeByShot[shot.id]);
    return take?.status === 'ready' && take.audioUrl ? [take] : [];
  });
};

const voiceFileExtension = (take: VoiceTake) => {
  const fromName = take.fileName?.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  if (take.audioUrl?.startsWith('data:audio/wav')) return 'wav';
  return 'mp3';
};

async function downloadFile(urlOrBase64: string): Promise<Blob> {
  if (urlOrBase64.startsWith('data:')) {
    const [header, payload = ''] = urlOrBase64.split(',', 2);
    const mimeType = header.match(/^data:([^;,]+)/)?.[1] || 'application/octet-stream';
    const binaryString = header.includes(';base64') ? atob(payload) : decodeURIComponent(payload);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
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
    const selectedVoiceTakes = getSelectedVoiceTakes(project);
    
    if (completedShots.length === 0) {
      throw new Error('Không có đoạn video nào để xuất');
    }

    onProgress?.('Đang tải thư viện ZIP...', 0);
    
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    onProgress?.('Đang tải các đoạn video...', 10);

    const totalAssets = completedShots.length + selectedVoiceTakes.length;
    let processedAssets = 0;

    for (let i = 0; i < completedShots.length; i++) {
      const shot = completedShots[i];
      const projectShotIndex = project.shots.findIndex((item) => item.id === shot.id);
      const videoUrl = shot.interval!.videoUrl!;
      const shotNum = String(projectShotIndex + 1).padStart(3, '0');
      const fileName = `video/shot_${shotNum}.mp4`;
      
      try {
        const videoBlob = await downloadFile(videoUrl);
        zip.file(fileName, videoBlob);
        processedAssets += 1;
        const progress = 10 + Math.round(processedAssets / totalAssets * 70);
        onProgress?.(`Đang tải tư liệu (${processedAssets}/${totalAssets})...`, progress);
      } catch (err) {
        console.error(`Tải đoạn video ${i + 1} thất bại:`, err);
      }
    }

    for (const take of selectedVoiceTakes) {
      const projectShotIndex = project.shots.findIndex((shot) => shot.id === take.shotId);
      const shotNum = String(projectShotIndex + 1).padStart(3, '0');
      const extension = voiceFileExtension(take);
      try {
        zip.file(`audio/shot_${shotNum}_${take.source === 'human' ? 'human' : 'voice'}.${extension}`, await downloadFile(take.audioUrl!));
        processedAssets += 1;
        const progress = 10 + Math.round(processedAssets / totalAssets * 70);
        onProgress?.(`Đang tải tư liệu (${processedAssets}/${totalAssets})...`, progress);
      } catch (err) {
        console.error(`Tải bản thoại cho cảnh ${projectShotIndex + 1} thất bại:`, err);
      }
    }

    const manifest = project.shots.map((shot, index) => {
      const take = selectedVoiceTakes.find((item) => item.shotId === shot.id);
      const extension = take ? voiceFileExtension(take) : undefined;
      return {
        shot: index + 1,
        shotId: shot.id,
        action: shot.actionSummary,
        dialogue: shot.dialogue || '',
        durationSeconds: shot.interval?.duration || 10,
        videoFile: shot.interval?.videoUrl ? `video/shot_${String(index + 1).padStart(3, '0')}.mp4` : null,
        audioFile: take ? `audio/shot_${String(index + 1).padStart(3, '0')}_${take.source === 'human' ? 'human' : 'voice'}.${extension}` : null,
        voiceSource: take?.source || null,
        voiceName: take?.voiceName || null,
      };
    });
    zip.file('timeline.json', JSON.stringify({
      product: 'Egoric Film Studio',
      project: project.scriptData?.title || project.title,
      exportedAt: new Date().toISOString(),
      timeline: manifest,
    }, null, 2));
    zip.file('subtitles_vi.srt', buildSubtitleFile(project));
    zip.file('timeline_25fps.edl', buildEdlFile(project));
    zip.file('timeline.fcpxml', buildFcpxmlFile(project));
    zip.file('HUONG-DAN.txt', 'Gói dựng Egoric Film Studio\n\n1. Thư mục video chứa từng cảnh quay.\n2. Thư mục audio chứa bản thoại đã chọn trong Voice Studio.\n3. timeline.json giữ thứ tự cảnh, thời lượng và ánh xạ âm thanh để dựng trong Premiere, DaVinci Resolve hoặc phần mềm NLE khác.');

    onProgress?.('Đang tạo gói dựng ZIP...', 85);

    const zipBlob = await zip.generateAsync(
      { type: 'blob' },
      (metadata) => {
        const progress = 85 + Math.round(metadata.percent / 10);
        onProgress?.('Đang nén...', progress);
      }
    );

    onProgress?.('Đang chuẩn bị tải xuống...', 95);

    triggerBlobDownload(zipBlob, `${safeName(project.scriptData?.title || project.title || 'du-an')}_egoric_edit_package.zip`);

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

    if (project.voiceStudio) {
      for (const take of project.voiceStudio.takes) {
        if (take.status !== 'ready' || !take.audioUrl) continue;
        const shotIndex = project.shots.findIndex((shot) => shot.id === take.shotId);
        const shotNum = String(shotIndex + 1).padStart(3, '0');
        const selected = project.voiceStudio.selectedTakeByShot[take.shotId] === take.id ? '_selected' : '';
        const baseFileName = safeName((take.fileName || take.id).replace(/\.[a-z0-9]{2,5}$/i, ''));
        assets.push({
          url: take.audioUrl,
          path: `voices/shot_${shotNum}/${baseFileName}${selected}.${voiceFileExtension(take)}`,
        });
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
    a.download = `${safeName(project.scriptData?.title || project.title || 'du-an')}_egoric_source_assets.zip`;
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
