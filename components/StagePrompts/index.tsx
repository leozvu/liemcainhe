// Author: forsearch | Updated: 2026-04-30
import React, { useState } from 'react';
import { Search, Film } from 'lucide-react';
import { ProjectState } from '../../types';
import { PromptCategory, EditingPrompt } from './constants';
import { 
  savePromptEdit, 
  filterCharacters, 
  filterScenes, 
  filterShots 
} from './utils';
import CharacterSection from './CharacterSection';
import SceneSection from './SceneSection';
import KeyframeSection from './KeyframeSection';

interface Props {
  project: ProjectState;
  updateProject: (updates: Partial<ProjectState> | ((prev: ProjectState) => ProjectState)) => void;
}

const StagePrompts: React.FC<Props> = ({ project, updateProject }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [category, setCategory] = useState<PromptCategory>('all');
  const [editingPrompt, setEditingPrompt] = useState<EditingPrompt>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['characters', 'scenes', 'shots'])
  );

  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  const handleStartEdit = (
    type: 'character' | 'character-variation' | 'scene' | 'keyframe' | 'video',
    id: string,
    currentValue: string,
    variationId?: string,
    shotId?: string
  ) => {
    setEditingPrompt({ type, id, value: currentValue, variationId, shotId });
  };

  const handleSaveEdit = () => {
    if (!editingPrompt) return;

    updateProject((prev: ProjectState) => savePromptEdit(prev, editingPrompt));
    setEditingPrompt(null);
  };

  const handleCancelEdit = () => {
    setEditingPrompt(null);
  };

  const handlePromptChange = (value: string) => {
    if (editingPrompt) {
      setEditingPrompt({ ...editingPrompt, value });
    }
  };

  const filteredCharacters = category === 'all' || category === 'characters'
    ? filterCharacters(project.scriptData?.characters || [], searchQuery)
    : [];

  const filteredScenes = category === 'all' || category === 'scenes'
    ? filterScenes(project.scriptData?.scenes || [], searchQuery)
    : [];

  const filteredShots = category === 'all' || category === 'keyframes'
    ? filterShots(project.shots || [], searchQuery)
    : [];

  const hasNoData = !project.scriptData && !project.shots.length;

  return (
    <div className="h-screen bg-slate-950/35 flex flex-col backdrop-blur-sm">
      <div className="border-b border-white/10 bg-slate-950/55 backdrop-blur-xl sticky top-0 z-10">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-white mb-1">Quản lý tài nguyên</h1>
              <p className="text-sm text-slate-400">Xem và chỉnh sửa prompt, biến số của mọi tác vụ tạo nội dung</p>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-100/45" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm prompt, nhân vật, bối cảnh..."
                className="w-full bg-white/[0.06] border border-white/10 text-white pl-10 pr-4 py-2 rounded-xl text-sm focus:border-cyan-300/40 focus:outline-none placeholder:text-slate-500"
              />
            </div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as PromptCategory)}
              className="bg-white/[0.06] border border-white/10 text-white px-4 py-2 rounded-xl text-sm focus:border-cyan-300/40 focus:outline-none"
            >
              <option value="all">Tất cả</option>
              <option value="characters">Nhân vật</option>
              <option value="scenes">Bối cảnh</option>
              <option value="keyframes">Keyframe</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-6xl mx-auto">
          {project.scriptData && (
            <>
              <CharacterSection
                characters={filteredCharacters}
                isExpanded={expandedSections.has('characters')}
                onToggle={() => toggleSection('characters')}
                editingPrompt={editingPrompt}
                onStartEdit={handleStartEdit}
                onSaveEdit={handleSaveEdit}
                onCancelEdit={handleCancelEdit}
                onPromptChange={handlePromptChange}
              />

              <SceneSection
                scenes={filteredScenes}
                isExpanded={expandedSections.has('scenes')}
                onToggle={() => toggleSection('scenes')}
                editingPrompt={editingPrompt}
                onStartEdit={handleStartEdit}
                onSaveEdit={handleSaveEdit}
                onCancelEdit={handleCancelEdit}
                onPromptChange={handlePromptChange}
              />
            </>
          )}

          {project.shots.length > 0 && (
            <KeyframeSection
              shots={filteredShots}
              scriptData={project.scriptData}
              isExpanded={expandedSections.has('shots')}
              onToggle={() => toggleSection('shots')}
              editingPrompt={editingPrompt}
              onStartEdit={handleStartEdit}
              onSaveEdit={handleSaveEdit}
              onCancelEdit={handleCancelEdit}
              onPromptChange={handlePromptChange}
            />
          )}

          {hasNoData && (
            <div className="text-center py-16">
              <div className="text-zinc-600 mb-4">
                <Film className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p className="text-lg">Chưa có dữ liệu prompt</p>
                <p className="text-sm mt-2">Hãy tạo nhân vật và bối cảnh ở Giai đoạn 01, hoặc tạo storyboard trong Xưởng AI.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StagePrompts;
