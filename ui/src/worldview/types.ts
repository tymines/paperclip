/** World View  shared feed types (TYL-131). */

export interface FeedResp<T> {
  status: string;
  source?: string;
  items: T[];
  note?: string | null;
}

export interface NewsItem {
  title: string;
  url: string;
  source?: string;
  published?: string;
  country?: string;
}

export interface GeoItem {
  title: string;
  url: string;
  source?: string;
  published?: string;
  summary?: string;
}

export interface SourceRow {
  panel: string;
  provider: string;
  key: string | null;
  status: string;
  notes?: string;
  count?: number;
}

export interface Quake {
  id: string;
  mag: number;
  place: string;
  time: number;
  lon: number;
  lat: number;
  url: string;
  depthKm?: number | null;
  tsunami?: boolean;
}

export interface FireItem {
  lat: number;
  lon: number;
  brightness: number | null;
  confidence: string;
  frp: number | null;
  satellite: string;
  instrument: string;
}

export interface Flight {
  icao24: string;
  callsign: string;
  lon: number;
  lat: number;
  heading: number;
  velocity: number | null;
  altitude: number | null;
  country: string;
  category?: string;
}

export interface Vessel {
  mmsi: string;
  name?: string;
  lon: number;
  lat: number;
  heading?: number | null;
  sog?: number | null;
  type?: string;
}

export interface EonetEvent {
  id: string;
  title: string;
  category: string;
  icon: string;
  lon: number;
  lat: number;
  date: string | null;
  url: string;
  magnitude?: number | null;
  magnitudeUnit?: string | null;
}

export interface Cve {
  id: string;
  published: string;
  score: number | null;
  severity: string;
  summary: string;
  url: string;
}

export interface SatTle {
  name: string;
  l1: string;
  l2: string;
  group: string;
}

export interface ConflictZone {
  id: string;
  label: string;
  severity: string;
  lat: number;
  lon: number;
  description: string;
  sourceUrl: string;
}

export interface Camera {
  id: string;
  name: string;
  lat: number;
  lon: number;
  imageUrl: string;
  videoUrl: string;
  available: boolean;
  operator: string;
  city: string;
}

export interface NewsStation {
  id: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  url: string;
  embed: boolean;
  category: string;
}

export interface SwpcState {
  kp: number | null;
  level: string;
  time: string | null;
  alerts: { product: string; issued: string; message: string }[];
}

export interface RadarState {
  host: string;
  frames: { time: number; path: string }[];
}

/** A live-propagated satellite position for map rendering. */
export interface SatPosition {
  name: string;
  group: string;
  lon: number;
  lat: number;
  altKm: number;
}
