type Listener<T> = (state: T, prev: T) => void;

export interface AppState {
  year: number;
  selectedId: string | null;
  hoveredId: string | null;
  showLineage: boolean;
  showAllPhilosophers: boolean;
  searchQuery: string;
  schoolFilter: string | null;
  isPlaying: boolean;
  loopStart: number;
  loopEnd: number;
  playbackSpeed: number;
}

const initial: AppState = {
  year: -400,
  selectedId: null,
  hoveredId: null,
  showLineage: false,
  showAllPhilosophers: false,
  searchQuery: "",
  schoolFilter: null,
  isPlaying: false,
  loopStart: -600,
  loopEnd: 2000,
  playbackSpeed: 1,
};

class Store {
  private state: AppState = { ...initial };
  private listeners = new Set<Listener<AppState>>();

  get<K extends keyof AppState>(key: K): AppState[K] {
    return this.state[key];
  }

  set(patch: Partial<AppState>): void {
    const prev = this.state;
    const next = { ...prev, ...patch };
    let changed = false;
    for (const k of Object.keys(patch) as (keyof AppState)[]) {
      if (prev[k] !== next[k]) changed = true;
    }
    if (!changed) return;
    this.state = next;
    for (const l of this.listeners) l(next, prev);
  }

  subscribe(listener: Listener<AppState>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): AppState {
    return { ...this.state };
  }
}

export const store = new Store();
