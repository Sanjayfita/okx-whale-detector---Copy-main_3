import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { CorrelatedAlertEngine } from '../alerts/CorrelatedAlertEngine';
import { appConfig } from '../config/appConfig';
import { resolveSymbolConfig } from '../config/symbolProfiles';
import { MarketState } from '../core/MarketState';
import { SummaryThrottle } from '../core/SummaryThrottle';
import { ExternalSignalCorrelationService } from '../external/core/ExternalSignalCorrelationService';
import { MarketEngine, type AlphaMarketContextObserverInput } from '../market/MarketEngine';
import { MarketReporter } from '../reporting/MarketReporter';
import { CorrelatedAlertReporter } from '../reporting/CorrelatedAlertReporter';
import { CorrelatedAlertRecorder } from '../recording/CorrelatedAlertRecorder';
import { createCurrentEvidenceEvaluationDefinition } from '../research/evidenceEvaluationDefinition';
import { createEvidenceCollectRuntimeBundle } from '../research/evidenceCollectRuntimeFactory';
import type { EvidenceCollectBootstrap } from '../research/evidenceCollectBootstrap';
import { createEvaluationSessionManifest } from '../research/evaluationSessionManifest';
import { HistoricalL2PriceReader } from '../research/historicalL2/historicalL2PriceReader';
import { discoverHistoricalL2Files, mergeHistoricalL2Files } from '../research/historicalL2/okxHistoricalL2Archive';
import { HistoricalMidpointContextTracker } from '../research/historicalL2/historicalMidpointContext';
import { generateHistoricalReplayReport } from '../research/historicalL2/historicalReplayReport';
import { HistoricalFundingIndex, loadHistoricalFundingFile } from '../research/historicalL2/historicalFunding';
import { ReplayClock, clockNow } from '../runtime/Clock';
import type { MarketInstrumentConfig } from '../types/instrument';

interface Options {
  input: string;
  instruments: string;
  runId?: string;
  feesBps: number;
  slippageBps: number;
  funding?: string;
}

const parseArgs = (args: readonly string[]): Options => {
  const value = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const input = value('--input');
  const instruments = value('--instruments');
  if (!input || !instruments) {
    throw new Error('Usage: npm run historical:l2:replay -- --input <archive-file-or-folder> --instruments <historical-instruments.json> [--funding <funding.csv|ndjson>] [--run-id <id>] [--fees-bps 5] [--slippage-bps 2]');
  }
  const feesBps = Number(value('--fees-bps') ?? '5');
  const slippageBps = Number(value('--slippage-bps') ?? '2');
  if (!Number.isFinite(feesBps) || feesBps < 0 || !Number.isFinite(slippageBps) || slippageBps < 0) {
    throw new Error('fees/slippage bps must be non-negative finite numbers');
  }
  return {
    input,
    instruments,
    funding: value('--funding'),
    runId: value('--run-id'),
    feesBps,
    slippageBps,
  };
};

const safeRunId = (value: string): string => {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/u.test(normalized)) throw new Error('run-id must be URL/file safe');
  return normalized;
};

const loadInstruments = async (filePath: string): Promise<readonly MarketInstrumentConfig[]> => {
  const value = JSON.parse(await readFile(resolve(filePath), 'utf8')) as unknown;
  if (!Array.isArray(value)) throw new Error('Historical instrument metadata must be a JSON array');
  const result: MarketInstrumentConfig[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) throw new Error('Historical instrument metadata contains an invalid record');
    const record = item as Record<string, unknown>;
    if (typeof record.instId !== 'string' || (record.instType !== 'SWAP' && record.instType !== 'FUTURES') || record.quoteCurrency !== 'USDT' || typeof record.baseUnitsPerSize !== 'number' || !Number.isFinite(record.baseUnitsPerSize) || record.baseUnitsPerSize <= 0) {
      throw new Error('Historical instrument metadata requires instId, FUTURES/SWAP, USDT and positive baseUnitsPerSize');
    }
    result.push({ instId: record.instId, instType: record.instType, quoteCurrency: 'USDT', baseUnitsPerSize: record.baseUnitsPerSize });
  }
  if (result.length === 0 || new Set(result.map((item) => item.instId)).size !== result.length) throw new Error('Historical instruments must be non-empty and unique');
  return Object.freeze(result.sort((a,b) => a.instId.localeCompare(b.instId)));
};

