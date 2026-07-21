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
  factory?: ShotFactoryContext;
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
  mastered?: boolean;
  masteringGainDb?: number;
  trimmedSeconds?: number;
  masteringSkippedReason?: string;
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
export type ProductionJobKind = 'script-analysis' | 'creative-director' | 'video-factory' | 'ai-supervisor' | 'auto-editor' | 'asset-image' | 'keyframe-image' | 'video' | 'voice' | 'cloud-sync' | 'export';
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
  videoFactory?: VideoFactoryState;
  aiSupervisor?: AISupervisorState;
  autoEditor?: AutoEditorState;
}

export interface ProjectCheckpoint {
  id: string;
  label: string;
  createdAt: number;
  stage: ProjectStage;
  snapshot: ProjectSnapshot;
}

export type ProductionTaskStatus = 'todo' | 'in-progress' | 'review' | 'done' | 'blocked';
export type ProductionTaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type ProductionTaskSource = 'template' | 'director' | 'manual';

export interface ProductionTask {
  id: string;
  title: string;
  detail?: string;
  stage: CoreStage;
  status: ProductionTaskStatus;
  priority: ProductionTaskPriority;
  source: ProductionTaskSource;
  assignee: string;
  dueAt?: number;
  requiresApproval: boolean;
  createdAt: number;
  updatedAt: number;
}

export type ProductionApprovalStatus = 'pending' | 'approved' | 'changes-requested';

export interface ProductionApprovalGate {
  stage: CoreStage;
  status: ProductionApprovalStatus;
  reviewer?: string;
  note?: string;
  updatedAt: number;
}

export interface ProjectWorkflowState {
  jobs: ProductionJob[];
  checkpoints: ProjectCheckpoint[];
  productionTasks?: ProductionTask[];
  approvalGates?: ProductionApprovalGate[];
  lastCloudSyncAt?: number;
  cloudSyncStatus?: 'idle' | 'syncing' | 'synced' | 'error';
  cloudSyncError?: string;
}

export type ClientReviewPortalStatus = 'active' | 'closed';
export type ClientReviewDecisionStatus = 'pending' | 'changes-requested' | 'approved';
export type ClientReviewCommentStatus = 'open' | 'resolved';

export interface ClientReviewClip {
  id: string;
  shotId: string;
  title: string;
  actionSummary: string;
  duration: number;
  videoUrl: string;
  posterUrl?: string;
}

export interface ClientReviewVersion {
  id: string;
  number: number;
  label: string;
  note?: string;
  duration: number;
  clips: ClientReviewClip[];
  createdAt: number;
}

export interface ClientReviewComment {
  id: string;
  versionId: string;
  clipId: string;
  authorName: string;
  authorEmail?: string;
  body: string;
  timecodeSeconds: number;
  status: ClientReviewCommentStatus;
  createdAt: number;
  updatedAt: number;
}

export interface ClientReviewPortal {
  id: string;
  projectId: string;
  title: string;
  clientName: string;
  campaignName?: string;
  deliverableTitle?: string;
  status: ClientReviewPortalStatus;
  decision: ClientReviewDecisionStatus;
  decisionVersionId?: string;
  decisionNote?: string;
  reviewerName?: string;
  reviewerEmail?: string;
  decidedAt?: number;
  expiresAt?: number;
  versions: ClientReviewVersion[];
  comments: ClientReviewComment[];
  shareUrl?: string;
  createdAt: number;
  updatedAt: number;
}

export type CreativeDirectorMode = 'advisory' | 'copilot' | 'autopilot';
export type CreativeDirectorRunStatus = 'thinking' | 'awaiting-approval' | 'completed' | 'failed';
export type CreativeDirectorProposalKind = 'script' | 'storyboard' | 'moodboard' | 'production-plan' | 'timeline';
export type CreativeDirectorProposalStatus = 'pending' | 'applied' | 'rejected';

export interface CreativeDirectorMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  proposalId?: string;
}

