import { CorrelatedAlertEngine } from '../alerts/CorrelatedAlertEngine';
import { appConfig } from '../config/appConfig';
import { ExternalSignalCorrelationService } from '../external/core/ExternalSignalCorrelationService';
import { PolymarketLiveSignalRuntime } from '../external/providers/polymarket/PolymarketLiveSignalRuntime';
import type { AlphaMarketContextObserver } from '../market/MarketEngine';
import { EvidenceAwareCorrelatedAlertRecorder } from '../research/evidenceAwareCorrelatedAlertRecorder';
import {
  loadEvidenceCollectBootstrap,
  type EvidenceCollectBootstrap,
} from '../research/evidenceCollectBootstrap';
import { createEvidenceCollectRuntimeBundle } from '../research/evidenceCollectRuntimeFactory';
import {
  EvidenceEvaluationLease,
  type EvidenceEvaluationLeaseLike,
} from '../research/evidenceEvaluationLease';
import { OKXLivePriceReader } from '../research/okxLivePriceReader';
import type { AppShutdownReason } from '../runtime/AppShutdownCoordinator';
import { createRuntimeSessionId } from '../runtime/runtimeSession';

interface AppRuntimeLike {
  polymarketRuntime: { start: () => Promise<void> | void };
  shutdown: (signal: AppShutdownReason) => Promise<void>;
}

export interface EvidenceCollectCommandDependencies {
  createAppRuntime: (dependencies: {
    correlatedAlertRecorder: EvidenceAwareCorrelatedAlertRecorder;
    alphaMarketContextObserver: AlphaMarketContextObserver;
    externalSignalCorrelationService: ExternalSignalCorrelationService;
    correlatedAlertEngine: CorrelatedAlertEngine;
    polymarketRuntime: PolymarketLiveSignalRuntime;
  }) => Promise<AppRuntimeLike>;
  loadBootstrap?: typeof loadEvidenceCollectBootstrap;
  createPriceReader?: () => OKXLivePriceReader;
  createRuntimeBundle?: typeof createEvidenceCollectRuntimeBundle;
  createEvaluationLease?: (
    bootstrap: EvidenceCollectBootstrap,
  ) => EvidenceEvaluationLeaseLike;
  registerSignal?: (signal: NodeJS.Signals, handler: () => void) => void;
  log?: (message: string) => void;
  error?: (message: string, error?: unknown) => void;
}

export interface EvidenceCollectCommandHandle {
  evaluationId: string;
  stop: (signal?: AppShutdownReason) => Promise<void>;
  liveOrderExecutionAllowed: false;
}

const rethrowWithCleanupErrors = (
  primaryError: unknown,
  cleanupErrors: readonly unknown[],
  message: string,
): never => {
  if (cleanupErrors.length > 0) {
    throw new AggregateError([primaryError, ...cleanupErrors], message);
  }
  throw primaryError;
};

const createOkxOnlyAlertDependencies = (): Readonly<{
  externalSignalCorrelationService: ExternalSignalCorrelationService;
  correlatedAlertEngine: CorrelatedAlertEngine;
  polymarketRuntime: PolymarketLiveSignalRuntime;
}> => {
  const externalSignalCorrelationService =
    new ExternalSignalCorrelationService({
      correlation: appConfig.correlation,
    });
  const correlatedAlertEngine = new CorrelatedAlertEngine({
    sourceSessionId: createRuntimeSessionId(),
    enabled: true,
    minimumAgreementAlertImportance:
      appConfig.correlatedAlerts.minimumAgreementAlertImportance,
    minimumContradictionAlertImportance:
      appConfig.correlatedAlerts.minimumContradictionAlertImportance,
    externalOnlyAlertsEnabled: false,
    minimumExternalOnlyAlertImportance:
      appConfig.correlatedAlerts.minimumExternalOnlyAlertImportance,
    okxOnlyAlertsEnabled: true,
    minimumOkxOnlyAlertImportance:
      appConfig.correlatedAlerts.minimumAgreementAlertImportance,
    severityThresholds: appConfig.correlatedAlerts.severityThresholds,
    cooldownMs: appConfig.correlatedAlerts.cooldownSeconds * 1_000,
    confidenceChangeThreshold:
      appConfig.correlatedAlerts.confidenceChangeThreshold,
  });
  const polymarketRuntime = new PolymarketLiveSignalRuntime(
    {
      ...appConfig.polymarket,
      enabled: false,
    },
    {
      correlationService: externalSignalCorrelationService,
    },
  );

  return Object.freeze({
    externalSignalCorrelationService,
    correlatedAlertEngine,
    polymarketRuntime,
  });
};

