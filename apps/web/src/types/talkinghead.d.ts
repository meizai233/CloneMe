declare module "@met4citizen/talkinghead" {
  export class TalkingHead {
    constructor(nodeAvatar: HTMLElement, options?: Record<string, unknown>);
    showAvatar(avatar: Record<string, unknown>): Promise<void>;
    setMood?(mood: string): void;
    playGesture?(name: string, dur?: number, mirror?: boolean, ms?: number): void;
    stopGesture?(ms?: number): void;
    setFixedValue?(key: string, value: number | null): void;
    stop?(): void;
  }
}