const sha256File = async (filePath: string): Promise<string> => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
};

const initializeWorkspace = async (input: {
  runId: string;
  sourceCommit: string;
  instruments: readonly MarketInstrumentConfig[];
  sourceFiles: readonly string[];
  sourceFingerprint: string;
  feesBps: number;
  slippageBps: number;
  fundingSourceFile?: string;
}): Promise<EvidenceCollectBootstrap> => {
  const definition = createCurrentEvidenceEvaluationDefinition();
  const historicalRoot = resolve('data', 'historical-research');
  await mkdir(historicalRoot, { recursive: true });
  const workspace = resolve(historicalRoot, input.runId);
  await mkdir(workspace, { recursive: false });
  const createdAt = Date.now();
  const manifest = createEvaluationSessionManifest({
    evaluationId: input.runId,
    sourceCommit: input.sourceCommit,
    configuration: definition.configuration,
    instruments: input.instruments.map((instrument) => instrument.instId),
    horizonsMinutes: definition.horizonsMinutes,
    minimumCollectionDays: definition.minimumCollectionDays,
    minimumQualifiedAlerts: definition.minimumQualifiedAlerts,
    minimumInstruments: Math.min(definition.minimumInstruments, input.instruments.length),
    createdAt,
  });
  await writeFile(join(workspace, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  await writeFile(join(workspace, 'event-initializations.json'), `${JSON.stringify({ schemaVersion: 1, pending: [], committedAlertIds: [], liveOrderExecutionAllowed: false }, null, 2)}\n`, { flag: 'wx' });
  await writeFile(join(workspace, 'collection-health.json'), `${JSON.stringify({ schemaVersion: 1, evaluationId: input.runId, status: 'HEALTHY', updatedAt: createdAt, lastFailure: null, liveOrderExecutionAllowed: false }, null, 2)}\n`, { flag: 'wx' });
  for (const name of ['evidence-failures.ndjson','qualified-alerts.ndjson','alpha-snapshots.ndjson','outcomes.ndjson','quarantined-episodes.ndjson','coverage-gaps.ndjson','historical-derived-context.ndjson','historical-correlated-alerts.ndjson']) {
    await writeFile(join(workspace, name), '', { flag: 'wx' });
  }
  await writeFile(join(workspace, 'pending-observations.json'), `${JSON.stringify({ schemaVersion: 1, pending: [], liveOrderExecutionAllowed: false }, null, 2)}\n`, { flag: 'wx' });
  await writeFile(join(workspace, 'historical-replay-manifest.json'), `${JSON.stringify({ schemaVersion: 1, runId: input.runId, sourceCommit: input.sourceCommit, source: 'OKX_HISTORICAL_L2_ARCHIVE', sourceFiles: input.sourceFiles, sourceFingerprint: input.sourceFingerprint, instruments: input.instruments, costAssumptions: { feesBpsPerSide: input.feesBps, slippageBpsPerSide: input.slippageBps, fundingSourceFile: input.fundingSourceFile ?? null }, historicalDataNeverAcceptedAsLiveForwardEvidence: true, liveOrderExecutionAllowed: false }, null, 2)}\n`, { flag: 'wx' });
  return Object.freeze({ evaluationDirectory: workspace, manifest, liveOrderExecutionAllowed: false });
};

class SilentCorrelatedAlertReporter extends CorrelatedAlertReporter {
  public override report(): void {}
}

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));
  const gitStatus = execFileSync('git', ['status','--porcelain','--untracked-files=normal'], { encoding: 'utf8' });
  if (gitStatus.trim().length > 0) throw new Error('Historical replay requires a clean committed worktree for reproducibility');
  const sourceCommit = execFileSync('git', ['rev-parse','HEAD'], { encoding: 'utf8' }).trim();
  const sourceFiles = await discoverHistoricalL2Files(options.input);
  const instruments = await loadInstruments(options.instruments);
  const instrumentIds = new Set(instruments.map((instrument) => instrument.instId));
  console.log(`Historical L2 files: ${sourceFiles.length}`);
  console.log('Hashing source archives for deterministic replay identity...');
  const hashes: string[] = [];
  for (const file of sourceFiles) hashes.push(`${file}:${await sha256File(file)}`);
  let fundingIndex: HistoricalFundingIndex | undefined;
  let fundingSourceFile: string | undefined;
  if (options.funding !== undefined) {
    fundingSourceFile = resolve(options.funding);
    const fundingRecords = await loadHistoricalFundingFile(fundingSourceFile);
    fundingIndex = new HistoricalFundingIndex(fundingRecords);
    hashes.push(`${fundingSourceFile}:${await sha256File(fundingSourceFile)}`);
    console.log(`Historical funding records: ${fundingIndex.recordCount}`);
  }
  const sourceFingerprint = createHash('sha256').update(hashes.join('\n')).digest('hex');
  const runId = safeRunId(options.runId ?? `hist-l2-${new Date().toISOString().slice(0,10)}-${sourceFingerprint.slice(0,12)}`);
  const bootstrap = await initializeWorkspace({ runId, sourceCommit, instruments, sourceFiles, sourceFingerprint, feesBps: options.feesBps, slippageBps: options.slippageBps, fundingSourceFile });
  const clock = new ReplayClock();
  const clockFn = clockNow(clock);
  const priceReader = new HistoricalL2PriceReader();
  const tracker = new HistoricalMidpointContextTracker(join(bootstrap.evaluationDirectory, 'historical-derived-context.ndjson'));
  const bundle = createEvidenceCollectRuntimeBundle({ bootstrap, readPrice: priceReader.readPrice, clock: clockFn, pollingEnabled: false, evidenceSource: 'HISTORICAL_REPLAY', onError: (error) => console.error('Historical evidence warning:', error) });
  await bundle.runtime.start();

  const marketStates = new Map<string, MarketState>();
  for (const instrument of instruments) marketStates.set(instrument.instId, new MarketState(resolveSymbolConfig(instrument.instId), instrument, clockFn));
  const correlationService = new ExternalSignalCorrelationService({ correlation: appConfig.correlation });
  const sourceSessionId = `hist-${sourceFingerprint.slice(0,24)}`;
  const alertEngine = new CorrelatedAlertEngine({
    sourceSessionId,
    enabled: true,
    minimumAgreementAlertImportance: appConfig.correlatedAlerts.minimumAgreementAlertImportance,
    minimumContradictionAlertImportance: appConfig.correlatedAlerts.minimumContradictionAlertImportance,
    externalOnlyAlertsEnabled: false,
    minimumExternalOnlyAlertImportance: appConfig.correlatedAlerts.minimumExternalOnlyAlertImportance,
    okxOnlyAlertsEnabled: true,
    minimumOkxOnlyAlertImportance: appConfig.correlatedAlerts.minimumAgreementAlertImportance,
    severityThresholds: appConfig.correlatedAlerts.severityThresholds,
    cooldownMs: appConfig.correlatedAlerts.cooldownSeconds * 1_000,
    confidenceChangeThreshold: appConfig.correlatedAlerts.confidenceChangeThreshold,
    clock: clockFn,
  });
  const alertRecorder = new CorrelatedAlertRecorder({ enabled: true, outputPath: join(bootstrap.evaluationDirectory, 'historical-correlated-alerts.ndjson'), flushAfterEachAlert: false, clock: clockFn });
  const gapStarts = new Map<string, number>();
  let gapWriteChain: Promise<void> = Promise.resolve();
  class HistoricalReporter extends MarketReporter {
    public constructor() { super(() => undefined); }
    public override reportSequenceGap(symbol: string): void { gapStarts.set(symbol, clock.now()); }
    public override reportSequenceRecovery(symbol: string): void {
      const startedAt = gapStarts.get(symbol);
      if (startedAt === undefined) return;
      gapStarts.delete(symbol);
      const endedAt = clock.now();
      const operation = () => bundle.coverageGapStore.record({ gapId: `historical-sequence:${symbol}:${startedAt}:${endedAt}`, evaluationId: runId, kind: 'HISTORICAL_SOURCE_GAP', startedAt, endedAt, instrumentIds: [symbol], alertIds: [], reason: 'ORDER_BOOK_SEQUENCE_GAP', source: 'HISTORICAL_REPLAY', recordedAt: endedAt });
      gapWriteChain = gapWriteChain.then(operation, operation);
    }
  }
  const alphaObserver = (input: AlphaMarketContextObserverInput): void => {
    tracker.recordAlert(input.alert.id, input.alert.symbol, input.alert.createdAt);
    bundle.runtime.onQualifiedMarketContext(input);
  };
  const livePriceObserver = (observation: Parameters<typeof priceReader.observe>[0]): void => { tracker.observe(observation); priceReader.observe(observation); };
  const engine = new MarketEngine(marketStates, new SummaryThrottle(appConfig.reporting.summaryIntervalMs), new HistoricalReporter(), undefined, undefined, correlationService, alertEngine, new SilentCorrelatedAlertReporter(), alertRecorder, clockFn, 'REPLAY', undefined, { maximumOrderBookAgeMs: Number.POSITIVE_INFINITY, maximumFutureSkewMs: 0 }, alphaObserver, livePriceObserver);

  const restoreDateNow = clock.installDateNow();
  let updates = 0;
  let firstTimestamp: number | undefined;
  let lastTimestamp: number | undefined;
  const lastByInstrument = new Map<string, number>();
  const started = performance.now();
  try {
    for await (const record of mergeHistoricalL2Files(sourceFiles)) {
      const update = record.update;
      if (!instrumentIds.has(update.instId)) throw new Error(`Historical archive contains ${update.instId}, but no matching instrument metadata was supplied`);
      clock.observe(update.timestamp);
      firstTimestamp ??= update.timestamp;
      lastTimestamp = update.timestamp;
      const previous = lastByInstrument.get(update.instId);
      if (previous !== undefined && update.timestamp - previous > 10_000) {
        await bundle.coverageGapStore.record({ gapId: `historical-time:${update.instId}:${previous}:${update.timestamp}`, evaluationId: runId, kind: 'HISTORICAL_SOURCE_GAP', startedAt: previous, endedAt: update.timestamp, instrumentIds: [update.instId], alertIds: [], reason: 'NO_L2_RECORDS_FOR_MORE_THAN_10_SECONDS', source: 'HISTORICAL_REPLAY', recordedAt: update.timestamp });
      }
      lastByInstrument.set(update.instId, update.timestamp);
      engine.processOrderBookUpdate(update);
      await bundle.runtime.flushAdmissions();
      await bundle.runtime.processNow();
      updates += 1;
      if (updates % 250_000 === 0) {
        const elapsed = (performance.now() - started) / 1000;
        console.log(`Replay progress: ${updates.toLocaleString('en-US')} L2 updates, ${(updates / Math.max(elapsed, 0.001)).toFixed(0)} updates/s, virtual=${new Date(update.timestamp).toISOString()}`);
      }
    }
    await bundle.runtime.flushAdmissions();
    if (lastTimestamp === undefined || firstTimestamp === undefined) throw new Error('Historical archive contained no usable L2 records');
    await bundle.runtime.processNow();
    const endQuarantines = await bundle.collector.quarantineRemainingPending(lastTimestamp, 'HISTORICAL_RANGE_ENDED');
    await tracker.flush();
    await gapWriteChain;
    await generateHistoricalReplayReport({
      workspace: bootstrap.evaluationDirectory,
      runId,
      sourceFiles,
      sourceFingerprint,
      firstTimestamp,
      lastTimestamp,
      feesBps: options.feesBps,
      slippageBps: options.slippageBps,
      fundingIndex,
      fundingSourceFile,
    });
    const elapsed = (performance.now() - started) / 1000;
    console.log('\nHISTORICAL L2 REPLAY COMPLETE');
    console.log(`Run ID: ${runId}`);
    console.log(`Workspace: ${bootstrap.evaluationDirectory}`);
    console.log(`Virtual span: ${((lastTimestamp-firstTimestamp)/86_400_000).toFixed(2)} days`);
    console.log(`L2 updates: ${updates.toLocaleString('en-US')}`);
    console.log(`Wall time: ${elapsed.toFixed(1)}s (${(updates/Math.max(elapsed,0.001)).toFixed(0)} updates/s)`);
    console.log(`End-of-range quarantined episodes: ${endQuarantines}`);
    console.log(`Summary: ${join(bootstrap.evaluationDirectory, 'historical-replay-summary.json')}`);
    console.log('Historical replay is isolated from data/evaluations. Live order execution remains disabled.');
  } finally {
    restoreDateNow();
    alertRecorder.close();
    await bundle.runtime.stop();
  }
};

if (require.main === module) void main().catch((error: unknown) => { console.error(`Historical L2 replay failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