export interface CreativeDirectorPlanStep {
  id: string;
  title: string;
  detail: string;
  stage: CoreStage;
  status: 'suggested' | 'ready' | 'blocked';
}

export interface MoodboardSpec {
  title: string;
  creativeDirection: string;
  palette: Array<{ name: string; hex: string; usage: string }>;
  lighting: string[];
  camera: string[];
  textures: string[];
  wardrobe: string[];
  typography: string[];
  references: string[];
  avoid: string[];
}

export interface CreativeDirectorShotDraft {
  id?: string;
  sceneId: string;
  actionSummary: string;
  dialogue?: string;
  cameraMovement: string;
  shotSize?: string;
  characters: string[];
  duration?: number;
  startFramePrompt?: string;
  endFramePrompt?: string;
}

export interface CreativeDirectorTimelineItem {
  shotId: string;
  duration: number;
  transition: 'cut' | 'crossfade' | 'fade-black';
  transitionDuration?: number;
  audioNote?: string;
  editNote?: string;
}

export interface CreativeDirectorProposalChanges {
  rawScript?: string;
  targetDuration?: string;
  visualStyle?: string;
  shots?: CreativeDirectorShotDraft[];
  moodboard?: MoodboardSpec;
  productionPlan?: string[];
  timeline?: CreativeDirectorTimelineItem[];
}

export interface CreativeDirectorProposal {
  id: string;
  kind: CreativeDirectorProposalKind;
  title: string;
  summary: string;
  rationale: string[];
  affectedShotIds: string[];
  estimatedCostUsd: number;
  requiresApproval: boolean;
  status: CreativeDirectorProposalStatus;
  changes: CreativeDirectorProposalChanges;
  createdAt: number;
  appliedAt?: number;
}

export interface CreativeDirectorRun {
  id: string;
  query: string;
  status: CreativeDirectorRunStatus;
  startedAt: number;
  completedAt?: number;
  proposalId?: string;
  jobId?: string;
  error?: string;
}

export type CreativeDirectorToolName =
  | 'generate-character-image'
  | 'generate-scene-image'
  | 'generate-start-keyframe'
  | 'generate-end-keyframe'
  | 'generate-video'
  | 'generate-voice';

export type CreativeDirectorActionStatus = 'pending' | 'blocked' | 'running' | 'completed' | 'failed' | 'skipped';
export type CreativeDirectorMissionStatus = 'draft' | 'awaiting-approval' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface CreativeDirectorMissionAction {
  id: string;
  tool: CreativeDirectorToolName;
  label: string;
  stage: CoreStage;
  status: CreativeDirectorActionStatus;
  dependsOn: string[];
  resourceId: string;
  estimatedCostUsd: number;
  attempts: number;
  maxAttempts: number;
  requiresApproval: boolean;
  idempotencyKey: string;
  blockedReason?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  input?: {
    shotId?: string;
    frameType?: 'start' | 'end';
    duration?: number;
    textToVideoOnly?: boolean;
    previousOutput?: string;
  };
}

export interface CreativeDirectorMission {
  id: string;
  goal: string;
  status: CreativeDirectorMissionStatus;
  actions: CreativeDirectorMissionAction[];
  estimatedCostUsd: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  jobId?: string;
  error?: string;
}

export interface CreativeDirectorState {
  mode: CreativeDirectorMode;
  budgetLimitUsd: number;
  messages: CreativeDirectorMessage[];
  proposals: CreativeDirectorProposal[];
  runs: CreativeDirectorRun[];
  missions: CreativeDirectorMission[];
  plan: CreativeDirectorPlanStep[];
  memory: string[];
  moodboard?: MoodboardSpec;
  productionPlan?: string[];
  timeline?: CreativeDirectorTimelineItem[];
}

