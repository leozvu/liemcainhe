import { describe, expect, it } from 'vitest';
import { buildElevenLabsRequestBody, parseElevenLabsVoiceCatalog } from '../services/voiceService';
import { VOICE_PROVIDERS } from '../services/voiceRegistry';
import { createNewProjectState } from '../services/storageService';
import { normalizeWorkflowState } from '../services/workflowService';

describe('ElevenLabs voice integration', () => {
  it('dùng payload Eleven v3 tương thích tiếng Việt, không gửi speed/style', () => {
    const payload = buildElevenLabsRequestBody({ text: 'Xin chào Việt Nam', emotion: 'dramatic' });
    expect(payload.model_id).toBe('eleven_v3');
    expect(payload.language_code).toBe('vi');
    expect(payload.voice_settings).not.toHaveProperty('speed');
    expect(payload.voice_settings).not.toHaveProperty('style');
  });

  it('chuẩn hóa thư viện My Voices thành danh sách chọn', () => {
    const voices = parseElevenLabsVoiceCatalog({
      voices: [
        { voice_id: 'voice_b', name: 'Bình', labels: { accent: 'Vietnamese', gender: 'male' } },
        { voice_id: 'voice_a', name: 'An', preview_url: 'https://example.com/an.mp3' },
        { name: 'Thiếu ID' },
      ],
    });
    expect(voices).toHaveLength(2);
    expect(voices[0]).toMatchObject({ id: 'voice_a', name: 'An' });
    expect(voices[1]).toMatchObject({ id: 'voice_b', accent: 'Vietnamese', gender: 'male' });
  });

  it('chỉ hiển thị ElevenLabs/người thật và chuyển hồ sơ FPT cũ sang ElevenLabs', () => {
    expect(VOICE_PROVIDERS.map((provider) => provider.id)).toEqual(['elevenlabs', 'human']);
    const project = createNewProjectState();
    project.voiceStudio = {
      ...project.voiceStudio!,
      defaultProviderId: 'fpt',
      profiles: [{
        id: 'voice_profile_actor',
        characterId: 'actor',
        providerId: 'fpt',
        voiceId: 'banmai',
        voiceName: 'Ban Mai',
        region: 'north',
        speed: 1,
        pitch: 0,
        emotion: 'neutral',
      }],
    };
    const normalized = normalizeWorkflowState(project);
    expect(normalized.voiceStudio?.defaultProviderId).toBe('elevenlabs');
    expect(normalized.voiceStudio?.profiles[0]).toMatchObject({
      providerId: 'elevenlabs',
      voiceId: '',
      voiceName: 'Chọn giọng ElevenLabs',
    });
  });
});