export const runEvidenceCollectCommand = async (
  evaluationId: string,
  dependencies: EvidenceCollectCommandDependencies,
): Promise<EvidenceCollectCommandHandle> => {
  const loadBootstrap =
    dependencies.loadBootstrap ?? loadEvidenceCollectBootstrap;
  const createPriceReader =
    dependencies.createPriceReader ?? (() => new OKXLivePriceReader());
  const createRuntimeBundle =
    dependencies.createRuntimeBundle ?? createEvidenceCollectRuntimeBundle;
  const createEvaluationLease =
    dependencies.createEvaluationLease ??
    ((bootstrap: EvidenceCollectBootstrap) =>
      new EvidenceEvaluationLease({
        evaluationDirectory: bootstrap.evaluationDirectory,
        evaluationId: bootstrap.manifest.evaluationId,
        sourceCommit: bootstrap.manifest.sourceCommit,
        configurationFingerprint: bootstrap.manifest.configurationFingerprint,
        purpose: 'COLLECTION',
      }));
  const registerSignal =
    dependencies.registerSignal ??
    ((signal, handler) => {
      process.once(signal, handler);
    });
  const log = dependencies.log ?? console.log;
  const error = dependencies.error ?? console.error;

  const bootstrap = await loadBootstrap(evaluationId);
  const evaluationLease = createEvaluationLease(bootstrap);
  await evaluationLease.acquire();

  let bundle: ReturnType<typeof createEvidenceCollectRuntimeBundle> | undefined;
  let correlatedAlertRecorder: EvidenceAwareCorrelatedAlertRecorder | undefined;
  let appRuntime: AppRuntimeLike | undefined;
  try {
    const priceReader = createPriceReader();
    bundle = createRuntimeBundle({
      bootstrap,
      readPrice: priceReader.readPrice,
      onError: (runtimeError) => {
        error('Evidence collection runtime error:', runtimeError);
      },
    });
    await bundle.runtime.start();

    correlatedAlertRecorder = new EvidenceAwareCorrelatedAlertRecorder({
      enabled: appConfig.correlatedAlertRecording.enabled,
      outputPath: appConfig.correlatedAlertRecording.outputPath,
      flushAfterEachAlert:
        appConfig.correlatedAlertRecording.flushAfterEachAlert,
      onPersistedLiveAlert: bundle.runtime.onPersistedLiveAlert,
    });
    const okxOnlyDependencies = createOkxOnlyAlertDependencies();
    appRuntime = await dependencies.createAppRuntime({
      correlatedAlertRecorder,
      alphaMarketContextObserver: bundle.runtime.onPersistedAlphaMarketContext,
      externalSignalCorrelationService:
        okxOnlyDependencies.externalSignalCorrelationService,
      correlatedAlertEngine: okxOnlyDependencies.correlatedAlertEngine,
      polymarketRuntime: okxOnlyDependencies.polymarketRuntime,
    });
  } catch (startupError) {
    const cleanupErrors: unknown[] = [];
    let evidenceRuntimeStopped = bundle === undefined;
    if (bundle !== undefined) {
      try {
        await bundle.runtime.stop();
        evidenceRuntimeStopped = true;
      } catch (cleanupError: unknown) {
        cleanupErrors.push(cleanupError);
      }
    }
    try {
      correlatedAlertRecorder?.close();
    } catch (cleanupError: unknown) {
      cleanupErrors.push(cleanupError);
    }
    if (evidenceRuntimeStopped) {
      try {
        await evaluationLease.release();
      } catch (cleanupError: unknown) {
        cleanupErrors.push(cleanupError);
      }
    }
    rethrowWithCleanupErrors(
      startupError,
      cleanupErrors,
      'Evidence collection startup and cleanup failed',
    );
  }

  const activeBundle = bundle;
  const activeAppRuntime = appRuntime;
  if (activeBundle === undefined || activeAppRuntime === undefined) {
    throw new Error('Evidence collection startup did not produce a runtime');
  }

  void Promise.resolve(activeAppRuntime.polymarketRuntime.start()).catch(
    (polymarketError: unknown) => {
      error('Disabled external-signal runtime failed unexpectedly:', polymarketError);
    },
  );

  let stopped = false;
  const stop = async (signal: AppShutdownReason = 'SIGINT'): Promise<void> => {
    if (stopped) return;
    stopped = true;
    const shutdownErrors: unknown[] = [];
    try {
      await activeAppRuntime.shutdown(signal);
    } catch (shutdownError: unknown) {
      shutdownErrors.push(shutdownError);
    }
    let evidenceRuntimeStopped = false;
    try {
      await activeBundle.runtime.stop();
      evidenceRuntimeStopped = true;
    } catch (evidenceShutdownError: unknown) {
      shutdownErrors.push(evidenceShutdownError);
    }
    if (evidenceRuntimeStopped) {
      try {
        await evaluationLease.release();
      } catch (leaseReleaseError: unknown) {
        shutdownErrors.push(leaseReleaseError);
      }
    }
    if (shutdownErrors.length === 1) {
      throw shutdownErrors[0];
    }
    if (shutdownErrors.length > 1) {
      throw new AggregateError(
        shutdownErrors,
        'Evidence collection shutdown failed',
      );
    }
  };

  registerSignal('SIGINT', () => {
    void stop('SIGINT').catch((shutdownError: unknown) => {
      error('Evidence collection shutdown failed:', shutdownError);
      process.exitCode = 1;
    });
  });
  registerSignal('SIGTERM', () => {
    void stop('SIGTERM').catch((shutdownError: unknown) => {
      error('Evidence collection shutdown failed:', shutdownError);
      process.exitCode = 1;
    });
  });

  log('LIVE EVIDENCE COLLECTION COORDINATOR STARTED');
  log(`Evaluation ID: ${bootstrap.manifest.evaluationId}`);
  log(`Directory: ${bootstrap.evaluationDirectory}`);
  log('Event generator: OKX whale signal only.');
  log('External signals cannot qualify evidence events.');
  log('Public OKX market data only. Live order execution remains disabled.');

  return Object.freeze({
    evaluationId: bootstrap.manifest.evaluationId,
    stop,
    liveOrderExecutionAllowed: false,
  });
};

const main = async (): Promise<void> => {
  const evaluationId = process.argv[2]?.trim();
  if (!evaluationId) {
    throw new Error('Usage: npm run evidence:collect -- <evaluation-id>');
  }
  process.env.OKX_SKIP_AUTO_START = '1';
  const { createAppRuntime } = await import('../index.js');
  await runEvidenceCollectCommand(evaluationId, { createAppRuntime });
};

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(
      `Evidence collection failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}
