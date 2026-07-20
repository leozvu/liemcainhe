import React, { useState, useEffect } from 'react';
import { LayoutGrid, Sparkles, Loader2, AlertCircle, Edit2, Film, Video as VideoIcon } from 'lucide-react';
import { ProjectState, Shot, Keyframe, AspectRatio, VideoDuration } from '../../types';
import { migrateDeprecatedChatModelId, migrateDeprecatedVideoModelId } from '../../types/model';
import { generateImage, generateVideo, generateActionSuggestion, optimizeKeyframePrompt, optimizeBothKeyframes, enhanceKeyframePrompt, splitShotIntoSubShots, rewritePromptForModeration } from '../../services/geminiService';
import { 
  getRefImagesForShot, 
  buildKeyframePrompt,
  buildKeyframePromptWithAI,
  buildVideoPrompt,
  extractBasePrompt,
  generateId,
  delay,
  convertImageToBase64,
  createKeyframe,
  updateKeyframeInShot,
  generateSubShotIds,
  createSubShot,
  replaceShotWithSubShots
} from './utils';
import { DEFAULTS } from './constants';
import EditModal from './EditModal';
import ShotCard from './ShotCard';
import ShotWorkbench from './ShotWorkbench';
import ImagePreviewModal from './ImagePreviewModal';
import { useAlert } from '../GlobalAlert';
import { getDefaultAspectRatio } from '../../services/modelRegistry';
import {
  addProductionJob,
  clearShotStaleFlag,
  createProductionJob,
  createProjectCheckpoint,
  markShotWorkflowStale,
  patchProductionJob,
  setProductionJobStatus,
} from '../../services/workflowService';

interface Props {
  project: ProjectState;
  updateProject: (updates: Partial<ProjectState> | ((prev: ProjectState) => ProjectState)) => void;
  onApiKeyError?: (error: any) => boolean;
}

