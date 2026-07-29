import React, { useState, useEffect } from 'react';
import { Users, Sparkles, RefreshCw, Loader2, MapPin, Archive, X, Search, Trash2 } from 'lucide-react';
import { ProjectState, CharacterVariation, Character, Scene, AspectRatio, AssetLibraryItem, ReferenceAngle } from '../../types';
import { generateImage, generateVisualPrompts } from '../../services/geminiService';
import {
  getRegionalPrefix, 
  handleImageUpload, 
  getProjectLanguage, 
  getProjectVisualStyle,
  delay,
  generateId,
  compareIds 
} from './utils';
import { DEFAULTS, STYLES, GRID_LAYOUTS } from './constants';
import ImagePreviewModal from './ImagePreviewModal';
import CharacterCard from './CharacterCard';
import SceneCard from './SceneCard';
import ConsistencyWorkbench from './ConsistencyWorkbench';
import WardrobeModal from './WardrobeModal';
import { useAlert } from '../GlobalAlert';
import { getAllAssetLibraryItems, saveAssetToLibrary, deleteAssetFromLibrary } from '../../services/storageService';
import { applyLibraryItemToProject, createLibraryItemFromCharacter, createLibraryItemFromScene, cloneCharacterForProject } from '../../services/assetLibraryService';
import { AspectRatioSelector } from '../AspectRatioSelector';
import { getDefaultAspectRatio, getImageModels, getActiveImageModel, getModelById } from '../../services/modelRegistry';
import ModelSelector from '../ModelSelector';
import { ImageModelDefinition, DEFAULT_IMAGE_MODEL_ID } from '../../types/model';
import { createProjectMediaExecutionContext } from '../../services/mediaExecutionService';
import {
  addProductionJob,
  createProductionJob,
  createProjectCheckpoint,
  markShotWorkflowStale,
  patchProductionJob,
  setProductionJobStatus,
} from '../../services/workflowService';
import {
  addReference,
  approveReference,
  lockGenerationParams,
  pickReferences,
  removeReference,
  resolveGenerationParams,
  unlockGenerationParams,
} from '../../services/consistencyService';
import { useLocale } from '../../contexts/LocaleContext';

interface Props {
  project: ProjectState;
  updateProject: (updates: Partial<ProjectState> | ((prev: ProjectState) => ProjectState)) => void;
  onApiKeyError?: (error: any) => boolean;
}