export type CampaignStatus = 'brief' | 'planning' | 'production' | 'review' | 'delivered' | 'paused';
export type CampaignPriority = 'low' | 'normal' | 'high' | 'urgent';
export type CampaignObjective = 'awareness' | 'engagement' | 'leads' | 'conversion' | 'retention' | 'launch';
export type CampaignPlatform = 'tiktok' | 'facebook' | 'instagram' | 'youtube' | 'website' | 'other';
export type DeliverableStatus = 'planned' | 'in-progress' | 'review' | 'approved' | 'delivered';

export type BrandAssetType = 'logo' | 'product' | 'character' | 'reference';

export interface BrandColor {
  id: string;
  name: string;
  hex: string;
  usage?: string;
}

export interface BrandAsset {
  id: string;
  type: BrandAssetType;
  name: string;
  url: string;
  notes?: string;
}

export interface BrandVoiceProfile {
  name: string;
  providerId?: string;
  voiceId?: string;
  description?: string;
  language?: string;
}

export interface BrandPlatformRule {
  platform: CampaignPlatform;
  safeZone?: string;
  captionStyle?: string;
  guidelines?: string;
}

export interface BrandKit {
  colors: BrandColor[];
  fonts: string[];
  assets: BrandAsset[];
  voiceProfile?: BrandVoiceProfile;
  toneOfVoice: string;
  mandatoryTerms: string[];
  forbiddenTerms: string[];
  ctas: string[];
  approvedExamples: string[];
  platformRules: BrandPlatformRule[];
  updatedAt: number;
}

export type VideoFactoryVoiceMode = 'with-voice' | 'no-voice';
export type VideoFactoryTier = 'draft' | 'final';
export type VideoFactoryVariantStatus = 'planned' | 'materialized' | 'approved' | 'ready' | 'failed';

