export interface Location {
  zh: string;
  en: string;
  lat: number;
  lng: number;
}

export interface Work {
  zh: string;
  en: string;
  year: number;
}

export interface Philosopher {
  id: string;
  name_zh: string;
  name_en: string;
  birth: number;
  death: number;
  location: Location;
  schools: string[];
  influence_tier: 1 | 2 | 3;
  theories_zh: string[];
  theories_en: string[];
  works: Work[];
  teachers: string[];
  influenced_by: string[];
  influenced: string[];
  bio_zh: string;
}

export interface School {
  id: string;
  name_zh: string;
  name_en: string;
  color: string;
}

export interface Era {
  id: string;
  from: number;
  to: number;
  name_zh: string;
  name_en: string;
  basemap: string;
}