const StageDirector: React.FC<Props> = ({ project, updateProject, onApiKeyError }) => {
  const { showAlert } = useAlert();
  const [activeShotId, setActiveShotId] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{current: number, total: number, message: string} | null>(null);
  const [previewImage, setPreviewImage] = useState<{url: string, title: string} | null>(null);
  const [isAIGenerating, setIsAIGenerating] = useState(false);
  const [useAIEnhancement, setUseAIEnhancement] = useState(false);
  const [isSplittingShot, setIsSplittingShot] = useState(false);
  
  const [keyframeAspectRatio, setKeyframeAspectRatio] = useState<AspectRatio>(() => getDefaultAspectRatio());
  
  const [editModal, setEditModal] = useState<{
    type: 'action' | 'keyframe' | 'video';
    value: string;
    shotId?: string;
    frameType?: 'start' | 'end';
  } | null>(null);

  const activeShotIndex = project.shots.findIndex(s => s.id === activeShotId);
  const activeShot = project.shots[activeShotIndex];
  
  const allStartFramesGenerated = project.shots.length > 0 && 
    project.shots.every(s => s.keyframes?.find(k => k.type === 'start')?.imageUrl && !s.workflow?.keyframesStale);

  // Khôi phục tác vụ bị gián đoạn để người dùng có thể tạo lại sau khi mở trang.
  useEffect(() => {
    const hasStuckGenerating = project.shots.some(shot => {
      const stuckKeyframes = shot.keyframes?.some(kf => kf.status === 'generating' && !kf.imageUrl);
      const stuckVideo = shot.interval?.status === 'generating' && !shot.interval?.videoUrl;
      return stuckKeyframes || stuckVideo;
    });

    if (hasStuckGenerating) {
      updateProject((prevProject: ProjectState) => ({
        ...prevProject,
        shots: prevProject.shots.map(shot => ({
          ...shot,
          keyframes: shot.keyframes?.map(kf => 
            kf.status === 'generating' && !kf.imageUrl
              ? { ...kf, status: 'failed' as const }
              : kf
          ),
          interval: shot.interval && shot.interval.status === 'generating' && !shot.interval.videoUrl
            ? { ...shot.interval, status: 'failed' as const }
            : shot.interval
        }))
      }));
    }
  }, [project.id]);

  const updateShot = (shotId: string, transform: (s: Shot) => Shot) => {
    updateProject((prevProject: ProjectState) => ({
      ...prevProject,
      shots: prevProject.shots.map(s => s.id === shotId ? transform(s) : s)
    }));
  };

  const handleGenerateKeyframe = async (shot: Shot, type: 'start' | 'end'): Promise<boolean> => {
    const existingKf = shot.keyframes?.find(k => k.type === type);
    const kfId = existingKf?.id || generateId(`kf-${shot.id}-${type}`);
    
    const basePrompt = existingKf?.visualPrompt 
      ? extractBasePrompt(existingKf.visualPrompt, shot.actionSummary)
      : shot.actionSummary;
    
    const visualStyle = project.visualStyle || project.scriptData?.visualStyle || 'live-action';
    
    updateProject((prevProject: ProjectState) => ({
      ...prevProject,
      shots: prevProject.shots.map(s => {
        if (s.id !== shot.id) return s;
        return updateKeyframeInShot(s, type, createKeyframe(kfId, type, basePrompt, undefined, 'generating'));
      })
    }));
    
    let prompt: string;
    if (useAIEnhancement) {
      try {
        prompt = await buildKeyframePromptWithAI(basePrompt, visualStyle, shot.cameraMovement, type, true);
      } catch (error) {
        console.error('Không thể tăng cường bằng AI, dùng câu lệnh cơ bản:', error);
        prompt = buildKeyframePrompt(basePrompt, visualStyle, shot.cameraMovement, type);
      }
    } else {
      prompt = buildKeyframePrompt(basePrompt, visualStyle, shot.cameraMovement, type);
    }
    
    try {
      const referenceImages = getRefImagesForShot(shot, project.scriptData);
      const url = await generateImage(prompt, referenceImages, keyframeAspectRatio);

      updateProject((prevProject: ProjectState) => ({
        ...prevProject,
        shots: prevProject.shots.map(s => {
          if (s.id !== shot.id) return s;
          return markShotWorkflowStale(updateKeyframeInShot(s, type, createKeyframe(kfId, type, prompt, url, 'completed')), 'keyframe');
        })
      }));
      return true;
    } catch (e: any) {
      console.error(e);
      updateProject((prevProject: ProjectState) => ({
        ...prevProject,
        shots: prevProject.shots.map(s => {
          if (s.id !== shot.id) return s;
          return updateKeyframeInShot(s, type, createKeyframe(kfId, type, prompt, undefined, 'failed'));
        })
      }));
      
      if (onApiKeyError && onApiKeyError(e)) return false;
      showAlert(`Tạo nội dung thất bại: ${e.message}`, { type: 'error' });
      return false;
    }
  };

  const handleUploadKeyframeImage = async (shot: Shot, type: 'start' | 'end') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      
      if (!file.type.startsWith('image/')) {
        showAlert('Hãy chọn một tệp hình ảnh!', { type: 'warning' });
        return;
      }
      
      try {
        const base64Url = await convertImageToBase64(file);
        const existingKf = shot.keyframes?.find(k => k.type === type);
        const kfId = existingKf?.id || generateId(`kf-${shot.id}-${type}`);
        
        updateProject((prevProject: ProjectState) => ({
          ...prevProject,
          shots: prevProject.shots.map(s => {
            if (s.id !== shot.id) return s;
            const visualPrompt = existingKf?.visualPrompt || shot.actionSummary;
            return markShotWorkflowStale(updateKeyframeInShot(s, type, createKeyframe(kfId, type, visualPrompt, base64Url, 'completed')), 'keyframe');
          })
        }));
      } catch (error) {
        showAlert('Không thể đọc tệp!', { type: 'error' });
      }
    };
    
    input.click();
  };

  const handleTextToVideoOnlyChange = (shot: Shot, enabled: boolean) => {
    const sKf = shot.keyframes?.find(k => k.type === 'start');
    const eKf = shot.keyframes?.find(k => k.type === 'end');
    const intervalId = shot.interval?.id || generateId(`int-${shot.id}`);
    updateShot(shot.id, (s) => markShotWorkflowStale({
      ...s,
      interval: s.interval
        ? { ...s.interval, textToVideoOnly: enabled }
        : {
            id: intervalId,
            startKeyframeId: sKf?.id || '',
            endKeyframeId: eKf?.id || '',
            duration: 8,
            motionStrength: 5,
            textToVideoOnly: enabled,
            status: 'pending',
          },
    }, 'video'));
  };

  const handleGenerateVideo = async (
    shot: Shot,
    aspectRatio: AspectRatio = '16:9',
    duration: VideoDuration = 8,
    modelId?: string,
    textToVideoOnly = false
  ) => {
    const sKf = shot.keyframes?.find(k => k.type === 'start');
    const eKf = shot.keyframes?.find(k => k.type === 'end');

    if (!textToVideoOnly && !sKf?.imageUrl) {
      return showAlert('Hãy tạo khung bắt đầu hoặc bật chế độ video chỉ từ văn bản.', { type: 'warning' });
    }

    let selectedModel: string = migrateDeprecatedVideoModelId(
      modelId || shot.videoModel || DEFAULTS.videoModel
    );
    
    const projectLanguage = project.language || project.scriptData?.language || 'Vietnamese';
    const videoPrompt = shot.interval?.videoPrompt || buildVideoPrompt(
      shot.actionSummary,
      shot.cameraMovement,
      selectedModel,
      projectLanguage
    );
    
    const intervalId = shot.interval?.id || generateId(`int-${shot.id}`);
    const job = createProductionJob({
      kind: 'video',
      stage: 'director',
      label: `Tạo video cảnh ${project.shots.findIndex((item) => item.id === shot.id) + 1}`,
      totalUnits: 1,
      resourceId: shot.id,
      detail: `Đang gửi yêu cầu tới ${selectedModel}.`,
    });
    updateProject((previous) => setProductionJobStatus(addProductionJob(previous, job), job.id, 'running'));
    
    updateShot(shot.id, (s) => ({
      ...s,
      videoModel: selectedModel as any,
      interval: s.interval ? { ...s.interval, status: 'generating', videoPrompt, textToVideoOnly } : {
        id: intervalId,
        startKeyframeId: sKf?.id || '',
        endKeyframeId: eKf?.id || '',
        duration: duration,
        motionStrength: 5,
        videoPrompt,
        textToVideoOnly,
        status: 'generating'
      }
    }));
    
    try {
      const videoUrl = await generateVideo(
        videoPrompt, 
        textToVideoOnly ? undefined : sKf?.imageUrl, 
        textToVideoOnly ? undefined : eKf?.imageUrl,
        selectedModel,
        aspectRatio,
        duration
      );

      updateShot(shot.id, (s) => clearShotStaleFlag({
        ...s,
        interval: s.interval ? { ...s.interval, videoUrl, status: 'completed', textToVideoOnly } : {
          id: intervalId,
          startKeyframeId: sKf?.id || '',
          endKeyframeId: eKf?.id || '',
          duration: 10,
          motionStrength: 5,
          videoPrompt,
          textToVideoOnly,
          videoUrl,
          status: 'completed'
        }
      }, 'video'));
      updateProject((previous) => setProductionJobStatus(previous, job.id, 'completed'));
    } catch (e: any) {
      console.error(e);
      updateShot(shot.id, (s) => ({
        ...s,
        interval: s.interval ? { ...s.interval, status: 'failed', textToVideoOnly } : undefined
      }));
      updateProject((previous) => setProductionJobStatus(previous, job.id, 'failed', e.message || 'Tạo video thất bại'));
      
      if (onApiKeyError && onApiKeyError(e)) return;
      showAlert(e.message || 'Tạo video thất bại', { type: 'error' });
    }
  };

  // Giữ ý đồ kể chuyện nhưng làm dịu nội dung nhạy cảm khi tối ưu để thử lại.
  const handleOptimizeVideoPromptForModeration = async () => {
    if (!activeShot?.interval?.videoPrompt) {
      showAlert('Cảnh quay hiện tại chưa có câu lệnh video để tối ưu. Hãy tạo video hoặc chỉnh câu lệnh trước.', { type: 'warning' });
      return;
    }
    setIsAIGenerating(true);
    try {
      const optimized = await rewritePromptForModeration(activeShot.interval.videoPrompt);
      updateShot(activeShot.id, (s) => markShotWorkflowStale({
        ...s,
        interval: s.interval ? { ...s.interval, videoPrompt: optimized, status: 'pending' } : undefined
      }, 'video'));
      showAlert('Đã tự động tối ưu mô tả. Hãy nhấn “Bắt đầu tạo video” để thử lại.', { type: 'success' });
    } catch (e: any) {
      if (onApiKeyError && onApiKeyError(e)) return;
      showAlert(`Tối ưu thất bại: ${e.message}`, { type: 'error' });
    } finally {
      setIsAIGenerating(false);
    }
  };

  const handleCopyPreviousEndFrame = () => {
    if (activeShotIndex === 0 || !activeShot) return;
    
    const previousShot = project.shots[activeShotIndex - 1];
    const previousEndKf = previousShot?.keyframes?.find(k => k.type === 'end');
    
    if (!previousEndKf?.imageUrl) {
      showAlert("Cảnh quay trước chưa có khung kết thúc", { type: 'warning' });
      return;
    }
    
    const existingStartKf = activeShot.keyframes?.find(k => k.type === 'start');
    const newStartKfId = existingStartKf?.id || generateId(`kf-${activeShot.id}-start`);
    
    updateShot(activeShot.id, (s) => {
      return markShotWorkflowStale(updateKeyframeInShot(
        s, 
        'start', 
        createKeyframe(newStartKfId, 'start', previousEndKf.visualPrompt, previousEndKf.imageUrl, 'completed')
      ), 'keyframe');
    });
  };

  const handleCopyNextStartFrame = () => {
    if (activeShotIndex >= project.shots.length - 1 || !activeShot) return;
    
    const nextShot = project.shots[activeShotIndex + 1];
    const nextStartKf = nextShot?.keyframes?.find(k => k.type === 'start');
    
    if (!nextStartKf?.imageUrl) {
      showAlert("Cảnh quay sau chưa có khung bắt đầu", { type: 'warning' });
      return;
    }
    
    const existingEndKf = activeShot.keyframes?.find(k => k.type === 'end');
    const newEndKfId = existingEndKf?.id || generateId(`kf-${activeShot.id}-end`);
    
    updateShot(activeShot.id, (s) => {
      return markShotWorkflowStale(updateKeyframeInShot(
        s, 
        'end', 
        createKeyframe(newEndKfId, 'end', nextStartKf.visualPrompt, nextStartKf.imageUrl, 'completed')
      ), 'keyframe');
    });
  };

  const handleBatchGenerateImages = async () => {
    const isRegenerate = allStartFramesGenerated;
    
    let shotsToProcess = [];
    if (isRegenerate) {
      showAlert("Bạn có chắc muốn tạo lại khung bắt đầu của mọi cảnh quay? Ảnh hiện có sẽ bị ghi đè.", {
        type: 'warning',
        showCancel: true,
        onConfirm: async () => {
          shotsToProcess = [...project.shots];
          await executeBatchGenerate(shotsToProcess, isRegenerate);
        }
      });
      return;
    } else {
      shotsToProcess = project.shots.filter(s => !s.keyframes?.find(k => k.type === 'start')?.imageUrl || s.workflow?.keyframesStale);
    }
    
    if (shotsToProcess.length === 0) return;
    await executeBatchGenerate(shotsToProcess, isRegenerate);
  };

  const executeBatchGenerate = async (shotsToProcess: any[], isRegenerate: boolean) => {
    const job = createProductionJob({
      kind: 'keyframe-image',
      stage: 'director',
      label: `Tạo ${shotsToProcess.length} khung bắt đầu`,
      totalUnits: shotsToProcess.length,
      detail: 'Tạo lần lượt, giữ liên kết nhân vật và bối cảnh của từng cảnh.',
    });
    updateProject((previous) => {
      const protectedProject = isRegenerate
        ? createProjectCheckpoint(previous, 'Trước khi tạo lại toàn bộ khung bắt đầu')
        : previous;
      return setProductionJobStatus(addProductionJob(protectedProject, job), job.id, 'running');
    });
    setBatchProgress({ 
      current: 0, 
      total: shotsToProcess.length, 
      message: isRegenerate ? "Đang tạo lại tất cả khung bắt đầu..." : "Đang tạo hàng loạt các khung bắt đầu còn thiếu..."
    });

    let failures = 0;
    for (let i = 0; i < shotsToProcess.length; i++) {
      if (i > 0) await delay(DEFAULTS.batchGenerateDelay);
      
      const shot = shotsToProcess[i];
      setBatchProgress({ 
        current: i + 1, 
        total: shotsToProcess.length, 
        message: `Đang tạo cảnh quay ${i+1}/${shotsToProcess.length}...`
      });
      
      try {
        const success = await handleGenerateKeyframe(shot, 'start');
        if (!success) failures += 1;
        updateProject((previous) => patchProductionJob(previous, job.id, {
          progress: Math.round(((i + 1) / shotsToProcess.length) * 100),
          completedUnits: i + 1,
          detail: failures ? `${failures} khung lỗi · tiếp tục các cảnh còn lại` : `Đã hoàn tất ${i + 1}/${shotsToProcess.length} khung`,
        }));
      } catch (e: any) {
        console.error(`Không thể tạo nội dung cho cảnh quay ${shot.id}`, e);
        if (onApiKeyError && onApiKeyError(e)) {
          setBatchProgress(null);
          updateProject((previous) => setProductionJobStatus(previous, job.id, 'failed', e.message || 'Batch khung hình bị gián đoạn'));
          return;
        }
      }
    }

    setBatchProgress(null);
    updateProject((previous) => setProductionJobStatus(
      previous,
      job.id,
      failures ? 'failed' : 'completed',
      failures ? `${failures}/${shotsToProcess.length} khung không tạo được.` : undefined,
    ));
  };

  const handleSaveEdit = () => {
    if (!editModal || !activeShot) return;
    
    switch (editModal.type) {
      case 'action':
        updateShot(activeShot.id, (s) => markShotWorkflowStale({ ...s, actionSummary: editModal.value }, 'visual'));
        break;
      case 'keyframe':
        updateShot(activeShot.id, (s) => markShotWorkflowStale({
          ...s,
          keyframes: s.keyframes?.map(kf => 
            kf.type === editModal.frameType 
              ? { ...kf, visualPrompt: editModal.value }
              : kf
          ) || []
        }, 'visual'));
        break;
      case 'video':
        updateShot(activeShot.id, (s) => markShotWorkflowStale({
          ...s,
          interval: s.interval ? { ...s.interval, videoPrompt: editModal.value } : undefined
        }, 'video'));
        break;
    }
    
    setEditModal(null);
  };

  const handleGenerateAIAction = async () => {
    if (!activeShot) return;
    
    const startKf = activeShot.keyframes?.find(k => k.type === 'start');
    const endKf = activeShot.keyframes?.find(k => k.type === 'end');
    
    if (!startKf?.visualPrompt && !endKf?.visualPrompt) {
      showAlert('Hãy tạo hoặc chỉnh câu lệnh khung bắt đầu và kết thúc để AI hiểu bối cảnh tốt hơn.', { type: 'warning' });
      return;
    }
    
    setIsAIGenerating(true);
    
    try {
      const startPrompt = startKf?.visualPrompt || activeShot.actionSummary || 'Bối cảnh bắt đầu chưa xác định';
      const endPrompt = endKf?.visualPrompt || activeShot.actionSummary || 'Bối cảnh kết thúc chưa xác định';
      const cameraMovement = activeShot.cameraMovement || 'Pan';
      
      const suggestion = await generateActionSuggestion(
        startPrompt,
        endPrompt,
        cameraMovement
      );
      
      if (editModal && editModal.type === 'action') {
        setEditModal({ ...editModal, value: suggestion });
      }
    } catch (e: any) {
      console.error('AI không thể tạo hành động:', e);
      if (onApiKeyError && onApiKeyError(e)) return;
      showAlert(`AI không thể tạo hành động: ${e.message}`, { type: 'error' });
    } finally {
      setIsAIGenerating(false);
    }
  };

  const handleOptimizeKeyframeWithAI = async (type: 'start' | 'end') => {
    if (!activeShot) return;
    
    const scene = project.scriptData?.scenes.find(s => String(s.id) === String(activeShot.sceneId));
    if (!scene) {
      showAlert('Không tìm thấy thông tin bối cảnh', { type: 'warning' });
      return;
    }
    
    setIsAIGenerating(true);
    
    try {
      const characterNames: string[] = [];
      if (activeShot.characters && project.scriptData?.characters) {
        activeShot.characters.forEach(charId => {
          const char = project.scriptData?.characters.find(c => String(c.id) === String(charId));
          if (char) characterNames.push(char.name);
        });
      }
      
      const visualStyle = project.visualStyle || project.scriptData?.visualStyle || 'live-action';
      const actionSummary = activeShot.actionSummary || 'Hành động chưa xác định';
      const cameraMovement = activeShot.cameraMovement || 'Pan';
      
      const optimizedPrompt = await optimizeKeyframePrompt(
        type,
        actionSummary,
        cameraMovement,
        {
          location: scene.location,
          time: scene.time,
          atmosphere: scene.atmosphere
        },
        characterNames,
        visualStyle
      );
      
      const existingKf = activeShot.keyframes?.find(k => k.type === type);
      const kfId = existingKf?.id || generateId(`kf-${activeShot.id}-${type}`);
      
      updateShot(activeShot.id, (s) => {
        return updateKeyframeInShot(
          s,
          type,
          createKeyframe(kfId, type, optimizedPrompt, existingKf?.imageUrl, existingKf?.status || 'pending')
        );
      });
      
      showAlert(`Đã tối ưu câu lệnh ${type === 'start' ? 'khung bắt đầu' : 'khung kết thúc'}`, { type: 'success' });
    } catch (e: any) {
      console.error('AI tối ưu thất bại:', e);
      if (onApiKeyError && onApiKeyError(e)) return;
      showAlert(`AI tối ưu thất bại: ${e.message}`, { type: 'error' });
    } finally {
      setIsAIGenerating(false);
    }
  };

  const handleOptimizeBothKeyframes = async () => {
    if (!activeShot) return;
    
    const scene = project.scriptData?.scenes.find(s => String(s.id) === String(activeShot.sceneId));
    if (!scene) {
      showAlert('Không tìm thấy thông tin bối cảnh', { type: 'warning' });
      return;
    }
    
    setIsAIGenerating(true);
    
    try {
      const characterNames: string[] = [];
      if (activeShot.characters && project.scriptData?.characters) {
        activeShot.characters.forEach(charId => {
          const char = project.scriptData?.characters.find(c => String(c.id) === String(charId));
          if (char) characterNames.push(char.name);
        });
      }
      
      const visualStyle = project.visualStyle || project.scriptData?.visualStyle || 'live-action';
      const actionSummary = activeShot.actionSummary || 'Hành động chưa xác định';
      const cameraMovement = activeShot.cameraMovement || 'Pan';
      
      const result = await optimizeBothKeyframes(
        actionSummary,
        cameraMovement,
        {
          location: scene.location,
          time: scene.time,
          atmosphere: scene.atmosphere
        },
        characterNames,
        visualStyle
      );
      
      const startKf = activeShot.keyframes?.find(k => k.type === 'start');
      const endKf = activeShot.keyframes?.find(k => k.type === 'end');
      const startKfId = startKf?.id || generateId(`kf-${activeShot.id}-start`);
      const endKfId = endKf?.id || generateId(`kf-${activeShot.id}-end`);
      
      updateShot(activeShot.id, (s) => {
        let updated = updateKeyframeInShot(
          s,
          'start',
          createKeyframe(startKfId, 'start', result.startPrompt, startKf?.imageUrl, startKf?.status || 'pending')
        );
        updated = updateKeyframeInShot(
          updated,
          'end',
          createKeyframe(endKfId, 'end', result.endPrompt, endKf?.imageUrl, endKf?.status || 'pending')
        );
        return updated;
      });
      
      showAlert('Đã tối ưu câu lệnh khung bắt đầu và kết thúc', { type: 'success' });
    } catch (e: any) {
      console.error('AI tối ưu thất bại:', e);
      if (onApiKeyError && onApiKeyError(e)) return;
      showAlert(`AI tối ưu thất bại: ${e.message}`, { type: 'error' });
    } finally {
      setIsAIGenerating(false);
    }
  };

  // Khi tách cảnh quay, thay cảnh gốc đồng thời giữ bối cảnh và nhân vật liên quan.
  const handleSplitShot = async (shot: Shot) => {
    if (!shot) return;
    
    const scene = project.scriptData?.scenes.find(s => String(s.id) === String(shot.sceneId));
    if (!scene) {
      showAlert('Không tìm thấy thông tin bối cảnh', { type: 'warning' });
      return;
    }
    
    const characterNames: string[] = [];
    if (shot.characters && project.scriptData?.characters) {
      shot.characters.forEach(charId => {
        const char = project.scriptData?.characters.find(c => String(c.id) === String(charId));
        if (char) characterNames.push(char.name);
      });
    }
    
    const visualStyle = project.visualStyle || project.scriptData?.visualStyle || 'live-action';
    const shotGenerationModel =
      migrateDeprecatedChatModelId(project.shotGenerationModel) || 'gpt-5.2';
    
    setIsSplittingShot(true);
    
    try {
      const subShotsData = await splitShotIntoSubShots(
        shot,
        {
          location: scene.location,
          time: scene.time,
          atmosphere: scene.atmosphere
        },
        characterNames,
        visualStyle,
        shotGenerationModel
      );
      
      const subShotIds = generateSubShotIds(shot.id, subShotsData.subShots.length);
      const subShots = subShotsData.subShots.map((data, idx) => 
        createSubShot(shot, data, subShotIds[idx])
      );
      
      updateProject((prevProject: ProjectState) => ({
        ...prevProject,
        shots: replaceShotWithSubShots(prevProject.shots, shot.id, subShots)
      }));
      
      setActiveShotId(null);
      showAlert(`Đã chia cảnh quay thành ${subShots.length} cảnh con`, { type: 'success' });
    } catch (e: any) {
      console.error('Chia cảnh quay thất bại:', e);
      if (onApiKeyError && onApiKeyError(e)) return;
      showAlert(`Chia cảnh thất bại: ${e.message}`, { type: 'error' });
    } finally {
      setIsSplittingShot(false);
    }
  };

  if (!project.shots.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 bg-slate-950/35 backdrop-blur-sm">
        <AlertCircle className="w-12 h-12 mb-4 opacity-50"/>
        <p>Chưa có dữ liệu cảnh quay. Hãy quay lại Giai đoạn 01 để tạo bảng phân cảnh.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-950/35 relative overflow-hidden backdrop-blur-sm">
      
      {batchProgress && (
        <div className="absolute inset-0 z-50 bg-black/80 flex flex-col items-center justify-center backdrop-blur-md animate-in fade-in">
          <Loader2 className="w-12 h-12 text-cyan-300 animate-spin mb-6" />
          <h3 className="text-xl font-bold text-white mb-2">{batchProgress.message}</h3>
          <div className="w-64 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-cyan-300 to-sky-400 transition-all duration-300" 
              style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
            />
          </div>
          <p className="text-zinc-500 mt-3 text-xs font-mono">
            {Math.round((batchProgress.current / batchProgress.total) * 100)}%
          </p>
        </div>
      )}

      <div className="h-16 border-b border-white/10 bg-slate-950/55 px-6 flex items-center justify-between shrink-0 backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-3">
            <LayoutGrid className="w-5 h-5 text-cyan-300" />
            Xưởng AI
            <span className="text-xs text-cyan-100/40 font-mono font-normal uppercase tracking-wider bg-white/5 px-2 py-1 rounded-full">
              BÀN ĐẠO DIỄN
            </span>
          </h2>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10">
            <Sparkles className={`w-3.5 h-3.5 ${useAIEnhancement ? 'text-cyan-300' : 'text-slate-600'}`} />
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-xs text-zinc-400">AI tăng cường câu lệnh</span>
              <input
                type="checkbox"
                checked={useAIEnhancement}
                onChange={(e) => setUseAIEnhancement(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-white/20 bg-slate-900 text-cyan-300 focus:ring-2 focus:ring-cyan-300/40 focus:ring-offset-0 cursor-pointer"
              />
            </label>
          </div>
          
          <span className="text-xs text-zinc-500 mr-4 font-mono">
            {project.shots.filter(s => s.interval?.videoUrl).length} / {project.shots.length} hoàn thành
          </span>
          <button 
            onClick={handleBatchGenerateImages}
            disabled={!!batchProgress}
            className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide transition-all flex items-center gap-2 ${
              allStartFramesGenerated
                ? 'bg-white/[0.05] text-slate-400 border border-white/10 hover:text-white hover:border-cyan-300/30'
                : 'bg-gradient-to-r from-cyan-300 to-sky-400 text-slate-950 hover:from-cyan-200 hover:to-sky-300 shadow-lg shadow-cyan-500/20'
            }`}
          >
            <Sparkles className="w-3 h-3" />
            {allStartFramesGenerated ? 'Tạo lại tất cả khung đầu' : 'Tạo hàng loạt khung đầu'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex">
        <div className={`flex-1 overflow-y-auto p-6 transition-all duration-500 ease-in-out ${activeShotId ? 'border-r border-white/10' : ''}`}>
          <div className={`grid gap-4 ${activeShotId ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-2' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'}`}>
            {project.shots.map((shot, idx) => (
              <ShotCard
                key={shot.id}
                shot={shot}
                index={idx}
                isActive={activeShotId === shot.id}
                onClick={() => setActiveShotId(shot.id)}
              />
            ))}
          </div>
        </div>

        {activeShotId && activeShot && (
          <ShotWorkbench
            shot={activeShot}
            shotIndex={activeShotIndex}
            totalShots={project.shots.length}
            scriptData={project.scriptData}
            nextShotHasStartFrame={!!project.shots[activeShotIndex + 1]?.keyframes?.find(k => k.type === 'start')?.imageUrl}
            isAIOptimizing={isAIGenerating}
            isSplittingShot={isSplittingShot}
            onClose={() => setActiveShotId(null)}
            onPrevious={() => setActiveShotId(project.shots[activeShotIndex - 1].id)}
            onNext={() => setActiveShotId(project.shots[activeShotIndex + 1].id)}
            onEditActionSummary={() => setEditModal({ type: 'action', value: activeShot.actionSummary })}
            onGenerateAIAction={handleGenerateAIAction}
            onSplitShot={() => handleSplitShot(activeShot)}
            onAddCharacter={(charId) => updateShot(activeShot.id, s => markShotWorkflowStale({ ...s, characters: [...s.characters, charId] }, 'casting'))}
            onRemoveCharacter={(charId) => updateShot(activeShot.id, s => markShotWorkflowStale({
              ...s,
              characters: s.characters.filter(id => id !== charId),
              characterVariations: Object.fromEntries(
                Object.entries(s.characterVariations || {}).filter(([k]) => k !== charId)
              )
            }, 'casting'))}
            onVariationChange={(charId, varId) => updateShot(activeShot.id, s => markShotWorkflowStale({
              ...s,
              characterVariations: { ...(s.characterVariations || {}), [charId]: varId }
            }, 'visual'))}
            onSceneChange={(sceneId) => updateShot(activeShot.id, s => markShotWorkflowStale({ ...s, sceneId }, 'visual'))}
            onGenerateKeyframe={(type) => handleGenerateKeyframe(activeShot, type)}
            onUploadKeyframe={(type) => handleUploadKeyframeImage(activeShot, type)}
            onEditKeyframePrompt={(type, prompt) => setEditModal({ type: 'keyframe', value: prompt, frameType: type })}
            onOptimizeKeyframeWithAI={(type) => handleOptimizeKeyframeWithAI(type)}
            onOptimizeBothKeyframes={handleOptimizeBothKeyframes}
            onCopyPreviousEndFrame={handleCopyPreviousEndFrame}
            onCopyNextStartFrame={handleCopyNextStartFrame}
            useAIEnhancement={useAIEnhancement}
            onToggleAIEnhancement={() => setUseAIEnhancement(!useAIEnhancement)}
            onGenerateVideo={(aspectRatio, duration, modelId, textToVideoOnly) =>
              handleGenerateVideo(activeShot, aspectRatio, duration, modelId, textToVideoOnly)
            }
            onTextToVideoOnlyChange={(enabled) => handleTextToVideoOnlyChange(activeShot, enabled)}
            onEditVideoPrompt={() => {
              let promptValue = activeShot.interval?.videoPrompt;
              if (!promptValue) {
                const selectedModel = activeShot.videoModel || DEFAULTS.videoModel;
                const projectLanguage = project.language || project.scriptData?.language || 'Vietnamese';
                promptValue = buildVideoPrompt(
                  activeShot.actionSummary,
                  activeShot.cameraMovement,
                  selectedModel,
                  projectLanguage
                );
              }
              setEditModal({ 
                type: 'video', 
                value: promptValue
              });
            }}
            onOptimizeVideoPromptForModeration={handleOptimizeVideoPromptForModeration}
            onImageClick={(url, title) => setPreviewImage({ url, title })}
          />
        )}
      </div>

      <EditModal
        isOpen={!!editModal}
        onClose={() => setEditModal(null)}
        onSave={handleSaveEdit}
        title={
          editModal?.type === 'action' ? 'Chỉnh sửa hành động kể chuyện' :
          editModal?.type === 'keyframe' ? 'Chỉnh sửa câu lệnh khung hình chính' :
          'Chỉnh sửa câu lệnh video'
        }
        icon={
          editModal?.type === 'action' ? <Film className="w-4 h-4 text-cyan-300" /> :
          editModal?.type === 'keyframe' ? <Edit2 className="w-4 h-4 text-cyan-300" /> :
          <VideoIcon className="w-4 h-4 text-cyan-300" />
        }
        value={editModal?.value || ''}
        onChange={(value) => setEditModal(editModal ? { ...editModal, value } : null)}
        placeholder={
          editModal?.type === 'action' ? 'Mô tả hành động và nội dung cảnh quay...' :
          editModal?.type === 'keyframe' ? 'Nhập câu lệnh cho khung hình chính...' :
          'Nhập câu lệnh tạo video...'
        }
        textareaClassName={editModal?.type === 'keyframe' || editModal?.type === 'video' ? 'font-mono' : 'font-normal'}
        showAIGenerate={editModal?.type === 'action'}
        onAIGenerate={handleGenerateAIAction}
        isAIGenerating={isAIGenerating}
      />

      <ImagePreviewModal 
        imageUrl={previewImage?.url || null}
        title={previewImage?.title}
        onClose={() => setPreviewImage(null)}
      />
    </div>
  );
};

export default StageDirector;
