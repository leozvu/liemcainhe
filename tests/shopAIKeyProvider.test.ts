import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { clearCredentialVault } from '../services/credentialVault';
import {
  getActiveModelsConfig,
  getModels,
  getProviders,
  resetRegistry,
  setProviderApiKey,
} from '../services/modelRegistry';
import { verifyProviderApiKey } from '../services/providerService';
import { callShopAIKeyImageApi, callShopAIKeyVideoApi } from '../services/adapters/shopAIKeyAdapter';
import { callChatApi } from '../services/adapters/chatAdapter';
import { generateVoice } from '../services/voiceService';
import { setVoiceCredentials } from '../services/voiceRegistry';
import { SHOPAIKEY_PROVIDER_ID } from '../types/model';
import { clearProviderModelAvailability } from '../services/providerCapabilities';

const createStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] || null,
    get length() { return values.size; },
  } as Storage;
};

describe('ShopAIKey internal gateway mode', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
    clearCredentialVault();
    clearProviderModelAvailability(SHOPAIKEY_PROVIDER_ID);
    resetRegistry();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('chỉ mở ShopAIKey và chuyển cả ba model mặc định sang cổng nội bộ', () => {
    expect(getProviders().map((provider) => provider.id)).toEqual([SHOPAIKEY_PROVIDER_ID]);
    expect(new Set(getModels().map((model) => model.providerId))).toEqual(new Set([SHOPAIKEY_PROVIDER_ID]));
    expect(getActiveModelsConfig()).toEqual({
      chat: 'shopaikey-grok-fast',
      image: 'shopaikey-nano-banana-2',
      video: 'shopaikey-veo3-fast',
    });
  });

  it('xác thực khóa bằng /v1/models qua proxy cùng miền', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: 'grok-4-1-fast-reasoning' }, { id: 'gpt-4.1' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(verifyProviderApiKey(SHOPAIKEY_PROVIDER_ID, 'sk-test')).resolves.toMatchObject({
      success: true,
      discoveredModels: 2,
    });
    expect(fetchMock.mock.calls[0][0]).toBe('/api-proxy/shopaikey/v1/models');
  });

  it('đọc quyền model rồi fallback Grok sang GPT-5 Mini khi upstream trả 5xx', async () => {
    setProviderApiKey(SHOPAIKEY_PROVIDER_ID, 'sk-test');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: 'grok-4-1-fast-reasoning' }, { id: 'gpt-5-mini' }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: 'upstream unavailable (request id: req_grok)' },
      }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: '{"shots":[]}' } }],
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const preferred = getModels('chat').find((model) => model.id === 'shopaikey-grok-fast') as any;

    await expect(callChatApi({ prompt: 'Tạo storyboard JSON', responseFormat: 'json' }, preferred))
      .resolves.toBe('{"shots":[]}');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    const fallbackBody = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(firstBody.model).toBe('grok-4-1-fast-reasoning');
    expect(fallbackBody.model).toBe('gpt-5-mini');
  });

  it('gửi ảnh Nano Banana đúng endpoint, tỉ lệ và reference pack', async () => {
    const imagePayload = 'a'.repeat(120);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: imagePayload }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const model = getModels('image').find((item) => item.id === 'shopaikey-nano-banana-2') as any;

    const result = await callShopAIKeyImageApi({
      prompt: 'Khung hình quảng cáo Egoric',
      aspectRatio: '9:16',
      referenceImages: ['data:image/png;base64,reference'],
    }, model, 'sk-test', '/api-proxy/shopaikey');

    expect(result).toBe(`data:image/png;base64,${imagePayload}`);
    expect(fetchMock.mock.calls[0][0]).toBe('/api-proxy/shopaikey/images/google/generations');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      model: 'nano-banana-2',
      size: '9:16',
      imageSize: '2K',
      image_urls: ['data:image/png;base64,reference'],
    });
  });

  it('tạo một task video rồi chỉ poll task đó đến khi hoàn tất', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { task_id: 'task_egoric_1' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: 'SUCCESS', result_url: 'https://cdn.test/video.mp4' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const model = getModels('video').find((item) => item.id === 'shopaikey-veo3-fast') as any;
    const taskIds: string[] = [];
    const pending = callShopAIKeyVideoApi({
      prompt: 'Máy quay tiến chậm',
      aspectRatio: '16:9',
      onProviderTaskId: (taskId) => { taskIds.push(taskId); },
    }, model, 'sk-test', '/api-proxy/shopaikey');
    await vi.advanceTimersByTimeAsync(4_100);

    await expect(pending).resolves.toBe('https://cdn.test/video.mp4');
    expect(taskIds).toEqual(['task_egoric_1']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('dùng cùng khóa ShopAIKey cho Gemini TTS', async () => {
    setProviderApiKey(SHOPAIKEY_PROVIDER_ID, 'sk-test');
    setVoiceCredentials('shopaikey', { apiKey: 'sk-test' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      url: 'https://cdn.test/voice.wav',
      format: 'wav',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateVoice({
      providerId: 'shopaikey',
      text: 'Xin chào từ Egoric',
      voiceId: 'Kore',
      speed: 1,
      emotion: 'neutral',
      outputFormat: 'wav',
    })).resolves.toMatchObject({ audioUrl: 'https://cdn.test/voice.wav', remote: true });
    expect(fetchMock.mock.calls[0][0]).toBe('/api-proxy/shopaikey/tts/google/generations');
  });

  it('mọi runtime chỉ mở entry point AI cho ShopAIKey', () => {
    const worker = readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8').slice(0, 800);
    const desktop = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8').slice(0, 1400);
    const vite = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
    const nginx = readFileSync(new URL('../nginx.conf', import.meta.url), 'utf8');
    expect(worker).toContain("'/api-proxy/shopaikey': 'https://api.shopaikey.com'");
    expect(desktop).toContain("path: '/api-proxy/shopaikey'");
    expect(vite).toContain("'/api-proxy/shopaikey'");
    expect(nginx).toContain('proxy_pass https://api.shopaikey.com/');
    for (const oldProvider of ['openrouter', 'google', 'replicate', 'kie', 'fpt', 'viettel', 'elevenlabs']) {
      expect(worker).not.toContain(`/api-proxy/${oldProvider}`);
      expect(desktop).not.toContain(`/api-proxy/${oldProvider}`);
      expect(vite).not.toContain(`/api-proxy/${oldProvider}`);
      expect(nginx).not.toContain(`proxy_pass https://api.${oldProvider}`);
    }
  });
});
