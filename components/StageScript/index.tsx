import React, { useState, useEffect } from 'react';
import { ProjectState } from '../../types';
import { parseScriptToData, generateShotList, continueScript, continueScriptStream, rewriteScript, rewriteScriptStream } from '../../services/geminiService';
import { getFinalValue, validateConfig } from './utils';
import { DEFAULTS } from './constants';
import { migrateDeprecatedChatModelId } from '../../types/model';
import ConfigPanel from './ConfigPanel';
import ScriptEditor from './ScriptEditor';
import SceneBreakdown from './SceneBreakdown';
import {
  addProductionJob,
  createProductionJob,
  createProjectCheckpoint,
  markShotWorkflowStale,
  patchProductionJob,
  setProductionJobStatus,
} from '../../services/workflowService';

interface Props {
  project: ProjectState;
  updateProject: (updates: Partial<ProjectState> | ((prev: ProjectState) => ProjectState)) => void;
}

type TabMode = 'story' | 'script';

const StageScript: React.FC<Props> = ({ project, updateProject }) => {
  const [activeTab, setActiveTab] = useState<TabMode>(project.scriptData ? 'script' : 'story');
  
  const [localScript, setLocalScript] = useState(project.rawScript);
  const [localTitle, setLocalTitle] = useState(project.title);
  const [localDuration, setLocalDuration] = useState(project.targetDuration || DEFAULTS.duration);
  const [localLanguage, setLocalLanguage] = useState(project.language || DEFAULTS.language);
  const [localModel, setLocalModel] = useState(
    migrateDeprecatedChatModelId(project.shotGenerationModel || DEFAULTS.model)
  );
  const [localVisualStyle, setLocalVisualStyle] = useState(project.visualStyle || DEFAULTS.visualStyle);
  const [customDurationInput, setCustomDurationInput] = useState('');
  const [customModelInput, setCustomModelInput] = useState('');
  const [customStyleInput, setCustomStyleInput] = useState('');
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [isContinuing, setIsContinuing] = useState(false);
  const [isRewriting, setIsRewriting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingCharacterId, setEditingCharacterId] = useState<string | null>(null);
  const [editingCharacterPrompt, setEditingCharacterPrompt] = useState('');
  const [editingShotId, setEditingShotId] = useState<string | null>(null);
  const [editingShotPrompt, setEditingShotPrompt] = useState('');
  const [editingShotCharactersId, setEditingShotCharactersId] = useState<string | null>(null);
  const [editingShotActionId, setEditingShotActionId] = useState<string | null>(null);
  const [editingShotActionText, setEditingShotActionText] = useState('');
  const [editingShotDialogueText, setEditingShotDialogueText] = useState('');

  useEffect(() => {
    setLocalScript(project.rawScript);
    setLocalTitle(project.title);
    setLocalDuration(project.targetDuration || DEFAULTS.duration);
    setLocalLanguage(project.language || DEFAULTS.language);
    setLocalModel(migrateDeprecatedChatModelId(project.shotGenerationModel || DEFAULTS.model));
    setLocalVisualStyle(project.visualStyle || DEFAULTS.visualStyle);
  }, [project.id]);

  const handleAnalyze = async () => {
    const finalDuration = getFinalValue(localDuration, customDurationInput);
    const finalModel = migrateDeprecatedChatModelId(getFinalValue(localModel, customModelInput));
    const finalVisualStyle = getFinalValue(localVisualStyle, customStyleInput);

    const validation = validateConfig({
      script: localScript,
      duration: finalDuration,
      model: finalModel,
      visualStyle: finalVisualStyle
    });

    if (!validation.valid) {
      setError(validation.error);
      return;
    }

    setIsProcessing(true);
    setError(null);
    const job = createProductionJob({
      kind: 'script-analysis',
      stage: 'script',
      label: project.scriptData ? 'Phân tích lại kịch bản' : 'Phân tích kịch bản',
      totalUnits: 2,
      detail: 'Tách dữ liệu sản xuất và dựng danh sách cảnh quay.',
    });
    try {
      updateProject((previous) => {
        const protectedProject = previous.scriptData || previous.shots.length
          ? createProjectCheckpoint(previous, 'Trước khi phân tích lại kịch bản')
          : previous;
        const running = setProductionJobStatus(addProductionJob(protectedProject, job), job.id, 'running');
        return {
          ...running,
          title: localTitle,
          rawScript: localScript,
          targetDuration: finalDuration,
          language: localLanguage,
          visualStyle: finalVisualStyle,
          shotGenerationModel: finalModel,
          isParsingScript: true,
        };
      });

      const scriptData = await parseScriptToData(localScript, localLanguage, finalModel, finalVisualStyle);
      updateProject((previous) => patchProductionJob(previous, job.id, {
        progress: 50,
        completedUnits: 1,
        detail: 'Đã tách cấu trúc. Đang dựng danh sách cảnh quay…',
      }));
      
      scriptData.targetDuration = finalDuration;
      scriptData.language = localLanguage;
      scriptData.visualStyle = finalVisualStyle;
      scriptData.shotGenerationModel = finalModel;

      if (localTitle && localTitle !== "Dự án chưa đặt tên") {
        scriptData.title = localTitle;
      }

      const shots = await generateShotList(scriptData, finalModel);

      updateProject((previous) => setProductionJobStatus({
        ...previous,
        scriptData,
        shots,
        isParsingScript: false,
        title: scriptData.title,
      }, job.id, 'completed'));
      
      setActiveTab('script');

    } catch (err: any) {
      console.error(err);
      setError(`Lỗi: ${err.message || "Không thể kết nối AI"}`);
      updateProject((previous) => setProductionJobStatus({ ...previous, isParsingScript: false }, job.id, 'failed', err.message || 'Không thể kết nối AI'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleContinueScript = async () => {
    const finalModel = migrateDeprecatedChatModelId(getFinalValue(localModel, customModelInput));
    
    if (!localScript.trim()) {
      setError("Hãy nhập nội dung kịch bản làm cơ sở trước.");
      return;
    }
    if (!finalModel) {
      setError('Hãy chọn hoặc nhập tên mô hình.');
      return;
    }

    setIsContinuing(true);
    setError(null);
    const baseScript = localScript;
    let streamed = '';
    try {
      const continuedContent = await continueScriptStream(
        baseScript,
        localLanguage,
        finalModel,
        (delta) => {
          streamed += delta;
          const newScript = baseScript + '\n\n' + streamed;
          setLocalScript(newScript);
          updateProject({ rawScript: newScript });
        }
      );
      if (continuedContent) {
        const newScript = baseScript + '\n\n' + continuedContent;
        setLocalScript(newScript);
        updateProject({ rawScript: newScript });
      }
    } catch (err: any) {
      console.error(err);
      setError(`AI không thể viết tiếp: ${err.message || "Lỗi kết nối"}`);
      try {
        const continuedContent = await continueScript(baseScript, localLanguage, finalModel);
        const newScript = baseScript + '\n\n' + continuedContent;
        setLocalScript(newScript);
        updateProject({ rawScript: newScript });
      } catch (fallbackErr: any) {
        console.error(fallbackErr);
      }
    } finally {
      setIsContinuing(false);
    }
  };

  const handleRewriteScript = async () => {
    const finalModel = migrateDeprecatedChatModelId(getFinalValue(localModel, customModelInput));
    
    if (!localScript.trim()) {
      setError("Hãy nhập nội dung kịch bản trước.");
      return;
    }
    if (!finalModel) {
      setError('Hãy chọn hoặc nhập tên mô hình.');
      return;
    }

    setIsRewriting(true);
    setError(null);
    const baseScript = localScript;
    let streamed = '';
    try {
      setLocalScript('');
      updateProject({ rawScript: '' });
      const rewrittenContent = await rewriteScriptStream(
        baseScript,
        localLanguage,
        finalModel,
        (delta) => {
          streamed += delta;
          setLocalScript(streamed);
          updateProject({ rawScript: streamed });
        }
      );
      if (rewrittenContent) {
        setLocalScript(rewrittenContent);
        updateProject({ rawScript: rewrittenContent });
      }
    } catch (err: any) {
      console.error(err);
      setError(`AI không thể viết lại: ${err.message || "Lỗi kết nối"}`);
      try {
        const rewrittenContent = await rewriteScript(baseScript, localLanguage, finalModel);
        setLocalScript(rewrittenContent);
        updateProject({ rawScript: rewrittenContent });
      } catch (fallbackErr: any) {
        console.error(fallbackErr);
      }
    } finally {
      setIsRewriting(false);
    }
  };

  const handleEditCharacter = (charId: string, prompt: string) => {
    setEditingCharacterId(charId);
    setEditingCharacterPrompt(prompt);
  };

  const handleSaveCharacter = (charId: string, prompt: string) => {
    if (!project.scriptData) return;
    
    const updatedCharacters = project.scriptData.characters.map(c => 
      c.id === charId ? { ...c, visualPrompt: prompt } : c
    );
    
    updateProject((previous) => ({
      ...previous,
      scriptData: previous.scriptData ? { ...previous.scriptData, characters: updatedCharacters } : previous.scriptData,
      shots: previous.shots.map((shot) => shot.characters.includes(charId) ? markShotWorkflowStale(shot, 'visual') : shot),
    }));
    
    setEditingCharacterId(null);
    setEditingCharacterPrompt('');
  };

  const handleCancelCharacterEdit = () => {
    setEditingCharacterId(null);
    setEditingCharacterPrompt('');
  };

  const handleEditShotPrompt = (shotId: string, prompt: string) => {
    setEditingShotId(shotId);
    setEditingShotPrompt(prompt);
  };

  const handleSaveShotPrompt = () => {
    if (!editingShotId) return;
    
    const updatedShots = project.shots.map(shot => {
      if (shot.id === editingShotId && shot.keyframes.length > 0) {
        return markShotWorkflowStale({
          ...shot,
          keyframes: shot.keyframes.map((kf, idx) => 
            idx === 0 ? { ...kf, visualPrompt: editingShotPrompt } : kf
          )
        }, 'visual');
      }
      return shot;
    });
    
    updateProject({ shots: updatedShots });
    setEditingShotId(null);
    setEditingShotPrompt('');
  };

  const handleCancelShotPrompt = () => {
    setEditingShotId(null);
    setEditingShotPrompt('');
  };

  const handleEditShotCharacters = (shotId: string) => {
    setEditingShotCharactersId(shotId);
  };

  const handleAddCharacterToShot = (shotId: string, characterId: string) => {
    const updatedShots = project.shots.map(shot => {
      if (shot.id === shotId && !shot.characters.includes(characterId)) {
        return markShotWorkflowStale({ ...shot, characters: [...shot.characters, characterId] }, 'casting');
      }
      return shot;
    });
    updateProject({ shots: updatedShots });
  };

  const handleRemoveCharacterFromShot = (shotId: string, characterId: string) => {
    const updatedShots = project.shots.map(shot => {
      if (shot.id === shotId) {
        return markShotWorkflowStale({ ...shot, characters: shot.characters.filter(cid => cid !== characterId) }, 'casting');
      }
      return shot;
    });
    updateProject({ shots: updatedShots });
  };

  const handleCloseShotCharactersEdit = () => {
    setEditingShotCharactersId(null);
  };

  const handleEditShotAction = (shotId: string, action: string, dialogue: string) => {
    setEditingShotActionId(shotId);
    setEditingShotActionText(action);
    setEditingShotDialogueText(dialogue);
  };

  const handleSaveShotAction = () => {
    if (!editingShotActionId) return;
    
    const updatedShots = project.shots.map(shot => {
      if (shot.id === editingShotActionId) {
        let updatedShot = {
          ...shot,
          actionSummary: editingShotActionText,
          dialogue: editingShotDialogueText.trim() || undefined
        };
        if (shot.actionSummary !== editingShotActionText) updatedShot = markShotWorkflowStale(updatedShot, 'visual');
        if ((shot.dialogue || '') !== editingShotDialogueText.trim()) updatedShot = markShotWorkflowStale(updatedShot, 'dialogue');
        return updatedShot;
      }
      return shot;
    });
    
    updateProject({ shots: updatedShots });
    setEditingShotActionId(null);
    setEditingShotActionText('');
    setEditingShotDialogueText('');
  };

  const handleCancelShotAction = () => {
    setEditingShotActionId(null);
    setEditingShotActionText('');
    setEditingShotDialogueText('');
  };

  return (
    <div className="h-full bg-transparent relative z-10">
      {activeTab === 'story' ? (
        <div className="flex h-full bg-slate-950/35 text-slate-200 backdrop-blur-sm">
          <ConfigPanel
            title={localTitle}
            duration={localDuration}
            language={localLanguage}
            model={localModel}
            visualStyle={localVisualStyle}
            customDurationInput={customDurationInput}
            customModelInput={customModelInput}
            customStyleInput={customStyleInput}
            isProcessing={isProcessing}
            error={error}
            onTitleChange={setLocalTitle}
            onDurationChange={setLocalDuration}
            onLanguageChange={setLocalLanguage}
            onModelChange={setLocalModel}
            onVisualStyleChange={setLocalVisualStyle}
            onCustomDurationChange={setCustomDurationInput}
            onCustomModelChange={setCustomModelInput}
            onCustomStyleChange={setCustomStyleInput}
            onAnalyze={handleAnalyze}
          />
          <ScriptEditor
            script={localScript}
            onChange={setLocalScript}
            onContinue={handleContinueScript}
            onRewrite={handleRewriteScript}
            isContinuing={isContinuing}
            isRewriting={isRewriting}
            lastModified={project.lastModified}
          />
        </div>
      ) : (
        <SceneBreakdown
          project={project}
          editingCharacterId={editingCharacterId}
          editingCharacterPrompt={editingCharacterPrompt}
          editingShotId={editingShotId}
          editingShotPrompt={editingShotPrompt}
          editingShotCharactersId={editingShotCharactersId}
          editingShotActionId={editingShotActionId}
          editingShotActionText={editingShotActionText}
          editingShotDialogueText={editingShotDialogueText}
          onEditCharacter={handleEditCharacter}
          onSaveCharacter={handleSaveCharacter}
          onCancelCharacterEdit={handleCancelCharacterEdit}
          onEditShotPrompt={handleEditShotPrompt}
          onSaveShotPrompt={handleSaveShotPrompt}
          onCancelShotPrompt={handleCancelShotPrompt}
          onEditShotCharacters={handleEditShotCharacters}
          onAddCharacterToShot={handleAddCharacterToShot}
          onRemoveCharacterFromShot={handleRemoveCharacterFromShot}
          onCloseShotCharactersEdit={handleCloseShotCharactersEdit}
          onEditShotAction={handleEditShotAction}
          onSaveShotAction={handleSaveShotAction}
          onCancelShotAction={handleCancelShotAction}
          onBackToStory={() => setActiveTab('story')}
        />
      )}
    </div>
  );
};

export default StageScript;
