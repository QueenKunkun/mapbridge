import { describe, expect, it } from 'vitest';
import { isBaiduFavWriteSuccess } from './baidu-fav';

describe('isBaiduFavWriteSuccess', () => {
  it('accepts the successful fav response even though the record status is 100', () => {
    const response = JSON.stringify({
      result: { error: 0, type: 2000 },
      sync: { newdata: [{ status: '100', detail: { data: { fid: '10_example' } } }] },
    });
    expect(isBaiduFavWriteSuccess(200, response)).toBe(true);
  });

  it('rejects an HTTP error, malformed response, or API error', () => {
    expect(isBaiduFavWriteSuccess(500, '{"result":{"error":0}}')).toBe(false);
    expect(isBaiduFavWriteSuccess(200, 'not json')).toBe(false);
    expect(isBaiduFavWriteSuccess(200, '{"result":{"error":1}}')).toBe(false);
  });
});
