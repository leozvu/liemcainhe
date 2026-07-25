import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PUBLISH_CHANNELS, getPublishChannel } from '../services/content/publishChannels';
import {
  CHANNEL_LIMITS,
  findMissingCredentials,
  publishToChannel,
  toPostText,
} from '../services/content/publishService';
import { ArticleDraft } from '../types/content';

const draft: ArticleDraft = {
  title: 'Giá vàng lập đỉnh',
  sapo: 'Giá vàng vừa vượt mốc cũ.',
  sections: [
    { heading: 'Chuyện gì', body: 'Tăng ba phiên liên tiếp. Người mua xếp hàng từ sáng.' },
    { heading: 'Vì sao', body: 'Lãi suất hạ khiến dòng tiền dịch chuyển.' },
  ],
  hashtags: ['gia_vang', 'lai_suat'],
  seoTitle: 'Giá vàng lập đỉnh',
  metaDescription: 'Ba lý do.',
  readingMinutes: 1,
};

const ok = (body: unknown) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

const creds = { accessToken: 'tok', accountId: '123' };

describe('danh mục kênh', () => {
  it('mỗi kênh có đủ hướng dẫn lấy token', () => {
    for (const channel of PUBLISH_CHANNELS) {
      expect(channel.steps.length, `${channel.id} thiếu các bước`).toBeGreaterThan(2);
      expect(channel.requirements.length, `${channel.id} thiếu điều kiện`).toBeGreaterThan(0);
      expect(channel.consoleUrl.startsWith('https://')).toBe(true);
      expect(channel.fields.length).toBeGreaterThan(0);
      expect(channel.proxyPrefix.startsWith('/api-proxy/')).toBe(true);
    }
  });

  it('id là duy nhất và có giới hạn ký tự', () => {
    const ids = PUBLISH_CHANNELS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(CHANNEL_LIMITS[id]).toBeGreaterThan(0);
  });

  it('token luôn được đánh dấu là bí mật', () => {
    for (const channel of PUBLISH_CHANNELS) {
      const tokenField = channel.fields.find((f) => f.key === 'accessToken');
      expect(tokenField?.secret, `${channel.id} không đánh dấu token là bí mật`).toBe(true);
    }
  });

  it('tra được kênh theo id', () => {
    expect(getPublishChannel('threads')?.label).toBe('Threads');
    expect(getPublishChannel('khong-co')).toBeUndefined();
  });
});

