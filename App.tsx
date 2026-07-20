// Phiên bản thương hiệu Egoric Agency
import React, { useState, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import Onboarding, { shouldShowOnboarding, resetOnboarding } from './components/Onboarding';
import ModelConfigModal from './components/ModelConfig';
import { CoreStage, ProjectStage, ProjectState } from './types';
import { Save, CheckCircle, Gauge } from 'lucide-react';
import { saveProjectToDB } from './services/storageService';
import { setLogCallback, clearLogCallback } from './services/renderLogService';
import { getWorkflowReadiness, normalizeWorkflowState } from './services/workflowService';

const StageScript = React.lazy(() => import('./components/StageScript'));
const StageAssets = React.lazy(() => import('./components/StageAssets'));
const StageVoice = React.lazy(() => import('./components/StageVoice'));
const StageDirector = React.lazy(() => import('./components/StageDirector'));
const StageExport = React.lazy(() => import('./components/StageExport'));
const StagePrompts = React.lazy(() => import('./components/StagePrompts'));
const ProductionCenter = React.lazy(() => import('./components/ProductionCenter'));

const WorkspaceLoader = () => (
  <div className="flex h-full items-center justify-center text-xs text-zinc-600">
    <span className="mr-3 h-4 w-4 animate-spin rounded-full border-2 border-cyan-200/20 border-t-cyan-200" />
    Đang mở không gian làm việc…
  </div>
);

function App() {
  const [project, setProject] = useState<ProjectState | null>(null);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [showSaveStatus, setShowSaveStatus] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showModelConfig, setShowModelConfig] = useState(false);
  const [showProductionCenter, setShowProductionCenter] = useState(false);
  
  const saveTimeoutRef = useRef<any>(null);
  const hideStatusTimeoutRef = useRef<any>(null);

  useEffect(() => {
    if (shouldShowOnboarding()) {
      setShowOnboarding(true);
    }
  }, []);

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
  };

  const handleOnboardingQuickStart = (_option: 'script' | 'example') => {
    setShowOnboarding(false);
  };

  const handleShowOnboarding = () => {
    resetOnboarding();
    setShowOnboarding(true);
  };

  const handleShowModelConfig = () => {
    setShowModelConfig(true);
  };

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      if (event.error?.name === 'ApiKeyError' || 
          event.error?.message?.includes('API Key missing') ||
          event.error?.message?.includes('Thiếu khóa API')) {
        console.warn('Phát hiện lỗi khóa API. Vui lòng cấu hình lại khóa API...');
        setShowModelConfig(true);
        event.preventDefault();
      }
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (event.reason?.name === 'ApiKeyError' ||
          event.reason?.message?.includes('API Key missing') ||
          event.reason?.message?.includes('Thiếu khóa API')) {
        console.warn('Phát hiện lỗi khóa API. Vui lòng cấu hình lại khóa API...');
        setShowModelConfig(true);
        event.preventDefault();
      }
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    if (project) {
      setLogCallback((log) => {
        setProject(prev => {
          if (!prev) return null;
          return {
            ...prev,
            renderLogs: [...(prev.renderLogs || []), log]
          };
        });
      });
    } else {
      clearLogCallback();
    }
    
    return () => clearLogCallback();
  }, [project?.id]);

  useEffect(() => {
    if (!project) return;

    setSaveStatus('unsaved');
    setShowSaveStatus(true);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    saveTimeoutRef.current = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        await saveProjectToDB(project);
        setSaveStatus('saved');
      } catch (e) {
        console.error('Tự động lưu thất bại', e);
      }
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [project]);

  useEffect(() => {
    if (saveStatus === 'saved') {
      if (hideStatusTimeoutRef.current) clearTimeout(hideStatusTimeoutRef.current);
      hideStatusTimeoutRef.current = setTimeout(() => {
        setShowSaveStatus(false);
      }, 2000);
    } else if (saveStatus === 'saving') {
      setShowSaveStatus(true);
      if (hideStatusTimeoutRef.current) clearTimeout(hideStatusTimeoutRef.current);
    }

    return () => {
      if (hideStatusTimeoutRef.current) clearTimeout(hideStatusTimeoutRef.current);
    };
  }, [saveStatus]);


  const updateProject = (updates: Partial<ProjectState> | ((prev: ProjectState) => ProjectState)) => {
    if (!project) return;
    setProject(prev => {
      if (!prev) return null;
      if (typeof updates === 'function') {
        return updates(prev);
      }
      return { ...prev, ...updates };
    });
  };

  const setStage = (stage: ProjectStage) => {
    updateProject({ stage });
  };

  const handleOpenProject = (proj: ProjectState) => {
    setProject(normalizeWorkflowState(proj));
  };

  const handleExitProject = async () => {
    if (project) {
        await saveProjectToDB(project);
    }
    setShowProductionCenter(false);
    setProject(null);
  };

  const renderStage = () => {
    if (!project) return null;
    switch (project.stage) {
      case 'script':
        return <StageScript project={project} updateProject={updateProject} />;
      case 'assets':
        return <StageAssets project={project} updateProject={updateProject} />;
      case 'voice':
        return <StageVoice project={project} updateProject={updateProject} />;
      case 'director':
        return <StageDirector project={project} updateProject={updateProject} />;
      case 'export':
        return <StageExport project={project} />;
      case 'prompts':
        return <StagePrompts project={project} updateProject={updateProject} />;
      default:
        return <div className="text-white">Giai đoạn không xác định</div>;
    }
  };

  if (!project) {
    return (
       <>
         <Dashboard 
           onOpenProject={handleOpenProject} 
           onShowOnboarding={handleShowOnboarding}
           onShowModelConfig={handleShowModelConfig}
         />
         {showOnboarding && (
           <Onboarding 
             onComplete={handleOnboardingComplete}
             onQuickStart={handleOnboardingQuickStart}
           />
         )}
         <ModelConfigModal
           isOpen={showModelConfig}
           onClose={() => setShowModelConfig(false)}
         />
       </>
    );
  }

  const readiness = getWorkflowReadiness(project);
  const stageStatuses = Object.fromEntries(
    readiness.stages.map((stage) => [stage.id, stage.status]),
  ) as Partial<Record<CoreStage, 'ready' | 'attention' | 'blocked'>>;
  const activeJobCount = (project.workflow?.jobs || []).filter((job) => ['queued', 'running'].includes(job.status)).length;

  return (
    <div className="eg-app-shell flex h-[100dvh] font-sans text-slate-100">
      <Sidebar 
        currentStage={project.stage} 
        setStage={setStage} 
        onExit={handleExitProject} 
        projectName={project.title}
        onShowOnboarding={handleShowOnboarding}
        onShowModelConfig={() => setShowModelConfig(true)}
        workflowProgress={readiness.overallPercent}
        stageStatuses={stageStatuses}
        activeJobCount={activeJobCount}
        onOpenProductionCenter={() => setShowProductionCenter(true)}
      />
      
      <main className="eg-stage-main flex-1">
        <React.Suspense fallback={<WorkspaceLoader />}>{renderStage()}</React.Suspense>

        <button
          type="button"
          onClick={() => setShowProductionCenter(true)}
          className="eg-mobile-production-button"
          aria-label="Mở Trung tâm sản xuất"
        >
          <Gauge className="h-4 w-4" />
          <span>{readiness.overallPercent}%</span>
          {activeJobCount > 0 && <span className="eg-mobile-production-count">{activeJobCount}</span>}
        </button>
        
        {showSaveStatus && (
          <div className="pointer-events-none absolute right-5 top-4 z-[90] flex min-h-9 items-center gap-2 rounded-full border border-white/10 bg-black/70 px-3 font-mono text-[10px] text-zinc-300 shadow-xl backdrop-blur-xl animate-in fade-in slide-in-from-top-2 duration-200">
             {saveStatus === 'saving' ? (
               <>
                 <Save className="w-3 h-3 animate-pulse" />
                 Đang lưu...
               </>
             ) : (
               <>
                 <CheckCircle className="w-3 h-3 text-emerald-400" />
                 Đã lưu
               </>
             )}
          </div>
        )}
      </main>

      {showOnboarding && (
        <Onboarding 
          onComplete={handleOnboardingComplete}
          onQuickStart={handleOnboardingQuickStart}
        />
      )}

      <ModelConfigModal
        isOpen={showModelConfig}
        onClose={() => setShowModelConfig(false)}
      />

      {showProductionCenter && (
        <React.Suspense fallback={<div className="fixed inset-0 z-[120] bg-[var(--eg-canvas)]"><WorkspaceLoader /></div>}>
          <ProductionCenter
            project={project}
            updateProject={updateProject}
            setStage={(stage: CoreStage) => setStage(stage)}
            onClose={() => setShowProductionCenter(false)}
            onShowModelConfig={() => {
              setShowProductionCenter(false);
              setShowModelConfig(true);
            }}
          />
        </React.Suspense>
      )}
    </div>
  );
}

export default App;
