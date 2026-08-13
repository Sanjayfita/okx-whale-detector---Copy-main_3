import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { HistoricalL2PriceReader } from '../src/research/historicalL2/historicalL2PriceReader';
import { mergeHistoricalL2Files } from '../src/research/historicalL2/okxHistoricalL2Archive';
import { ReplayClock } from '../src/runtime/Clock';
import { HistoricalFundingIndex, loadHistoricalFundingFile } from '../src/research/historicalL2/historicalFunding';

const line = (instId: string, ts: number, seqId: number) => JSON.stringify({ arg: { channel: 'books', instId }, action: seqId === 1 ? 'snapshot' : 'update', data: [{ asks: [['101','2','0','1']], bids: [['99','2','0','1']], ts: String(ts), seqId, prevSeqId: seqId === 1 ? -1 : seqId - 1 }] });

describe('historical OKX L2 virtual-time replay primitives', () => {
  it('k-way merges multiple archive files deterministically by historical timestamp', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hist-l2-'));
    const a = join(directory, 'btc.ndjson');
    const b = join(directory, 'eth.ndjson');
    await writeFile(a, `${line('BTC-USDT-SWAP', 1_000, 1)}\n${line('BTC-USDT-SWAP', 3_000, 2)}\n`);
    await writeFile(b, `${line('ETH-USDT-SWAP', 2_000, 1)}\n${line('ETH-USDT-SWAP', 4_000, 2)}\n`);
    const clock = new ReplayClock();
    const observed: string[] = [];
    for await (const record of mergeHistoricalL2Files([a,b])) {
      clock.observe(record.update.timestamp);
      observed.push(`${record.update.instId}:${clock.now()}`);
    }
    expect(observed).toEqual(['BTC-USDT-SWAP:1000','ETH-USDT-SWAP:2000','BTC-USDT-SWAP:3000','ETH-USDT-SWAP:4000']);
  });

  it('refuses to serve a pre-due midpoint and serves the first post-due historical midpoint', async () => {
    const reader = new HistoricalL2PriceReader();
    reader.observe({ instrumentId: 'BTC-USDT-SWAP', observedAt: 10_000, sourceMarketTimestamp: 10_000, price: 100 });
    await expect(reader.readPrice('BTC-USDT-SWAP', 10_001)).rejects.toThrow('predates');
    reader.observe({ instrumentId: 'BTC-USDT-SWAP', observedAt: 10_100, sourceMarketTimestamp: 10_100, price: 101 });
    await expect(reader.readPrice('BTC-USDT-SWAP', 10_001)).resolves.toMatchObject({ price: 101, sourceMarketDataSource: 'OKX_HISTORICAL_L2_MIDPOINT' });
  });

  it('loads explicit historical funding companion data without fabricating missing rows', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hist-funding-'));
    const file = join(directory, 'funding.csv');
    await writeFile(
      file,
      'instId,fundingTime,fundingRate\nBTC-USDT-SWAP,2000,0.0001\nBTC-USDT-SWAP,4000,-0.00005\n',
    );
    const index = new HistoricalFundingIndex(await loadHistoricalFundingFile(file));
    expect(index.recordCount).toBe(2);
    expect(index.sumRates('BTC-USDT-SWAP', 1_000, 3_000)).toBeCloseTo(0.0001);
    expect(index.sumRates('BTC-USDT-SWAP', 1_000, 5_000)).toBeCloseTo(0.00005);
    expect(index.sumRates('ETH-USDT-SWAP', 1_000, 5_000)).toBe(0);
  });

  it('rejects ambiguous historical CSV without explicit bid/ask L2 arrays', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hist-l2-csv-'));
    const file = join(directory, 'bad.csv');
    await writeFile(file, 'instId,action,ts,seqId,prevSeqId,bestBid,bestAsk\nBTC-USDT-SWAP,snapshot,1000,1,-1,99,101\n');
    await expect(async () => {
      for await (const _record of mergeHistoricalL2Files([file])) void _record;
    }).rejects.toThrow('lower-quality reconstruction is refused');
  });
});
