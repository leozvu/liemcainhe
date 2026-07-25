import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TREND_SOURCES,
  getTrendProxyUrl,
  resolveTrendTargetUrl,
} from '../services/content/trendSources';
import {
  cleanTrendTitle,
  fetchTrendBoard,
  fetchTrendSource,
  fetchTrendsWithFallback,
  parseFeed,
  pickWeightedTrend,
} from '../services/content/trendService';
import { TrendItem } from '../types/content';

const rss = (titles: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
${titles
  .map(
    (t) =>
      `<item><title><![CDATA[${t}]]></title><link>https://vd.vn/a</link><pubDate>Thu, 24 Jul 2026 08:00:00 +0700</pubDate></item>`,
  )
  .join('\n')}
</channel></rss>`;

const okFetch = (body: string) =>
  (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;

const deadFetch = (async () => {
  throw new Error('mạng hỏng');
}) as unknown as typeof fetch;

describe('chuẩn hoá tiêu đề xu hướng', () => {
  it('bỏ CDATA, thẻ HTML và giải mã thực thể', () => {
    expect(cleanTrendTitle('<b>Giá vàng</b> tăng &amp; giảm')).toBe('Giá vàng tăng & giảm');
    expect(cleanTrendTitle('Tin &#8220;nóng&#8221;')).toBe('Tin “nóng”');
  });

  it('bỏ đuôi tên toà soạn', () => {
    expect(cleanTrendTitle('Bão số 3 đổ bộ - VnExpress')).toBe('Bão số 3 đổ bộ');
    expect(cleanTrendTitle('Chuyện lạ – Báo Dân trí')).toBe('Chuyện lạ');
  });

  it('đổi gạch đứng thành gạch ngang và gộp khoảng trắng', () => {
    expect(cleanTrendTitle('Tiêu điểm 25.7 | Hàn Quốc   chuyển hướng')).toBe(
      'Tiêu điểm 25.7 – Hàn Quốc chuyển hướng',
    );
  });

  it('giữ nguyên dấu tiếng Việt', () => {
    expect(cleanTrendTitle('Đội tuyển Việt Nam thắng đậm')).toBe('Đội tuyển Việt Nam thắng đậm');
  });
});

describe('bóc feed', () => {
  it('lấy đúng số mục và khử trùng lặp', () => {
    const entries = parseFeed(rss(['A', 'B', 'A', 'C']), 10);
    expect(entries.map((e) => e.title)).toEqual(['A', 'B', 'C']);
    expect(entries[0].link).toBe('https://vd.vn/a');
    expect(entries[0].publishedAt).toContain('2026');
  });

  it('tôn trọng giới hạn', () => {
    expect(parseFeed(rss(['A', 'B', 'C', 'D']), 2)).toHaveLength(2);
  });

  it('trả mảng rỗng với XML hỏng thay vì ném lỗi', () => {
    expect(parseFeed('<rss><channel>chưa đóng thẻ', 5)).toEqual([]);
    expect(parseFeed('', 5)).toEqual([]);
  });

  it('đọc được feed Atom', () => {
    const atom = `<feed><entry><title>Tin Atom</title></entry></feed>`;
    expect(parseFeed(atom, 5).map((e) => e.title)).toEqual(['Tin Atom']);
  });
});

describe('đọc nguồn', () => {
  it('gán nhãn nguồn và thứ hạng', async () => {
    const items = await fetchTrendSource('vnexpress', 5, okFetch(rss(['Tin 1', 'Tin 2'])));
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ sourceId: 'vnexpress', sourceLabel: 'VnExpress', rank: 1 });
    expect(items[1].rank).toBe(2);
  });

  it('trả rỗng với id lạ, không gọi mạng', async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response('', { status: 200 });
    }) as unknown as typeof fetch;
    expect(await fetchTrendSource('khong-ton-tai', 5, spy)).toEqual([]);
    expect(called).toBe(false);
  });

  it('nuốt lỗi mạng thành mảng rỗng', async () => {
    expect(await fetchTrendSource('vnexpress', 5, deadFetch)).toEqual([]);
  });
});

describe('dự phòng khi nguồn chết', () => {
  it('chuyển sang nguồn khác khi nguồn chính im lặng', async () => {
    const goi: string[] = [];
    const impl = (async (url: string) => {
      goi.push(url);
      if (url.includes('cafef')) return new Response('', { status: 502 });
      return new Response(rss(['Tin dự phòng']), { status: 200 });
    }) as unknown as typeof fetch;

    const items = await fetchTrendsWithFallback('cafef', 5, impl);
    expect(items[0].title).toBe('Tin dự phòng');
    expect(goi[0]).toBe(getTrendProxyUrl('cafef'));
    expect(items[0].sourceId).not.toBe('cafef');
  });

  it('ưu tiên bảng xu hướng tìm kiếm khi phải dự phòng', async () => {
    const impl = (async (url: string) =>
      url.includes('cafef')
        ? new Response('', { status: 502 })
        : new Response(rss(['x']), { status: 200 })) as unknown as typeof fetch;

    const items = await fetchTrendsWithFallback('cafef', 5, impl);
    expect(items[0].sourceId).toBe('google-trends');
  });

  it('trả rỗng khi mọi nguồn đều chết', async () => {
    expect(await fetchTrendsWithFallback('vnexpress', 5, deadFetch)).toEqual([]);
  });
});

describe('rút thăm theo trọng số', () => {
  const items: TrendItem[] = ['A', 'B', 'C'].map((title, i) => ({
    title,
    sourceId: 'vnexpress',
    sourceLabel: 'VnExpress',
    category: 'tong_hop',
    rank: i + 1,
  }));

  it('random thấp nhất trúng mục đầu bảng', () => {
    expect(pickWeightedTrend(items, () => 0)?.title).toBe('A');
  });

  it('random cao nhất trúng mục cuối', () => {
    expect(pickWeightedTrend(items, () => 0.999999)?.title).toBe('C');
  });

  it('trả undefined với danh sách rỗng', () => {
    expect(pickWeightedTrend([], () => 0.5)).toBeUndefined();
  });
});

describe('bảng tổng hợp nhiều nguồn', () => {
  it('khử trùng lặp tiêu đề không phân biệt hoa thường', async () => {
    const impl = (async (url: string) =>
      new Response(
        rss(url.includes('vnexpress') ? ['Giá vàng hôm nay', 'Riêng A'] : ['GIÁ VÀNG HÔM NAY', 'Riêng B']),
        { status: 200 },
      )) as unknown as typeof fetch;

    const board = await fetchTrendBoard(['vnexpress', 'dantri'], 5, impl);
    expect(board.map((i) => i.title)).toEqual(['Giá vàng hôm nay', 'Riêng A', 'Riêng B']);
  });
});

describe('danh mục nguồn', () => {
  it('id là duy nhất', () => {
    const ids = TREND_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('có đúng một bảng xu hướng tìm kiếm', () => {
    expect(TREND_SOURCES.filter((s) => s.kind === 'search')).toHaveLength(1);
  });

  it('mọi nguồn dùng https', () => {
    for (const source of TREND_SOURCES) {
      expect(source.host.startsWith('https://')).toBe(true);
    }
  });

  it('đường dẫn proxy mã hoá id', () => {
    expect(getTrendProxyUrl('google-trends')).toBe('/api-proxy/trends/google-trends');
  });

  it('không giải được URL đích cho id lạ', () => {
    expect(resolveTrendTargetUrl('../../etc/passwd')).toBeUndefined();
  });
});

describe('plugin Vite bóc được allowlist từ trendSources.ts', () => {
  it('lấy đủ 13 nguồn và đúng URL', async () => {
    const mod = await import('../scripts/trend-proxy-plugin.mjs');
    const plugin = mod.trendProxyPlugin();
    expect(plugin.name).toBe('egoric-trend-proxy');

    // readAllowlist ném lỗi nếu bóc được 0 nguồn, nên plugin dựng được đã là
    // bằng chứng regex còn khớp. Dưới đây đối chiếu từng URL cho chắc.
    const src = readFileSync(
      path.join(__dirname, '..', 'services', 'content', 'trendSources.ts'),
      'utf8',
    );
    const bocDuoc = new Map<string, string>();
    for (const [, id, host, feedPath] of src.matchAll(
      /\{\s*id:\s*'([^']+)',[\s\S]*?host:\s*'([^']+)',\s*path:\s*'([^']+)',/g,
    )) {
      bocDuoc.set(id, `${host}${feedPath}`);
    }

    expect(bocDuoc.size).toBe(TREND_SOURCES.length);
    for (const source of TREND_SOURCES) {
      expect(bocDuoc.get(source.id)).toBe(`${source.host}${source.path}`);
    }
  });
});

describe('allowlist của worker không được lệch với trendSources.ts', () => {
  it('worker và client khai báo cùng một tập nguồn', () => {
    const workerSrc = readFileSync(path.join(__dirname, '..', 'worker', 'index.js'), 'utf8');
    const block = /const TREND_TARGETS = \{([\s\S]*?)\n\};/.exec(workerSrc);
    expect(block, 'không tìm thấy TREND_TARGETS trong worker/index.js').toBeTruthy();

    const workerMap = new Map<string, string>();
    for (const [, key, value] of block![1].matchAll(/^\s*'?([\w-]+)'?:\s*'([^']+)',/gm)) {
      workerMap.set(key, value);
    }

    const clientMap = new Map(TREND_SOURCES.map((s) => [s.id, `${s.host}${s.path}`]));

    expect([...workerMap.keys()].sort()).toEqual([...clientMap.keys()].sort());
    for (const [id, url] of clientMap) {
      expect(workerMap.get(id), `URL của nguồn ${id} lệch nhau`).toBe(url);
    }
  });
});
