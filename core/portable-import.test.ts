import { describe, expect, it } from 'vitest';
import { parsePortableImport } from '@/core/portable-import';

describe('portable import', () => {
  it('imports GPX waypoints and preserves MapBridge extensions', () => {
    const result = parsePortableImport(`<?xml version="1.0"?><gpx><wpt lat="30" lon="104"><name>Cafe</name><desc>Road</desc><extensions><mapbridge:tags xmlns:mapbridge="https://mapbridge.app/ns/gpx">food;成都</mapbridge:tags><mapbridge:phone xmlns:mapbridge="https://mapbridge.app/ns/gpx">123</mapbridge:phone></extensions></wpt><rte><name>Route</name><rtept lat="30" lon="104" /></rte></gpx>`, 'amap');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.name).toBe('Cafe');
    expect(result.items[0]!.tags).toEqual(['food', '成都']);
    expect(result.items[0]!.metadata.phone).toBe('123');
    expect(result.warnings).toEqual(['GPX 中包含 Route，当前仅支持导入 waypoint，Route 已跳过']);
  });

  it('imports KML Points and skips LineString routes explicitly', () => {
    const result = parsePortableImport('<kml><Document><Placemark><name>Park</name><description>Green</description><Point><coordinates>104,30,0</coordinates></Point></Placemark><Placemark><name>Route</name><LineString><coordinates>104,30,0 105,31,0</coordinates></LineString></Placemark></Document></kml>', 'baidu');
    expect(result.places[0]!.wgs84).toEqual({ lng: 104, lat: 30 });
    expect(result.warnings).toEqual(['KML 中包含 LineString，当前仅支持导入 Point，路线已跳过']);
  });

  it('rejects XML without supported points', () => {
    expect(() => parsePortableImport('<gpx><rte><name>Only route</name></rte></gpx>', 'amap')).toThrow(/没有可导入的 GPX waypoint/);
  });
});