describe('rút gọn bài thành bài đăng', () => {
  it('giữ nguyên khi còn trong giới hạn', () => {
    const text = toPostText(draft, 60000);
    expect(text).toContain('Giá vàng lập đỉnh');
    expect(text).toContain('Lãi suất hạ');
    expect(text.endsWith('#gia_vang #lai_suat')).toBe(true);
  });

  it('cắt ở ranh giới câu chứ không cắt giữa chừng', () => {
    const text = toPostText(draft, 120);
    expect(text.length).toBeLessThanOrEqual(120);
    expect(text).toContain('#gia_vang');
    const body = text.replace(/\n\n#.*$/, '');
    expect(/[.…]$/.test(body.trim())).toBe(true);
  });

  it('không bao giờ vượt giới hạn, kể cả khi giới hạn rất chật', () => {
    for (const limit of [40, 50, 60, 80, 120, 200, 500]) {
      expect(toPostText(draft, limit).length, `vỡ ở giới hạn ${limit}`).toBeLessThanOrEqual(limit);
    }
  });
});

describe('kiểm tra thông tin đăng nhập', () => {
  it('chỉ ra đúng ô còn thiếu', () => {
    expect(findMissingCredentials('facebook-page', {})).toEqual(['Page ID', 'Page Access Token']);
    expect(findMissingCredentials('facebook-page', { accountId: '1' })).toEqual(['Page Access Token']);
    expect(findMissingCredentials('facebook-page', creds)).toEqual([]);
  });

  it('Zalo chỉ cần token', () => {
    expect(findMissingCredentials('zalo-oa', { accessToken: 'x' })).toEqual([]);
  });
});

describe('chặn trước khi gọi mạng', () => {
  it('thiếu thông tin thì không gọi', async () => {
    const fetchImpl = vi.fn();
    const r = await publishToChannel('facebook-page', { text: 'a' }, {}, fetchImpl as never);
    expect(r.success).toBe(false);
    expect(r.message).toContain('Còn thiếu');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('nội dung rỗng thì không gọi', async () => {
    const fetchImpl = vi.fn();
    const r = await publishToChannel('facebook-page', { text: '   ' }, creds, fetchImpl as never);
    expect(r.success).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('vượt giới hạn ký tự thì không gọi', async () => {
    const fetchImpl = vi.fn();
    const r = await publishToChannel('threads', { text: 'x'.repeat(600) }, creds, fetchImpl as never);
    expect(r.success).toBe(false);
    expect(r.message).toContain('vượt giới hạn 500');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('Facebook Page', () => {
  it('gọi đúng endpoint qua proxy cùng miền', async () => {
    const fetchImpl = ok({ id: '123_456' });
    const r = await publishToChannel('facebook-page', { text: 'Xin chào' }, creds, fetchImpl as never);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api-proxy/facebook/v21.0/123/feed');
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('message=Xin+ch%C3%A0o');
    expect(r.success).toBe(true);
    expect(r.url).toBe('https://facebook.com/123_456');
  });

  it('bóc thông báo lỗi của Meta', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Token hết hạn' } }), { status: 400 }),
    );
    const r = await publishToChannel('facebook-page', { text: 'a' }, creds, fetchImpl as never);
    expect(r.success).toBe(false);
    expect(r.message).toBe('Token hết hạn');
  });
});

describe('Threads', () => {
  it('đi đủ hai bước tạo vùng chứa rồi xuất bản', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'c1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'p1' }), { status: 200 }));

    const r = await publishToChannel('threads', { text: 'Ngắn thôi' }, creds, fetchImpl as never);

    expect(fetchImpl.mock.calls[0][0]).toBe('/api-proxy/threads/v1.0/123/threads');
    expect(fetchImpl.mock.calls[1][0]).toBe('/api-proxy/threads/v1.0/123/threads_publish');
    expect(String(fetchImpl.mock.calls[1][1].body)).toContain('creation_id=c1');
    expect(r.success).toBe(true);
  });

  it('bước một hỏng thì dừng, không gọi bước hai', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 400 }));
    const r = await publishToChannel('threads', { text: 'a' }, creds, fetchImpl as never);
    expect(r.success).toBe(false);
    expect(r.message).toContain('Không tạo được bài nháp');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('bước hai hỏng thì nói rõ bài nháp không công khai', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'c1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 500 }));
    const r = await publishToChannel('threads', { text: 'a' }, creds, fetchImpl as never);
    expect(r.success).toBe(false);
    expect(r.message).toContain('không hiện công khai');
  });
});

describe('Zalo OA', () => {
  it('gửi token qua header tuỳ biến', async () => {
    const fetchImpl = ok({ error: 0, data: { id: 'a1' } });
    const r = await publishToChannel('zalo-oa', { text: 'Xin chào' }, { accessToken: 'tok' }, fetchImpl as never);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api-proxy/zalo/v2.0/article/create');
    expect(init.headers.access_token).toBe('tok');
    expect(r.success).toBe(true);
  });

  it('nhận ra lỗi nằm trong thân phản hồi dù HTTP là 200', async () => {
    const fetchImpl = ok({ error: -201, message: 'Access token không hợp lệ' });
    const r = await publishToChannel('zalo-oa', { text: 'a' }, { accessToken: 'tok' }, fetchImpl as never);
    expect(r.success).toBe(false);
    expect(r.message).toBe('Access token không hợp lệ');
  });
});

describe('lỗi mạng', () => {
  it('trở thành kết quả thất bại chứ không ném ra ngoài', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('Failed to fetch'));
    const r = await publishToChannel('facebook-page', { text: 'a' }, creds, fetchImpl as never);
    expect(r.success).toBe(false);
    expect(r.message).toBe('Failed to fetch');
  });
});

describe('tiền tố proxy phải có ở mọi lớp', () => {
  const root = path.join(__dirname, '..');
  const files = {
    'vite.config.ts': readFileSync(path.join(root, 'vite.config.ts'), 'utf8'),
    'worker/index.js': readFileSync(path.join(root, 'worker', 'index.js'), 'utf8'),
    'electron/main.cjs': readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8'),
    'nginx.conf': readFileSync(path.join(root, 'nginx.conf'), 'utf8'),
  };

  it.each(PUBLISH_CHANNELS.map((c) => [c.id, c.proxyPrefix]))(
    'kênh %s có tiền tố %s ở cả bốn lớp proxy',
    (_id, prefix) => {
      for (const [name, source] of Object.entries(files)) {
        expect(source.includes(prefix), `${name} thiếu ${prefix}`).toBe(true);
      }
    },
  );

  it('worker cho phép header access_token của Zalo đi qua', () => {
    const block = /const ALLOWED_PROXY_HEADERS = new Set\(\[([\s\S]*?)\]\);/.exec(files['worker/index.js']);
    expect(block?.[1]).toContain("'access_token'");
  });
});
