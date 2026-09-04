import { describe, expect, it } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import { exportGpx, exportKml } from '@/core/exporters';
import type { CanonicalItem } from '@/core/model';

const poi: CanonicalItem = {
  kind: 'poi',
  id: 'poi-1',
  identity: 'test|104.00000|30.00000',
  name: 'A & B <测试>',
  address: 'Road "1"',
  tags: ['food', '成都'],
  note: 'Bring coffee',
  geometry: { type: 'point', point: { lng: 104, lat: 30 } },
  source: { provider: 'amap', crs: 'wgs84', recordId: 'source-1' },
  metadata: { phone: '123', folder: 'Favorites' },
};

const route: CanonicalItem = {
  kind: 'route',
  id: 'route-1',
  name: 'Route A',
  stops: [
    { role: 'start', name: 'Start', point: { lng: 104, lat: 30 } },
    { role: 'end', name: 'End', point: { lng: 105, lat: 31 } },
  ],
  routing: {},
  source: { provider: 'baidu', crs: 'bd09mc' },
  metadata: {},
};

describe('portable exporters', () => {
  it('exports POI as GPX waypoint with escaped content and metadata extensions', () => {
    const result = exportGpx([poi]);
    expect(result.warnings).toContain('GPX 导出无法完整保留 POI 内部 id，未映射的 metadata 也可能丢失');
    expect(result.text).toContain('<wpt lat="30" lon="104">');
    expect(result.text).toContain('A &amp; B &lt;测试&gt;');
    expect(result.text).toContain('<mapbridge:tags>food;成都</mapbridge:tags>');
    expect(result.text).toContain('<desc>Road &quot;1&quot;\nBring coffee</desc>');
  });

  it('exports POI as KML placemark with ExtendedData', () => {
    const result = exportKml([poi]);
    expect(result.warnings).toContain('KML 导出无法完整保留 POI 内部 id，未映射的 metadata 也可能丢失');
    expect(result.text).toContain('<Placemark>');
    expect(result.text).toContain('<coordinates>104,30,0</coordinates>');
    expect(result.text).toContain('<Data name="sourceRecordId"><value>source-1</value></Data>');
  });

  it('returns a warning when an unsupported item is supplied', () => {
    const result = exportGpx([poi, { ...poi, id: 'future', kind: 'future' } as never]);
    expect(result.warnings).toContain('部分项目类型暂不支持 GPX 导出，已跳过');
    expect(result.text.match(/<wpt /g)).toHaveLength(1);
  });

  it('exports Route stops as GPX rte and KML LineString', () => {
    const gpx = exportGpx([route]);
    expect(gpx.warnings).toContain('GPX 导出会将 Route 转为 stops/线段，无法保留内部 id、routing、source 和 metadata');
    expect(gpx.text).toContain('<rte>');
    expect(gpx.text).toContain('<rtept lat="30" lon="104"><name>Start</name></rtept>');

    const kml = exportKml([route]);
    expect(kml.warnings).toContain('KML 导出会将 Route 转为 stops/线段，无法保留内部 id、routing、source 和 metadata');
    expect(kml.text).toContain('<LineString>');
    expect(kml.text).toContain('<coordinates>104,30,0 105,31,0</coordinates>');
  });

  it('produces structurally valid GPX and KML documents', () => {
    const parser = new XMLParser({
      ignoreAttributes: false,
      isArray: (name) => ['wpt', 'rte', 'rtept', 'Placemark'].includes(name),
    });
    const gpx = parser.parse(exportGpx([poi, route]).text);
    const kml = parser.parse(exportKml([poi, route]).text);
    expect(gpx.gpx.wpt).toHaveLength(1);
    expect(gpx.gpx.rte[0].rtept).toHaveLength(2);
    expect(kml.kml.Document.Placemark).toHaveLength(2);
  });
});
