// src/types/events.ts

import type { OrderBook } from './orderbook';
import type { MarketState } from './market';
import type { Wall, WallSide } from './wall';
import type { Signal } from './signal';

export enum EventType {
  ORDERBOOK_UPDATE = 'ORDERBOOK_UPDATE',
  MARKET_UPDATE = 'MARKET_UPDATE',
  WALL_DETECTED = 'WALL_DETECTED',
  WALL_REMOVED = 'WALL_REMOVED',
  SIGNAL_GENERATED = 'SIGNAL_GENERATED',
  RESYNC_STARTED = 'RESYNC_STARTED',
  RESYNC_COMPLETED = 'RESYNC_COMPLETED',
}

export interface EventPayloads {
  [EventType.ORDERBOOK_UPDATE]: OrderBook;
  [EventType.MARKET_UPDATE]: MarketState;
  [EventType.WALL_DETECTED]: Wall;
  [EventType.WALL_REMOVED]: {
    side: WallSide;
    price: number;
  };
  [EventType.SIGNAL_GENERATED]: Signal;
  [EventType.RESYNC_STARTED]: Record<string, never>;
  [EventType.RESYNC_COMPLETED]: Record<string, never>;
}

export interface Event<T extends EventType = EventType> {
  type: T;
  timestamp: number;
  payload: EventPayloads[T];
}

export type EventHandler<T extends EventType> = (event: Event<T>) => void;
