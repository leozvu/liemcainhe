import { CreativeDirectorState } from '../types';

const WELCOME_MESSAGE = `Tôi là Đạo diễn AI của Egoric. Tôi có thể đọc toàn bộ dự án, phản biện kịch bản, thiết kế storyboard, moodboard và kế hoạch dựng. Mọi thay đổi vào dự án đều được hiển thị để bạn duyệt trước.`;

export const createDefaultCreativeDirectorState = (): CreativeDirectorState => ({
  mode: 'copilot',
  budgetLimitUsd: 2,
  messages: [
    {
      id: 'director_welcome',
      role: 'assistant',
      content: WELCOME_MESSAGE,
      createdAt: Date.now(),
    },
  ],
  proposals: [],
  runs: [],
  missions: [],
  plan: [],
  memory: [],
});

export const normalizeCreativeDirectorState = (
  state?: Partial<CreativeDirectorState>,
): CreativeDirectorState => {
  const fallback = createDefaultCreativeDirectorState();
  return {
    ...fallback,
    ...state,
    mode: ['advisory', 'copilot', 'autopilot'].includes(state?.mode || '')
      ? state!.mode!
      : fallback.mode,
    budgetLimitUsd: Number.isFinite(Number(state?.budgetLimitUsd))
      ? Math.max(0, Number(state?.budgetLimitUsd))
      : fallback.budgetLimitUsd,
    messages: Array.isArray(state?.messages) && state.messages.length
      ? state.messages.slice(-100)
      : fallback.messages,
    proposals: Array.isArray(state?.proposals) ? state.proposals.slice(0, 50) : [],
    runs: Array.isArray(state?.runs) ? state.runs.slice(0, 50) : [],
    missions: Array.isArray(state?.missions) ? state.missions.slice(0, 20).map((mission) => ({
      ...mission,
      actions: Array.isArray(mission.actions) ? mission.actions : [],
    })) : [],
    plan: Array.isArray(state?.plan) ? state.plan.slice(0, 20) : [],
    memory: Array.isArray(state?.memory) ? state.memory.slice(-40) : [],
  };
};