export interface VideoFactoryVariant {
  id: string;
  name: string;
  hook: string;
  cta: string;
  aspectRatio: AspectRatio;
  duration: number;
  voiceMode: VideoFactoryVoiceMode;
  audience: string;
  tier: VideoFactoryTier;
  status: VideoFactoryVariantStatus;
  estimatedCostUsd: number;
  shotIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface VideoFactoryPolicy {
  draftImageModelId?: string;
  draftVideoModelId?: string;
  finalImageModelId?: string;
  finalVideoModelId?: string;
  maxVariants: number;
  budgetLimitUsd: number;
  reuseAssets: boolean;
}

export interface VideoFactoryState {
  hooks: string[];
  ctas: string[];
  aspectRatios: AspectRatio[];
  durations: number[];
  voiceModes: VideoFactoryVoiceMode[];
  audiences: string[];
  variants: VideoFactoryVariant[];
  policy: VideoFactoryPolicy;
  createdAt: number;
  updatedAt: number;
}

export interface ShotFactoryContext {
  variantId: string;
  sourceShotId: string;
  aspectRatio: AspectRatio;
  targetDuration: number;
  voiceMode: VideoFactoryVoiceMode;
  audience: string;
  tier: VideoFactoryTier;
}

export type AISupervisorIssueKind =
  | 'missing-media'
  | 'stale-media'
  | 'face'
  | 'hands'
  | 'logo'
  | 'product'
  | 'continuity'
  | 'dialogue-overrun'
  | 'safe-zone'
  | 'brand'
  | 'cta';

export type AISupervisorIssueSeverity = 'info' | 'warning' | 'critical';
export type AISupervisorIssueStatus = 'open' | 'queued' | 'resolved' | 'ignored';
export type AISupervisorIssueSource = 'local' | 'ai-vision';
export type AISupervisorRepairTarget = 'none' | 'script' | 'voice' | 'keyframes' | 'video';

export interface AISupervisorIssue {
  id: string;
  kind: AISupervisorIssueKind;
  severity: AISupervisorIssueSeverity;
  status: AISupervisorIssueStatus;
  source: AISupervisorIssueSource;
  title: string;
  detail: string;
  repairTarget: AISupervisorRepairTarget;
  confidence?: number;
  createdAt: number;
  updatedAt: number;
}

export interface AISupervisorShotReport {
  shotId: string;
  score: number;
  status: 'pass' | 'warning' | 'fail';
  visionStatus: 'not-run' | 'complete' | 'unavailable';
  issues: AISupervisorIssue[];
  mediaSignature: string;
  analyzedAt: number;
  visionAnalyzedAt?: number;
  repairEstimatedCostUsd?: number;
}

export interface AISupervisorPolicy {
  repairBudgetUsd: number;
  visionBudgetUsd: number;
  maxVisionShotsPerRun: number;
  requireHumanApproval: boolean;
}

export interface AISupervisorState {
  reports: AISupervisorShotReport[];
  policy: AISupervisorPolicy;
  repairCommittedCostUsd: number;
  visionSpentUsd: number;
  lastLocalAuditAt?: number;
  lastVisionAuditAt?: number;
  updatedAt: number;
}

export type AutoEditorTransition = 'cut' | 'crossfade';
export type AutoEditorCaptionStyle = 'clean' | 'bold' | 'boxed';
export type AutoEditorLogoPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type AutoEditorColorPreset = 'natural' | 'cinematic' | 'warm' | 'cool' | 'contrast';
export type AutoEditorOutputStatus = 'planned' | 'rendering' | 'ready' | 'failed';

export interface AutoEditorTimelineClip {
  id: string;
  shotId: string;
  order: number;
  offset: number;
  duration: number;
  videoUrl?: string;
  voiceTakeId?: string;
  dialogue?: string;
  transition: AutoEditorTransition;
}

export interface AutoEditorCaptionCue {
  id: string;
  shotId: string;
  start: number;
  end: number;
  text: string;
}

export interface AutoEditorSettings {
  sourceId: 'master' | string;
  aspectRatios: AspectRatio[];
  includeVoice: boolean;
  captionsEnabled: boolean;
  captionStyle: AutoEditorCaptionStyle;
  transition: AutoEditorTransition;
  colorPreset: AutoEditorColorPreset;
  logoEnabled: boolean;
  logoAssetId?: string;
  logoPosition: AutoEditorLogoPosition;
  logoSizePercent: number;
  musicEnabled: boolean;
  musicUrl?: string;
  musicName?: string;
  musicVolume: number;
  duckingDb: number;
  fps: 25 | 30;
}

export interface AutoEditorOutput {
  id: string;
  name: string;
  aspectRatio: AspectRatio;
  status: AutoEditorOutputStatus;
  fileName: string;
  estimatedRenderMinutes: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AutoEditorState {
  settings: AutoEditorSettings;
  timeline: AutoEditorTimelineClip[];
  captions: AutoEditorCaptionCue[];
  outputs: AutoEditorOutput[];
  planSignature?: string;
  lastPlannedAt?: number;
  lastRenderedAt?: number;
  updatedAt: number;
}

export interface AgencyClient {
  id: string;
  name: string;
  brandName: string;
  industry: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  website?: string;
  notes?: string;
  brandKit: BrandKit;
  createdAt: number;
  updatedAt: number;
}

export interface CampaignDeliverable {
  id: string;
  title: string;
  platform: CampaignPlatform;
  aspectRatio: AspectRatio;
  duration: number;
  quantity: number;
  status: DeliverableStatus;
  projectId?: string;
}

export interface AgencyCampaign {
  id: string;
  clientId: string;
  name: string;
  objective: CampaignObjective;
  brief: string;
  product?: string;
  targetAudience: string;
  offer?: string;
  contentPillars: string[];
  owner: string;
  budget: number;
  currency: 'VND' | 'USD';
  deadline?: number;
  status: CampaignStatus;
  priority: CampaignPriority;
  deliverables: CampaignDeliverable[];
  projectIds: string[];
  createdAt: number;
  updatedAt: number;
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
  creativeDirector?: CreativeDirectorState;
  campaignId?: string;
  clientId?: string;
  deliverableId?: string;
  brandKitSnapshot?: BrandKit;
  videoFactory?: VideoFactoryState;
  aiSupervisor?: AISupervisorState;
  autoEditor?: AutoEditorState;
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