const StageAssets: React.FC<Props> = ({ project, updateProject, onApiKeyError }) => {
  const { showAlert } = useAlert();
  const { t } = useLocale();
  const [batchProgress, setBatchProgress] = useState<{current: number, total: number} | null>(null);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [libraryItems, setLibraryItems] = useState<AssetLibraryItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'character' | 'scene'>('all');
  const [replaceTargetCharId, setReplaceTargetCharId] = useState<string | null>(null);
  
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(() => getDefaultAspectRatio());
  
  const defaultImageModel = getActiveImageModel();
  const [selectedImageModelId, setSelectedImageModelId] = useState<string>(
    defaultImageModel?.id || DEFAULT_IMAGE_MODEL_ID
  );

  const language = getProjectLanguage(project.language, project.scriptData?.language);
  const visualStyle = getProjectVisualStyle(project.visualStyle, project.scriptData?.visualStyle);
  const genre = project.scriptData?.genre || DEFAULTS.genre;
  const displayAssetError = (error: any, fallback: string): string =>
    error?.message === 'Tải ảnh lên thất bại' ? t('assets.error.upload') : error?.message || fallback;

  const getLockedBrandAssets = (types: Array<'logo' | 'product' | 'character' | 'reference'>) => {
    const configuredIds = project.consistency?.lockedBrandAssetIds;
    return (project.brandKitSnapshot?.assets || []).filter((asset) =>
      types.includes(asset.type) && Boolean(asset.url) && (configuredIds === undefined || configuredIds.includes(asset.id)),
    );
  };

  const markDependentShotsStale = (state: ProjectState, type: 'character' | 'scene', id: string): ProjectState => ({
    ...state,
    shots: state.shots.map((shot) => {
      const affected = type === 'character'
        ? shot.characters.some((characterId) => compareIds(characterId, id))
        : compareIds(shot.sceneId, id);
      return affected ? markShotWorkflowStale(shot, 'visual') : shot;
    }),
  });

  const patchAssetInProject = (
    state: ProjectState,
    type: 'character' | 'scene',
    id: string,
    updates: Record<string, unknown>,
  ): ProjectState => {
    if (!state.scriptData) return state;
    return {
      ...state,
      scriptData: {
        ...state.scriptData,
        characters: type === 'character'
          ? state.scriptData.characters.map((character) => compareIds(character.id, id) ? { ...character, ...updates } : character)
          : state.scriptData.characters,
        scenes: type === 'scene'
          ? state.scriptData.scenes.map((scene) => compareIds(scene.id, id) ? { ...scene, ...updates } : scene)
          : state.scriptData.scenes,
      },
    };
  };

  const updateCharacterConsistency = (
    characterId: string,
    transform: (character: Character) => Character,
  ) => {
    updateProject((previous) => {
      if (!previous.scriptData) return previous;
      const next: ProjectState = {
        ...previous,
        scriptData: {
          ...previous.scriptData,
          characters: previous.scriptData.characters.map((character) =>
            compareIds(character.id, characterId) ? transform(character) : character,
          ),
        },
      };
      return markDependentShotsStale(next, 'character', characterId);
    });
  };

  const handleAddCharacterReference = async (
    characterId: string,
    file: File,
    angle: ReferenceAngle,
  ) => {
    try {
      const imageUrl = await handleImageUpload(file);
      updateCharacterConsistency(characterId, (character) => addReference(character, {
        imageUrl,
        angle,
        approved: false,
        addedAt: Date.now(),
      }));
      showAlert(t('assets.notice.referenceAdded'), { type: 'success' });
    } catch (error: any) {
      showAlert(error?.message || t('assets.error.addReference'), { type: 'error' });
    }
  };

  const handleApproveCharacterReference = (characterId: string, referenceId: string) => {
    updateCharacterConsistency(characterId, (character) => approveReference(character, referenceId));
  };

  const handleRemoveCharacterReference = (characterId: string, referenceId: string) => {
    showAlert(t('assets.notice.removeReference'), {
      type: 'warning',
      showCancel: true,
      onConfirm: () => updateCharacterConsistency(
        characterId,
        (character) => removeReference(character, referenceId),
      ),
    });
  };

  const handleLockCharacterGeneration = (characterId: string) => {
    updateCharacterConsistency(characterId, (character) => lockGenerationParams(character, {
      modelId: selectedImageModelId,
      aspectRatio,
    }));
  };

  const handleUnlockCharacterGeneration = (characterId: string) => {
    updateCharacterConsistency(characterId, unlockGenerationParams);
  };

  const updateSceneLock = (sceneId: string, locked: boolean) => {
    updateProject((previous) => {
      if (!previous.scriptData) return previous;
      const next = {
        ...previous,
        scriptData: {
          ...previous.scriptData,
          scenes: previous.scriptData.scenes.map((scene) => {
            if (!compareIds(scene.id, sceneId)) return scene;
            if (!locked) {
              const { lock: _removed, ...rest } = scene;
              return rest;
            }
            return {
              ...scene,
              lock: {
                modelId: selectedImageModelId,
                aspectRatio,
                lockedAt: Date.now(),
              },
            };
          }),
        },
      };
      return markDependentShotsStale(next, 'scene', sceneId);
    });
  };

  const handleToggleBrandAsset = (assetId: string) => {
    updateProject((previous) => {
      const availableIds = (previous.brandKitSnapshot?.assets || []).filter((asset) => asset.url).map((asset) => asset.id);
      const current = previous.consistency?.lockedBrandAssetIds ?? availableIds;
      const nextIds = current.includes(assetId)
        ? current.filter((id) => id !== assetId)
        : [...current, assetId];
      return {
        ...previous,
        consistency: { lockedBrandAssetIds: nextIds, updatedAt: Date.now() },
        shots: previous.shots.map((shot) => markShotWorkflowStale(shot, 'visual')),
      };
    });
  };

  // Khôi phục tác vụ bị gián đoạn để người dùng có thể tạo lại sau khi mở trang.
  useEffect(() => {
    if (!project.scriptData) return;

    const hasStuckCharacters = project.scriptData.characters.some(char => {
      const isCharStuck = char.status === 'generating' && !char.referenceImage;
      const hasStuckVariations = char.variations?.some(v => v.status === 'generating' && !v.referenceImage);
      return isCharStuck || hasStuckVariations;
    });

    const hasStuckScenes = project.scriptData.scenes.some(scene => 
      scene.status === 'generating' && !scene.referenceImage
    );

    if (hasStuckCharacters || hasStuckScenes) {
      const newData = { ...project.scriptData };
      
      newData.characters = newData.characters.map(char => ({
        ...char,
        status: char.status === 'generating' && !char.referenceImage ? 'failed' as const : char.status,
        variations: char.variations?.map(v => ({
          ...v,
          status: v.status === 'generating' && !v.referenceImage ? 'failed' as const : v.status
        }))
      }));
      
      newData.scenes = newData.scenes.map(scene => ({
        ...scene,
        status: scene.status === 'generating' && !scene.referenceImage ? 'failed' as const : scene.status
      }));
      
      updateProject({ scriptData: newData });
    }
  }, [project.id]);

  const refreshLibrary = async () => {
    setLibraryLoading(true);
    try {
      const items = await getAllAssetLibraryItems();
      setLibraryItems(items);
    } catch (e) {
      console.error('Không thể tải thư viện tài nguyên', e);
    } finally {
      setLibraryLoading(false);
    }
  };

  useEffect(() => {
    if (showLibraryModal) {
      refreshLibrary();
    }
  }, [showLibraryModal]);

  const openLibrary = (filter: 'all' | 'character' | 'scene', targetCharId: string | null = null) => {
    setLibraryFilter(filter);
    setReplaceTargetCharId(targetCharId);
    setShowLibraryModal(true);
  };

  const handleGenerateAsset = async (type: 'character' | 'scene', id: string): Promise<boolean> => {
    const currentAsset = type === 'character'
      ? project.scriptData?.characters.find((item) => compareIds(item.id, id))
      : project.scriptData?.scenes.find((item) => compareIds(item.id, id));
    updateProject((previous) => patchAssetInProject(previous, type, id, { status: 'generating' }));
    try {
      let prompt = "";
      
      if (type === 'character') {
        const char = project.scriptData?.characters.find(c => compareIds(c.id, id));
        if (char) {
          if (char.visualPrompt) {
            prompt = char.visualPrompt;
          } else {
            const prompts = await generateVisualPrompts('character', char, genre, DEFAULTS.modelVersion, visualStyle, language);
            prompt = prompts.visualPrompt;
            
            updateProject((previous) => patchAssetInProject(previous, type, id, {
              visualPrompt: prompts.visualPrompt,
              negativePrompt: prompts.negativePrompt,
            }));
          }
        }
      } else {
        const scene = project.scriptData?.scenes.find(s => compareIds(s.id, id));
        if (scene) {
          if (scene.visualPrompt) {
            prompt = scene.visualPrompt;
          } else {
            const prompts = await generateVisualPrompts('scene', scene, genre, DEFAULTS.modelVersion, visualStyle, language);
            prompt = prompts.visualPrompt;
            
            updateProject((previous) => patchAssetInProject(previous, type, id, {
              visualPrompt: prompts.visualPrompt,
              negativePrompt: prompts.negativePrompt,
            }));
          }
        }
      }

      const regionalPrefix = getRegionalPrefix(language, type);
      const lockedBrandAssets = type === 'scene'
        ? getLockedBrandAssets(['product', 'logo', 'reference'])
        : getLockedBrandAssets(['character', 'reference']);
      const brandPrompt = lockedBrandAssets.length
        ? ` Tài sản thương hiệu bắt buộc: ${lockedBrandAssets.map((asset) => `${asset.name}${asset.notes ? ` (${asset.notes})` : ''}`).join('; ')}. Không thay đổi logo, bao bì hoặc màu sắc.`
        : '';
      const enhancedPrompt = regionalPrefix + prompt + brandPrompt;
      const character = type === 'character' ? currentAsset as Character | undefined : undefined;
      const generation = resolveGenerationParams(
        character ? [character] : [],
        selectedImageModelId,
        aspectRatio,
        type === 'scene' && currentAsset
          ? [{ name: (currentAsset as Scene).location, lock: (currentAsset as Scene).lock }]
          : [],
      );
      const referenceImages = Array.from(new Set([
        ...(character ? pickReferences(character).map((reference) => reference.imageUrl) : []),
        ...lockedBrandAssets.map((asset) => asset.url),
      ])).slice(0, 3);

      await generateImage(
        enhancedPrompt,
        referenceImages,
        generation.aspectRatio || aspectRatio,
        false,
        generation.modelId,
        `asset:${type}:${id}`,
        createProjectMediaExecutionContext({
          project,
          updateProject,
          kind: 'asset-image',
          stage: 'assets',
          label: t('assets.job.single', { type: t(type === 'character' ? 'assets.character' : 'assets.scene'), name: currentAsset?.name || id }),
          resourceId: `${type}:${id}`,
          previousOutput: currentAsset?.referenceImage,
          commitResult: (previous, imageUrl) => markDependentShotsStale(
            patchAssetInProject(previous, type, id, { referenceImage: imageUrl, status: 'completed' }),
            type,
            id,
          ),
        }),
      );
      return true;
    } catch (e: any) {
      console.error(e);
      updateProject((previous) => patchAssetInProject(previous, type, id, { status: 'failed' }));
      if (onApiKeyError && onApiKeyError(e)) {
        return false;
      }
      return false;
    }
  };

  const handleBatchGenerate = async (type: 'character' | 'scene') => {
    const items = type === 'character' 
      ? project.scriptData?.characters 
      : project.scriptData?.scenes;
    
    if (!items) return;

    const itemsToGen = items.filter(i => !i.referenceImage);
    const isRegenerate = itemsToGen.length === 0;

    if (isRegenerate) {
      showAlert(t('assets.confirm.batch', { type: t(type === 'character' ? 'assets.character' : 'assets.scene') }), {
        type: 'warning',
        showCancel: true,
        onConfirm: async () => {
          await executeBatchGenerate(items, type, true);
        }
      });
      return;
    }

    await executeBatchGenerate(itemsToGen, type);
  };

  const executeBatchGenerate = async (targetItems: any[], type: 'character' | 'scene', protectExisting = false) => {
    if (!targetItems.length) return;
    const job = createProductionJob({
      kind: 'asset-image',
      stage: 'assets',
      label: t('assets.job.batch', { count: targetItems.length, type: t(type === 'character' ? 'assets.character' : 'assets.scene') }),
      totalUnits: targetItems.length,
      detail: t('assets.job.batchDetail'),
    });
    updateProject((previous) => {
      const protectedProject = protectExisting
        ? createProjectCheckpoint(previous, t('assets.job.batchCheckpoint', { type: t(type === 'character' ? 'assets.character' : 'assets.scene') }))
        : previous;
      return setProductionJobStatus(addProductionJob(protectedProject, job), job.id, 'running');
    });
    setBatchProgress({ current: 0, total: targetItems.length });
    let failures = 0;

    for (let i = 0; i < targetItems.length; i++) {
      if (i > 0) await delay(DEFAULTS.batchGenerateDelay);
      
      const success = await handleGenerateAsset(type, targetItems[i].id);
      if (!success) failures += 1;
      setBatchProgress({ current: i + 1, total: targetItems.length });
      updateProject((previous) => patchProductionJob(previous, job.id, {
        progress: Math.round(((i + 1) / targetItems.length) * 100),
        completedUnits: i + 1,
        detail: failures
          ? t('assets.job.batchFailure', { count: failures })
          : t('assets.job.batchProgress', { current: i + 1, total: targetItems.length }),
      }));
    }

    setBatchProgress(null);
    updateProject((previous) => setProductionJobStatus(
      previous,
      job.id,
      failures ? 'failed' : 'completed',
      failures ? t('assets.job.batchSummary', { failed: failures, total: targetItems.length }) : undefined,
    ));
  };

  const handleUploadCharacterImage = async (charId: string, file: File) => {
    try {
      const base64 = await handleImageUpload(file);
      
      if (project.scriptData) {
        const newData = { ...project.scriptData };
        const char = newData.characters.find(c => compareIds(c.id, charId));
        if (char) {
          char.referenceImage = base64;
        }
        updateProject((previous) => markDependentShotsStale({ ...previous, scriptData: newData }, 'character', charId));
      }
    } catch (e: any) {
      showAlert(displayAssetError(e, t('assets.error.upload')), { type: 'error' });
    }
  };

  const handleUploadSceneImage = async (sceneId: string, file: File) => {
    try {
      const base64 = await handleImageUpload(file);
      
      if (project.scriptData) {
        const newData = { ...project.scriptData };
        const scene = newData.scenes.find(s => compareIds(s.id, sceneId));
        if (scene) {
          scene.referenceImage = base64;
        }
        updateProject((previous) => markDependentShotsStale({ ...previous, scriptData: newData }, 'scene', sceneId));
      }
    } catch (e: any) {
      showAlert(displayAssetError(e, t('assets.error.upload')), { type: 'error' });
    }
  };

  const handleAddCharacterToLibrary = (char: Character) => {
    const saveItem = async () => {
      try {
        const item = createLibraryItemFromCharacter(char);
        await saveAssetToLibrary(item);
        showAlert(t('assets.notice.libraryAdded', { name: char.name }), { type: 'success' });
        refreshLibrary();
      } catch (e: any) {
        showAlert(e?.message || t('assets.error.libraryAdd'), { type: 'error' });
      }
    };

    if (!char.referenceImage) {
      showAlert(t('assets.notice.characterMissingReference'), {
        type: 'warning',
        showCancel: true,
        onConfirm: saveItem
      });
      return;
    }

    void saveItem();
  };

  const handleAddSceneToLibrary = (scene: Scene) => {
    const saveItem = async () => {
      try {
        const item = createLibraryItemFromScene(scene);
        await saveAssetToLibrary(item);
        showAlert(t('assets.notice.libraryAdded', { name: scene.location }), { type: 'success' });
        refreshLibrary();
      } catch (e: any) {
        showAlert(e?.message || t('assets.error.libraryAdd'), { type: 'error' });
      }
    };

    if (!scene.referenceImage) {
      showAlert(t('assets.notice.sceneMissingReference'), {
        type: 'warning',
        showCancel: true,
        onConfirm: saveItem
      });
      return;
    }

    void saveItem();
  };

  const handleImportFromLibrary = (item: AssetLibraryItem) => {
    try {
      const updated = applyLibraryItemToProject(project, item);
      updateProject(() => updated);
      showAlert(t('assets.notice.imported', { name: item.name }), { type: 'success' });
    } catch (e: any) {
      showAlert(e?.message === 'Dự án chưa có nhân vật và bối cảnh nên chưa thể nhập tài nguyên.' ? t('assets.error.emptyProject') : e?.message || t('assets.error.import'), { type: 'error' });
    }
  };

  const handleReplaceCharacterFromLibrary = (item: AssetLibraryItem, targetId: string) => {
    if (item.type !== 'character') {
      showAlert(t('assets.notice.chooseCharacterAsset'), { type: 'warning' });
      return;
    }
    if (!project.scriptData) return;

    const newData = { ...project.scriptData };
    const index = newData.characters.findIndex((c) => compareIds(c.id, targetId));
    if (index === -1) return;

    const cloned = cloneCharacterForProject(item.data as Character);
    const previous = newData.characters[index];

    newData.characters[index] = {
      ...cloned,
      id: previous.id
    };

    const nextShots = project.shots.map((shot) => {
      if (!shot.characterVariations || !shot.characterVariations[targetId]) return shot;
      const { [targetId]: _removed, ...rest } = shot.characterVariations;
      return {
        ...shot,
        characterVariations: Object.keys(rest).length > 0 ? rest : undefined
      };
    });

    updateProject({ scriptData: newData, shots: nextShots });
    showAlert(t('assets.notice.characterReplaced', { previous: previous.name, next: cloned.name }), { type: 'success' });
    setShowLibraryModal(false);
    setReplaceTargetCharId(null);
  };

  const handleDeleteLibraryItem = async (itemId: string) => {
    try {
      await deleteAssetFromLibrary(itemId);
      setLibraryItems((prev) => prev.filter((item) => item.id !== itemId));
    } catch (e: any) {
      showAlert(e?.message || t('assets.error.libraryDelete'), { type: 'error' });
    }
  };

  const handleSaveCharacterPrompt = (charId: string, newPrompt: string) => {
    if (!project.scriptData) return;
    const newData = { ...project.scriptData };
    const char = newData.characters.find(c => compareIds(c.id, charId));
    if (char) {
      char.visualPrompt = newPrompt;
      updateProject({ scriptData: newData });
    }
  };

  const handleUpdateCharacterInfo = (charId: string, updates: { name?: string; gender?: string; age?: string; personality?: string }) => {
    if (!project.scriptData) return;
    const newData = { ...project.scriptData };
    const char = newData.characters.find(c => compareIds(c.id, charId));
    if (char) {
      if (updates.name !== undefined) char.name = updates.name;
      if (updates.gender !== undefined) char.gender = updates.gender;
      if (updates.age !== undefined) char.age = updates.age;
      if (updates.personality !== undefined) char.personality = updates.personality;
      updateProject({ scriptData: newData });
    }
  };

  const handleSaveScenePrompt = (sceneId: string, newPrompt: string) => {
    if (!project.scriptData) return;
    const newData = { ...project.scriptData };
    const scene = newData.scenes.find(s => compareIds(s.id, sceneId));
    if (scene) {
      scene.visualPrompt = newPrompt;
      updateProject({ scriptData: newData });
    }
  };

  const handleUpdateSceneInfo = (sceneId: string, updates: { location?: string; time?: string; atmosphere?: string }) => {
    if (!project.scriptData) return;
    const newData = { ...project.scriptData };
    const scene = newData.scenes.find(s => compareIds(s.id, sceneId));
    if (scene) {
      if (updates.location !== undefined) scene.location = updates.location;
      if (updates.time !== undefined) scene.time = updates.time;
      if (updates.atmosphere !== undefined) scene.atmosphere = updates.atmosphere;
      updateProject({ scriptData: newData });
    }
  };

  const handleAddCharacter = () => {
    if (!project.scriptData) return;
    
    const newChar: Character = {
      id: generateId('char'),
      name: 'Nhân vật mới',
      gender: 'Chưa xác định',
      age: 'Chưa xác định',
      personality: 'Cần bổ sung',
      visualPrompt: '',
      variations: [],
      status: 'pending'
    };

    const newData = { ...project.scriptData };
    newData.characters.push(newChar);
    updateProject({ scriptData: newData });
    showAlert(t('assets.notice.characterCreated'), { type: 'success' });
  };

  const handleDeleteCharacter = (charId: string) => {
    if (!project.scriptData) return;
    const char = project.scriptData.characters.find(c => compareIds(c.id, charId));
    if (!char) return;

    showAlert(
      t('assets.confirm.deleteCharacter', { name: char.name }),
      {
        type: 'warning',
        title: t('assets.confirm.deleteCharacterTitle'),
        showCancel: true,
        confirmText: t('assets.delete'),
        cancelText: t('common.cancel'),
        onConfirm: () => {
          const newData = { ...project.scriptData! };
          newData.characters = newData.characters.filter(c => !compareIds(c.id, charId));
          updateProject({ scriptData: newData });
          showAlert(t('assets.notice.characterDeleted', { name: char.name }), { type: 'success' });
        }
      }
    );
  };

  const handleAddScene = () => {
    if (!project.scriptData) return;
    
    const newScene: Scene = {
      id: generateId('scene'),
      location: 'Bối cảnh mới',
      time: 'Chưa xác định',
      atmosphere: 'Cần bổ sung',
      visualPrompt: '',
      status: 'pending'
    };

    const newData = { ...project.scriptData };
    newData.scenes.push(newScene);
    updateProject({ scriptData: newData });
    showAlert(t('assets.notice.sceneCreated'), { type: 'success' });
  };

  const handleDeleteScene = (sceneId: string) => {
    if (!project.scriptData) return;
    const scene = project.scriptData.scenes.find(s => compareIds(s.id, sceneId));
    if (!scene) return;

    showAlert(
      t('assets.confirm.deleteScene', { name: scene.location }),
      {
        type: 'warning',
        title: t('assets.confirm.deleteSceneTitle'),
        showCancel: true,
        confirmText: t('assets.delete'),
        cancelText: t('common.cancel'),
        onConfirm: () => {
          const newData = { ...project.scriptData! };
          newData.scenes = newData.scenes.filter(s => !compareIds(s.id, sceneId));
          updateProject({ scriptData: newData });
          showAlert(t('assets.notice.sceneDeleted', { name: scene.location }), { type: 'success' });
        }
      }
    );
  };

  const handleAddVariation = (charId: string, name: string, prompt: string) => {
    if (!project.scriptData) return;
    const newData = { ...project.scriptData };
    const char = newData.characters.find(c => compareIds(c.id, charId));
    if (!char) return;

    const newVar: CharacterVariation = {
      id: generateId('var'),
      name: name || "Trang phục mới",
      visualPrompt: prompt || char.visualPrompt || "",
      referenceImage: undefined
    };

    if (!char.variations) char.variations = [];
    char.variations.push(newVar);
    
    updateProject({ scriptData: newData });
  };

  const handleDeleteVariation = (charId: string, varId: string) => {
    if (!project.scriptData) return;
    const newData = { ...project.scriptData };
    const char = newData.characters.find(c => compareIds(c.id, charId));
    if (!char) return;
    
    char.variations = char.variations?.filter(v => !compareIds(v.id, varId));
    updateProject({ scriptData: newData });
  };

  const handleGenerateVariation = async (charId: string, varId: string) => {
    const char = project.scriptData?.characters.find(c => compareIds(c.id, charId));
    const variation = char?.variations?.find(v => compareIds(v.id, varId));
    if (!char || !variation) return;

    if (project.scriptData) {
      const newData = { ...project.scriptData };
      const c = newData.characters.find(c => compareIds(c.id, charId));
      const v = c?.variations?.find(v => compareIds(v.id, varId));
      if (v) v.status = 'generating';
      updateProject({ scriptData: newData });
    }
    try {
      const refImages = pickReferences(char).map((reference) => reference.imageUrl);
      const generation = resolveGenerationParams([char], selectedImageModelId, aspectRatio);
      const regionalPrefix = getRegionalPrefix(language, 'character');
      const enhancedPrompt = `${regionalPrefix}Nhân vật "${char.name}" mặc TRANG PHỤC MỚI: ${variation.visualPrompt}. Đây chỉ là thay đổi trang phục; khuôn mặt và danh tính nhân vật phải giống hệt ảnh tham chiếu, đồng thời mặc đúng bộ đồ được mô tả.`;
      
      await generateImage(
        enhancedPrompt,
        refImages,
        generation.aspectRatio || aspectRatio,
        true,
        generation.modelId,
        `asset:character:${charId}:variation:${varId}`,
        createProjectMediaExecutionContext({
          project,
          updateProject,
          kind: 'asset-image',
          stage: 'assets',
          label: t('assets.job.variation', { variation: variation.name || varId, character: char.name }),
          resourceId: `character:${charId}:variation:${varId}`,
          previousOutput: variation.referenceImage,
          commitResult: (previous, imageUrl) => {
            if (!previous.scriptData) return previous;
            const scriptData = {
              ...previous.scriptData,
              characters: previous.scriptData.characters.map((item) => compareIds(item.id, charId)
                ? {
                  ...item,
                  variations: item.variations?.map((candidate) => compareIds(candidate.id, varId)
                    ? { ...candidate, referenceImage: imageUrl, status: 'completed' as const }
                    : candidate),
                }
                : item),
            };
            return { ...previous, scriptData };
          },
        }),
      );
    } catch (e: any) {
      console.error(e);
      if (project.scriptData) {
        const newData = { ...project.scriptData };
        const c = newData.characters.find(c => compareIds(c.id, charId));
        const v = c?.variations?.find(v => compareIds(v.id, varId));
        if (v) v.status = 'failed';
        updateProject({ scriptData: newData });
      }
      if (onApiKeyError && onApiKeyError(e)) {
        return;
      }
      showAlert(t('assets.error.variation'), { type: 'error' });
    }
  };

  const handleUploadVariationImage = async (charId: string, varId: string, file: File) => {
    try {
      const base64 = await handleImageUpload(file);
      
      if (project.scriptData) {
        const newData = { ...project.scriptData };
        const char = newData.characters.find(c => compareIds(c.id, charId));
        const variation = char?.variations?.find(v => compareIds(v.id, varId));
        if (variation) {
          variation.referenceImage = base64;
        }
        updateProject({ scriptData: newData });
      }
    } catch (e: any) {
      showAlert(displayAssetError(e, t('assets.error.upload')), { type: 'error' });
    }
  };

  if (!project.scriptData) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-slate-950/35 text-slate-500 backdrop-blur-sm">
        <p>{t('assets.completeScriptFirst')}</p>
      </div>
    );
  }
  
  const allCharactersReady = project.scriptData.characters.every(c => c.referenceImage);
  const allScenesReady = project.scriptData.scenes.every(s => s.referenceImage);
  const selectedChar = project.scriptData.characters.find(c => compareIds(c.id, selectedCharId));
  const filteredLibraryItems = libraryItems.filter((item) => {
    if (libraryFilter !== 'all' && item.type !== libraryFilter) return false;
    if (!libraryQuery.trim()) return true;
    const query = libraryQuery.trim().toLowerCase();
    return item.name.toLowerCase().includes(query);
  });

  return (
    <div className={STYLES.mainContainer}>
      
      <ImagePreviewModal 
        imageUrl={previewImage} 
        onClose={() => setPreviewImage(null)} 
      />

      {batchProgress && (
        <div className="absolute inset-0 z-50 bg-black/80 flex flex-col items-center justify-center backdrop-blur-md animate-in fade-in">
          <Loader2 className="w-12 h-12 text-cyan-300 animate-spin mb-6" />
          <h3 className="text-xl font-bold text-white mb-2">{t('assets.batchGenerating')}</h3>
          <div className="w-64 h-1.5 bg-white/10 rounded-full overflow-hidden mb-2">
            <div 
              className="h-full bg-gradient-to-r from-cyan-300 to-sky-400 transition-all duration-300" 
              style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
            />
          </div>
          <p className="text-zinc-400 font-mono text-xs">
            {t('assets.progress', { current: batchProgress.current, total: batchProgress.total })}
          </p>
        </div>
      )}

      {selectedChar && (
        <WardrobeModal
          character={selectedChar}
          onClose={() => setSelectedCharId(null)}
          onAddVariation={handleAddVariation}
          onDeleteVariation={handleDeleteVariation}
          onGenerateVariation={handleGenerateVariation}
          onUploadVariation={handleUploadVariationImage}
          onImageClick={setPreviewImage}
        />
      )}

      {showLibraryModal && (
        <div className={STYLES.modalOverlay} onClick={() => {
          setShowLibraryModal(false);
          setReplaceTargetCharId(null);
        }}>
          <div role="dialog" aria-modal="true" aria-labelledby="asset-library-title" className={STYLES.modalContainer} onClick={(e) => e.stopPropagation()}>
            <div className={STYLES.modalHeader}>
              <div className="flex items-center gap-3">
                <Archive className="w-4 h-4 text-cyan-300" />
                <div>
                  <div id="asset-library-title" className="text-sm font-bold text-white">{t('assets.library')}</div>
                  <div className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">
                    {t('assets.libraryCount', { count: libraryItems.length })}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowLibraryModal(false);
                  setReplaceTargetCharId(null);
                }}
                className="h-11 w-11 inline-flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/10 rounded-xl"
                title={t('common.close')}
                aria-label={t('common.close')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className={STYLES.modalBody}>
              <div className="flex flex-wrap items-center gap-3 mb-6">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="w-4 h-4 text-zinc-600 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={libraryQuery}
                    onChange={(e) => setLibraryQuery(e.target.value)}
                    placeholder={t('assets.searchLibrary')}
                    className="w-full pl-9 pr-3 py-2 bg-white/[0.06] border border-white/10 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-300/40"
                  />
                </div>
                <div className="flex gap-2">
                  {(['all', 'character', 'scene'] as const).map((type) => (
                    <button
                      type="button"
                      key={type}
                      onClick={() => setLibraryFilter(type)}
                      className={`min-h-11 px-3 py-2 text-[10px] font-bold uppercase tracking-widest border rounded-xl ${
                        libraryFilter === type
                          ? 'bg-cyan-300 text-slate-950 border-cyan-300'
                          : 'bg-white/[0.04] text-slate-400 border-white/10 hover:text-white hover:border-cyan-300/30'
                      }`}
                    >
                      {t(type === 'all' ? 'assets.all' : type === 'character' ? 'assets.characters' : 'assets.scenes')}
                    </button>
                  ))}
                </div>
              </div>

              {libraryLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
                </div>
              ) : filteredLibraryItems.length === 0 ? (
                <div className="border border-dashed border-cyan-200/15 rounded-2xl p-10 text-center text-slate-500 text-sm">
                  {t('assets.libraryEmpty')}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredLibraryItems.map((item) => {
                    const preview =
                      item.type === 'character'
                        ? (item.data as Character).referenceImage
                        : (item.data as Scene).referenceImage;
                    return (
                      <div
                        key={item.id}
                        className="bg-white/[0.045] border border-white/10 rounded-2xl overflow-hidden hover:border-cyan-200/35 transition-colors backdrop-blur"
                      >
                        <div className="aspect-video bg-slate-950/70 relative">
                          {preview ? (
                            <img src={preview} alt={item.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-zinc-700">
                              {item.type === 'character' ? (
                                <Users className="w-8 h-8 opacity-30" />
                              ) : (
                                <MapPin className="w-8 h-8 opacity-30" />
                              )}
                            </div>
                          )}
                        </div>
                        <div className="p-4 space-y-3">
                          <div>
                            <div className="text-sm text-white font-bold line-clamp-1">{item.name}</div>
                            <div className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest mt-1">
                              {t(item.type === 'character' ? 'assets.character' : 'assets.scene')}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                replaceTargetCharId
                                  ? handleReplaceCharacterFromLibrary(item, replaceTargetCharId)
                                  : handleImportFromLibrary(item)
                              }
                              className="flex-1 min-h-11 py-2 bg-cyan-300 text-slate-950 hover:bg-cyan-200 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors"
                            >
                              {replaceTargetCharId ? t('assets.replaceCurrentCharacter') : t('assets.importToProject')}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                showAlert(t('assets.confirm.deleteLibraryItem'), {
                                  type: 'warning',
                                  showCancel: true,
                                  onConfirm: () => handleDeleteLibraryItem(item.id)
                                })
                              }
                              className="h-11 w-11 inline-flex items-center justify-center border border-white/10 text-slate-500 hover:text-red-300 hover:border-red-400/40 rounded-xl transition-colors"
                              title={t('assets.delete')}
                              aria-label={t('assets.delete')}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className={`${STYLES.header} flex-col xl:flex-row items-stretch xl:items-center gap-4`}>
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-3">
                  <Users className="w-5 h-5 text-cyan-300" />
            {t('assets.title')}
            <span className="text-xs text-cyan-100/40 font-mono font-normal uppercase tracking-wider bg-white/5 px-2 py-1 rounded-full">
              {t('assets.kicker')}
            </span>
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => openLibrary('all')}
            disabled={!!batchProgress}
            className={STYLES.secondaryButton}
          >
            <Archive className="w-4 h-4" />
            {t('assets.library')}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-500 uppercase">{t('assets.model')}</span>
            <ModelSelector
              type="image"
              value={selectedImageModelId}
              onChange={setSelectedImageModelId}
              disabled={!!batchProgress}
              compact
            />
          </div>
          <div className="w-px h-6 bg-white/10" />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-500 uppercase">{t('assets.aspectRatio')}</span>
            <AspectRatioSelector
              value={aspectRatio}
              onChange={setAspectRatio}
              allowSquare={(() => {
                const selectedModel = getModelById(selectedImageModelId) as ImageModelDefinition | undefined;
                return selectedModel?.params?.supportedAspectRatios?.includes('1:1') ?? false;
              })()}
              disabled={!!batchProgress}
            />
          </div>
          <div className="w-px h-6 bg-white/10" />
          <div className="flex gap-2">
            <span className={STYLES.badge}>
              {t('assets.characterCount', { count: project.scriptData.characters.length })}
            </span>
            <span className={STYLES.badge}>
              {t('assets.sceneCount', { count: project.scriptData.scenes.length })}
            </span>
          </div>
        </div>
      </div>

      <div className={STYLES.content}>
        <ConsistencyWorkbench project={project} onToggleBrandAsset={handleToggleBrandAsset} />

        <section>
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-6 border-b border-white/10 pb-4">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-cyan-300 rounded-full shadow-lg shadow-cyan-300/40" />
                {t('assets.characterIdeas')}
              </h3>
              <p className="text-xs text-zinc-500 mt-1 pl-3.5">{t('assets.characterIdeasDetail')}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button 
                type="button"
                onClick={handleAddCharacter}
                disabled={!!batchProgress}
                className="min-h-11 px-3 py-1.5 bg-white/[0.06] hover:bg-white/10 text-zinc-300 hover:text-white rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed border border-white/10"
              >
                <Users className="w-3 h-3" />
                {t('assets.createCharacter')}
              </button>
              <button 
                type="button"
                onClick={() => openLibrary('character')}
                disabled={!!batchProgress}
                className={STYLES.secondaryButton}
              >
                <Archive className="w-3 h-3" />
                {t('assets.chooseFromLibrary')}
              </button>
              <button 
                type="button"
                onClick={() => handleBatchGenerate('character')}
                disabled={!!batchProgress}
                className={allCharactersReady ? STYLES.secondaryButton : STYLES.primaryButton}
              >
                {allCharactersReady ? <RefreshCw className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                {allCharactersReady ? t('assets.regenerateAllCharacters') : t('assets.generateAllCharacters')}
              </button>
            </div>
          </div>

          <div className={GRID_LAYOUTS.cards}>
            {project.scriptData.characters.map((char) => (
              <CharacterCard
                key={char.id}
                character={char}
                isGenerating={char.status === 'generating'}
                onGenerate={() => handleGenerateAsset('character', char.id)}
                onUpload={(file) => handleUploadCharacterImage(char.id, file)}
                onPromptSave={(newPrompt) => handleSaveCharacterPrompt(char.id, newPrompt)}
                onOpenWardrobe={() => setSelectedCharId(char.id)}
                onImageClick={setPreviewImage}
                onDelete={() => handleDeleteCharacter(char.id)}
                onUpdateInfo={(updates) => handleUpdateCharacterInfo(char.id, updates)}
                onAddToLibrary={() => handleAddCharacterToLibrary(char)}
                onReplaceFromLibrary={() => openLibrary('character', char.id)}
                currentModelId={selectedImageModelId}
                currentAspectRatio={aspectRatio}
                onAddReference={(file, angle) => handleAddCharacterReference(char.id, file, angle)}
                onApproveReference={(referenceId) => handleApproveCharacterReference(char.id, referenceId)}
                onRemoveReference={(referenceId) => handleRemoveCharacterReference(char.id, referenceId)}
                onLockGeneration={() => handleLockCharacterGeneration(char.id)}
                onUnlockGeneration={() => handleUnlockCharacterGeneration(char.id)}
              />
            ))}
          </div>
        </section>

        <section>
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-6 border-b border-white/10 pb-4">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                {t('assets.sceneIdeas')}
              </h3>
              <p className="text-xs text-zinc-500 mt-1 pl-3.5">{t('assets.sceneIdeasDetail')}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button 
                type="button"
                onClick={handleAddScene}
                disabled={!!batchProgress}
                className="min-h-11 px-3 py-1.5 bg-white/[0.06] hover:bg-white/10 text-zinc-300 hover:text-white rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed border border-white/10"
              >
                <MapPin className="w-3 h-3" />
                {t('assets.createScene')}
              </button>
              <button 
                type="button"
                onClick={() => openLibrary('scene')}
                disabled={!!batchProgress}
                className={STYLES.secondaryButton}
              >
                <Archive className="w-3 h-3" />
                {t('assets.chooseFromLibrary')}
              </button>
              <button 
                type="button"
                onClick={() => handleBatchGenerate('scene')}
                disabled={!!batchProgress}
                className={allScenesReady ? STYLES.secondaryButton : STYLES.primaryButton}
              >
                {allScenesReady ? <RefreshCw className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                {allScenesReady ? t('assets.regenerateAllScenes') : t('assets.generateAllScenes')}
              </button>
            </div>
          </div>

          <div className={GRID_LAYOUTS.cards}>
            {project.scriptData.scenes.map((scene) => (
              <SceneCard
                key={scene.id}
                scene={scene}
                isGenerating={scene.status === 'generating'}
                onGenerate={() => handleGenerateAsset('scene', scene.id)}
                onUpload={(file) => handleUploadSceneImage(scene.id, file)}
                onPromptSave={(newPrompt) => handleSaveScenePrompt(scene.id, newPrompt)}
                onImageClick={setPreviewImage}
                onDelete={() => handleDeleteScene(scene.id)}
                onUpdateInfo={(updates) => handleUpdateSceneInfo(scene.id, updates)}
                onAddToLibrary={() => handleAddSceneToLibrary(scene)}
                currentModelId={selectedImageModelId}
                currentAspectRatio={aspectRatio}
                onLockGeneration={() => updateSceneLock(scene.id, true)}
                onUnlockGeneration={() => updateSceneLock(scene.id, false)}
              />
            ))}
          </div>
        </section>
      </div>

    </div>
  );
};

export default StageAssets;
