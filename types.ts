export interface CharacterVariation {
  id: string;
  name: string;
  visualPrompt: string;
  negativePrompt?: string;
  referenceImage?: string;
  status?: 'pending' | 'generating' | 'completed' | 'failed';
}

export interface Character {
  id: string;
  name: string;
  gender: string;
  age: string;
  personality: string;
  visualPrompt?: string;
  negativePrompt?: string;
  coreFeatures?: string;
  referenceImage?: string;
  variations: CharacterVariation[];
  status?: 'pending' | 'generating' | 'completed' | 'failed';
}

export interface Scene {
  id: string;
  location: string;
  time: string;
  atmosphere: string;
  visualPrompt?: string;
  negativePrompt?: string;
  referenceImage?: string;
  status?: 'pending' | 'generating' | 'completed' | 'failed';
}

export type AssetLibraryItemType = 'character' | 'scene';

export interface AssetLibraryItem {
  id: string;
  type: AssetLibraryItemType;
  name: string;
  createdAt: number;
  updatedAt: number;
  data: Character | Scene;
}

export interface Keyframe {
  id: string;
  type: 'start' | 'end';
  visualPrompt: string;
  imageUrl?: string;
  status: 'pending' | 'generating' | 'completed' | 'failed';
}

export interface VideoInterval {
  id: string;
  startKeyframeId: string;
  endKeyframeId: string;
  duration: number;
  motionStrength: number;
  videoUrl?: string;
  videoPrompt?: string;
  /** Tạo video thuần văn bản, không gửi ảnh khung đầu hoặc khung cuối. */
  textToVideoOnly?: boolean;
  status: 'pending' | 'generating' | 'completed' | 'failed';
}

export interface Shot {
  id: string;
  sceneId: string;
  actionSummary: string;
  dialogue?: string; 
  cameraMovement: string;
  shotSize?: string; 
  characters: string[];
  characterVariations?: { [characterId: string]: string };
  keyframes: Keyframe[];
  interval?: VideoInterval;
  videoModel?: 'veo' | 'sora-2' | 'veo_3_1_t2v_fast_landscape' | 'veo_3_1_t2v_fast_portrait' | 'veo_3_1_i2v_s_fast_fl_landscape' | 'veo_3_1_i2v_s_fast_fl_portrait';
  workflow?: ShotWorkflowState;
}

export interface ShotWorkflowState {
  keyframesStale?: boolean;
  voiceStale?: boolean;
  videoStale?: boolean;
  approved?: boolean;
  locked?: boolean;
  updatedAt?: number;
}

export type VoiceProviderId = 'fpt' | 'viettel' | 'elevenlabs' | 'vbee' | 'human';
export type VoiceRegion = 'north' | 'central' | 'south' | 'international';
export type VoiceTakeStatus = 'draft' | 'generating' | 'processing' | 'ready' | 'error';
export type VoiceEmotion = 'neutral' | 'warm' | 'confident' | 'dramatic' | 'energetic' | 'intimate';

export interface PronunciationEntry {
  id: string;
  source: string;
  replacement: string;
  note?: string;
}

export interface VoiceProfile {
  id: string;
  characterId: string;
  providerId: VoiceProviderId;
  voiceId: string;
  voiceName: string;
  region: VoiceRegion;
  speed: number;
  pitch: number;
  emotion: VoiceEmotion;
  style?: string;
}

export interface VoiceTake {
  id: string;
  shotId: string;
  characterId?: string;
  text: string;
  source: 'synthetic' | 'human';
  providerId: VoiceProviderId;
  voiceId?: string;
  voiceName?: string;
  status: VoiceTakeStatus;
  audioUrl?: string;
  duration?: number;
  fileName?: string;
  notes?: string;
  error?: string;
  sourceHash?: string;
  emotion?: VoiceEmotion;
  pitch?: number;
  createdAt: number;
}

