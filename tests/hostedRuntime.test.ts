import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isEgoricPublicHostname,
  isHostedHostname,
  isHostedRuntime,
} from '../services/hostedRuntime';

afterEach(() => vi.unstubAllGlobals());

describe('hosted runtime detection', () => {
  it.each([
    'egoric-studio-vietnam.leozvu-work.chatgpt.site',
    'egoric-film-studio.leozvu-work.workers.dev',
  ])('nhận %s là backend cùng miền', (hostname) => {
    expect(isHostedHostname(hostname)).toBe(true);
  });

  it.each(['localhost', '127.0.0.1', 'example.com', 'workers.dev.example.com'])('không nhận nhầm %s', (hostname) => {
    expect(isHostedHostname(hostname)).toBe(false);
  });

  it('đọc hostname runtime hiện tại', () => {
    vi.stubGlobal('window', { location: { hostname: 'egoric-film-studio.leozvu-work.workers.dev' } });
    expect(isHostedRuntime()).toBe(true);
  });

  it('phân biệt hostname public Cloudflare với hostname Sites', () => {
    expect(isEgoricPublicHostname('egoric-film-studio.leozvu-work.workers.dev')).toBe(true);
    expect(isEgoricPublicHostname('egoric-studio-vietnam.leozvu-work.chatgpt.site')).toBe(false);
  });
});
