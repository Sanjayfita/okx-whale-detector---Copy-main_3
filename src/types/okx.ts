export interface OKXOrderBookLevel {
  price: string;
  size: string;
  liquidationOrders: string;
  orderCount: string;
}

export interface OKXOrderBookData {
  asks: [string, string, string, string][];
  bids: [string, string, string, string][];
  ts: string;
  checksum?: number;
  prevSeqId: string;
  seqId: string;
}

export interface OKXOrderBookMessage {
  arg: {
    channel: string;
    instId: string;
  };
  action: 'snapshot' | 'update';
  data: OKXOrderBookData[];
}
