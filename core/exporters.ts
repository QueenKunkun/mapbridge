import type { CanonicalItem } from './model';

export interface PortableExportResult {
  text: string;
  warnings: string[];
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function itemDescription(item: Extract<CanonicalItem, { kind: 'poi' }>): string {
  return [item.address, item.note].filter(Boolean).join('\n');
}

function routeDescription(item: Extract<CanonicalItem, { kind: 'route' }>): string {
  return item.stops.map((stop) => `${stop.role}: ${stop.name}`).join('\n');
}

function itemData(item: Extract<CanonicalItem, { kind: 'poi' }>): Array<[string, string]> {
  return [
    ['kind', item.kind],
    ['identity', item.identity ?? ''],
    ['tags', item.tags.join(';')],
    ['provider', item.source.provider],
    ['sourceRecordId', item.source.recordId ?? item.metadata.uid ?? ''],
    ['phone', item.metadata.phone ?? ''],
    ['folder', item.metadata.folder ?? ''],
  ].filter(([, value]) => value !== '') as Array<[string, string]>;
}

/** Export supported v2 items as GPX 1.1. MapBridge metadata uses extensions. */
export function exportGpx(items: CanonicalItem[]): PortableExportResult {
  const poiItems = items.filter((item): item is Extract<CanonicalItem, { kind: 'poi' }> => item.kind === 'poi');
  const routeItems = items.filter((item): item is Extract<CanonicalItem, { kind: 'route' }> => item.kind === 'route');
  const warnings: string[] = items.length === poiItems.length + routeItems.length ? [] : ['部分项目类型暂不支持 GPX 导出，已跳过'];
  const waypoints = poiItems
    .map((item) => {
      const { lng, lat } = item.geometry.point;
      const data = itemData(item)
        .map(([name, value]) => `<mapbridge:${name}>${escapeXml(value)}</mapbridge:${name}>`)
        .join('');
      return [
        `  <wpt lat="${lat}" lon="${lng}">`,
        `    <name>${escapeXml(item.name)}</name>`,
        itemDescription(item) ? `    <desc>${escapeXml(itemDescription(item))}</desc>` : '',
        data ? `    <extensions>${data}</extensions>` : '',
        '  </wpt>',
      ].filter(Boolean).join('\n');
    })
    .join('\n');
  const routes = routeItems
    .map((item) => [
      '  <rte>',
      `    <name>${escapeXml(item.name)}</name>`,
      `    <desc>${escapeXml(routeDescription(item))}</desc>`,
      ...item.stops.map((stop) => `    <rtept lat="${stop.point.lat}" lon="${stop.point.lng}"><name>${escapeXml(stop.name)}</name></rtept>`),
      '  </rte>',
    ].join('\n'))
    .join('\n');
  return {
    warnings,
    text: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="MapBridge" xmlns="http://www.topografix.com/GPX/1/1" xmlns:mapbridge="https://mapbridge.app/ns/gpx">',
      waypoints,
      routes,
      '</gpx>',
    ].filter(Boolean).join('\n'),
  };
}

/** Export supported v2 items as KML 2.2. MapBridge metadata uses ExtendedData. */
export function exportKml(items: CanonicalItem[]): PortableExportResult {
  const poiItems = items.filter((item): item is Extract<CanonicalItem, { kind: 'poi' }> => item.kind === 'poi');
  const routeItems = items.filter((item): item is Extract<CanonicalItem, { kind: 'route' }> => item.kind === 'route');
  const warnings: string[] = items.length === poiItems.length + routeItems.length ? [] : ['部分项目类型暂不支持 KML 导出，已跳过'];
  const placemarks = poiItems
    .map((item) => {
      const { lng, lat } = item.geometry.point;
      const data = itemData(item)
        .map(([name, value]) => `      <Data name="${escapeXml(name)}"><value>${escapeXml(value)}</value></Data>`)
        .join('\n');
      return [
        '    <Placemark>',
        `      <name>${escapeXml(item.name)}</name>`,
        itemDescription(item) ? `      <description>${escapeXml(itemDescription(item))}</description>` : '',
        data ? `      <ExtendedData>\n${data}\n      </ExtendedData>` : '',
        '      <Point>',
        `        <coordinates>${lng},${lat},0</coordinates>`,
        '      </Point>',
        '    </Placemark>',
      ].filter(Boolean).join('\n');
    })
    .join('\n');
  const routes = routeItems
    .map((item) => [
      '    <Placemark>',
      `      <name>${escapeXml(item.name)}</name>`,
      `      <description>${escapeXml(routeDescription(item))}</description>`,
      '      <LineString>',
      `        <coordinates>${item.stops.map((stop) => `${stop.point.lng},${stop.point.lat},0`).join(' ')}</coordinates>`,
      '      </LineString>',
      '    </Placemark>',
    ].join('\n'))
    .join('\n');
  return {
    warnings,
    text: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<kml xmlns="http://www.opengis.net/kml/2.2">',
      '  <Document>',
      placemarks,
      routes,
      '  </Document>',
      '</kml>',
    ].filter(Boolean).join('\n'),
  };
}