export interface VoiceStudioState {
  defaultProviderId: VoiceProviderId;
  profiles: VoiceProfile[];
  takes: VoiceTake[];
  selectedTakeByShot: Record<string, string>;
  outputFormat: 'mp3' | 'wav';
  normalizeLoudness: boolean;
  pronunciationDictionary: PronunciationEntry[];
  previewText: string;
}

export interface ScriptData {
  title: string;
  genre: string;
  logline: string;
  targetDuration?: string;
  language?: string;
  visualStyle?: string;
  shotGenerationModel?: string;
  characters: Character[];
  scenes: Scene[];
  storyParagraphs: { id: number; text: string; sceneRefId: string }[];
}

export interface RenderLog {
  id: string;
  timestamp: number;
  type: 'character' | 'character-variation' | 'scene' | 'keyframe' | 'video' | 'voice' | 'script-parsing';
  resourceId: string;
  resourceName: string;
  status: 'success' | 'failed';
  model: string;
  prompt?: string;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  duration?: number;
}

export type ProjectStage = 'script' | 'assets' | 'voice' | 'director' | 'export' | 'prompts';
export type CoreStage = 'script' | 'assets' | 'voice' | 'director' | 'export';
export type ProductionJobKind = 'script-analysis' | 'asset-image' | 'keyframe-image' | 'video' | 'voice' | 'cloud-sync' | 'export';
export type ProductionJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled';

export interface ProductionJob {
  id: string;
  kind: ProductionJobKind;
  stage: CoreStage;
  label: string;
  status: ProductionJobStatus;
  progress: number;
  completedUnits?: number;
  totalUnits?: number;
  resourceId?: string;
  detail?: string;
  error?: string;
  attempts: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectSnapshot {
  title: string;
  stage: ProjectStage;
  rawScript: string;
  targetDuration: string;
  language: string;
  visualStyle: string;
  shotGenerationModel: string;
  scriptData: ScriptData | null;
  shots: Shot[];
  voiceStudio?: VoiceStudioState;
}

export interface ProjectCheckpoint {
  id: string;
  label: string;
  createdAt: number;
  stage: ProjectStage;
  snapshot: ProjectSnapshot;
}

export interface ProjectWorkflowState {
  jobs: ProductionJob[];
  checkpoints: ProjectCheckpoint[];
  lastCloudSyncAt?: number;
  cloudSyncStatus?: 'idle' | 'syncing' | 'synced' | 'error';
  cloudSyncError?: string;
}

export interface ProjectState {
  id: string;
  title: string;
  createdAt: number;
  lastModified: number;
  stage: ProjectStage;
  
  rawScript: string;
  targetDuration: string;
  language: string;
  visualStyle: string;
  shotGenerationModel: string;
  
  scriptData: ScriptData | null;
  shots: Shot[];
  isParsingScript: boolean;
  renderLogs: RenderLog[];
  voiceStudio?: VoiceStudioState;
  workflow?: ProjectWorkflowState;
}

export type AspectRatio = '16:9' | '9:16' | '1:1';

export type VideoDuration = 4 | 8 | 12;

export interface ModelProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  isDefault?: boolean;
  isBuiltIn?: boolean;
}

export interface ChatModelConfig {
  providerId: string;
  modelName: string;
  endpoint?: string;
}

export interface ImageModelConfig {
  providerId: string;
  modelName: string;
  endpoint?: string;
}

export interface VideoModelConfig {
  providerId: string;
  type: 'sora' | 'veo';
  modelName: string;
  endpoint?: string;
}

export interface ModelConfig {
  chatModel: ChatModelConfig;
  imageModel: ImageModelConfig;
  videoModel: VideoModelConfig;
}

export interface ModelManagerState {
  providers: ModelProvider[];
  currentConfig: ModelConfig;
  defaultAspectRatio: AspectRatio;
  defaultVideoDuration: VideoDuration;
}
