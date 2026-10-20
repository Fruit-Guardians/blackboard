/// <reference types="vite/client" />

import type { GraphSnapshot } from './types';

declare global {
  interface Window {
    __BLACKBOARD_DATA__?: GraphSnapshot;
  }
}

export {};
