import { describe, expect, it } from 'vitest';
import { parsePortableFile, parsePortableImport } from '@/core/portable-import';
import { parseMapBridgeDocument, serializeItems, serializePlaces } from '@/core/export';
import type { CanonicalPlace } from '@/core/model';

describe('portable import', () => {
  it('imports GPX waypoints and preserves MapBridge extensions', () => {
    const result = parsePortableImport(`<?xml version="1.0"?><gpx><wpt lat="30" lon="104"><name>Cafe</name><desc>Road</desc><extensions><mapbridge:tags xmlns:mapbridge="https://mapbridge.app/ns/gpx">food;成都</mapbridge:tags><mapbridge:phone xmlns:mapbridge="https://mapbridge.app/ns/gpx">123</mapbridge:phone><mapbridge:identity xmlns:mapbridge="https://mapbridge.app/ns/gpx">cafe|104.00000|30.00000</mapbridge:identity><mapbridge:sourceRecordId xmlns:mapbridge="https://mapbridge.app/ns/gpx">source-1</mapbridge:sourceRecordId></extensions></wpt><rte><name>Route</name><rtept lat="30" lon="104" /></rte></gpx>`, 'amap');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.name).toBe('Cafe');
    expect(result.items[0]!.tags).toEqual(['food', '成都']);
    expect(result.items[0]!.metadata.phone).toBe('123');
    expect(result.items[0]!.identity).toBe('cafe|104.00000|30.00000');
    expect(result.items[0]!.source.recordId).toBe('source-1');
    expect(result.places[0]!.identity).toBe('cafe|104.00000|30.00000');
    expect(result.places[0]!.source.recordId).toBe('source-1');
    expect(result.warnings).toEqual(['GPX 中包含 Route，当前仅支持导入 waypoint，Route 已跳过']);
  });

  it('imports KML Points and skips LineString routes explicitly', () => {
    const result = parsePortableImport('<kml><Document><Placemark><name>Park</name><description>Green</description><ExtendedData><Data name="identity"><value>park|104.00000|30.00000</value></Data><Data name="sourceRecordId"><value>source-2</value></Data></ExtendedData><Point><coordinates>104,30,0</coordinates></Point></Placemark><Placemark><name>Route</name><LineString><coordinates>104,30,0 105,31,0</coordinates></LineString></Placemark></Document></kml>', 'baidu');
    expect(result.places[0]!.wgs84).toEqual({ lng: 104, lat: 30 });
    expect(result.items[0]!.identity).toBe('park|104.00000|30.00000');
    expect(result.items[0]!.source.recordId).toBe('source-2');
    expect(result.warnings).toEqual(['KML 中包含 LineString，当前仅支持导入 Point，路线已跳过']);
  });

  it('rejects XML without supported points', () => {
    expect(() => parsePortableImport('<gpx><rte><name>Only route</name></rte></gpx>', 'amap')).toThrow(/没有可导入的 GPX waypoint/);
  });

  it('dispatches JSON and XML through one portable-file entry point', () => {
    const place: CanonicalPlace = {
      id: 'json-1', name: 'JSON POI', address: '', tags: [], note: '', wgs84: { lng: 104, lat: 30 },
      source: { provider: 'amap', crs: 'wgs84' }, metadata: {},
    };
    const json = parsePortableFile(serializePlaces([place], 'amap'), 'amap');
    const xml = parsePortableFile('<gpx><wpt lat="30" lon="104"><name>XML POI</name></wpt></gpx>', 'amap');
    expect(json.places[0]!.name).toBe('JSON POI');
    expect(xml.items[0]!.name).toBe('XML POI');
    expect(parseMapBridgeDocument(serializeItems(xml.items, 'amap')).items[0]!.kind).toBe('poi');
  });

  it('accepts namespace-qualified GPX and KML documents', () => {
    const gpx = parsePortableImport('<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1" xmlns:mapbridge="https://mapbridge.app/ns/gpx"><wpt lat="30" lon="104"><name>GPX POI</name><extensions><mapbridge:identity>gpx-id</mapbridge:identity></extensions></wpt></gpx>', 'amap');
    const kml = parsePortableImport('<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>KML POI</name><Point><coordinates>104,30,0</coordinates></Point></Placemark></Document></kml>', 'baidu');
    expect(gpx.items[0]!.identity).toBe('gpx-id');
    expect(kml.items[0]!.name).toBe('KML POI');
  });
});
