import { ProjectState, RenderLog, VoiceTake } from '../../types';

export const collectRenderLogs = (project: ProjectState): RenderLog[] => {
  const logs = project.renderLogs || [];
  return logs.sort((a, b) => b.timestamp - a.timestamp);
};

export const calculateEstimatedDuration = (project: ProjectState): number => {
  return project.shots.reduce((acc, shot) => acc + (shot.interval?.duration || 10), 0);
};

export const getCompletedShots = (project: ProjectState) => {
  return project.shots.filter(s => s.interval?.videoUrl);
};

export const calculateProgress = (project: ProjectState): number => {
  const totalShots = project.shots.length;
  const completedShots = getCompletedShots(project).length;
  return totalShots > 0 ? Math.round((completedShots / totalShots) * 100) : 0;
};

export const getSelectedVoiceTakes = (project: ProjectState): VoiceTake[] => {
  const voiceStudio = project.voiceStudio;
  if (!voiceStudio) return [];

  return project.shots.flatMap((shot) => {
    const takeId = voiceStudio.selectedTakeByShot[shot.id];
    const take = voiceStudio.takes.find((item) => item.id === takeId);
    return take?.status === 'ready' && take.audioUrl ? [take] : [];
  });
};

export const getVoiceStats = (project: ProjectState) => {
  const dialogueShots = project.shots.filter((shot) => Boolean(shot.dialogue?.trim()));
  const selectedTakes = getSelectedVoiceTakes(project);

  return {
    required: dialogueShots.length,
    ready: selectedTakes.filter((take) => dialogueShots.some((shot) => shot.id === take.shotId)).length,
    selectedTakes,
  };
};

export const formatTimestamp = (timestamp: number): string => {
  return new Date(timestamp).toLocaleString('vi-VN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

export const formatDuration = (duration: number): string => {
  return (duration / 1000).toFixed(1) + 's';
};

export const hasDownloadableAssets = (project: ProjectState): boolean => {
  return (
    (project.scriptData?.characters.some(c => c.referenceImage || c.variations?.some(v => v.referenceImage))) ||
    (project.scriptData?.scenes.some(s => s.referenceImage)) ||
    (project.shots.some(s => s.keyframes?.some(k => k.imageUrl) || s.interval?.videoUrl)) ||
    getSelectedVoiceTakes(project).length > 0
  );
};

export const getLogStats = (logs: RenderLog[]) => {
  return {
    total: logs.length,
    success: logs.filter(l => l.status === 'success').length,
    failed: logs.filter(l => l.status === 'failed').length
  };
};

export const getLogTypeIcon = (type: string): string => {
  const iconMap: Record<string, string> = {
    'character': 'NV',
    'character-variation': 'BT',
    'scene': 'BC',
    'keyframe': 'KF',
    'video': 'VD',
    'voice': 'GN',
    'script-parsing': 'KB',
  };
  return iconMap[type] || 'ND';
};

export const getStatusColorClass = (status: string): string => {
  const colorMap: Record<string, string> = {
    'success': 'text-green-400 bg-green-500/10 border-green-500/30',
    'failed': 'text-red-400 bg-red-500/10 border-red-500/30',
    'pending': 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30'
  };
  return colorMap[status] || 'text-zinc-400 bg-zinc-500/10 border-zinc-500/30';
};

export const hasLogDetails = (log: RenderLog): boolean => {
  return !!(log.prompt || log.resourceId || log.inputTokens || log.outputTokens);
};
