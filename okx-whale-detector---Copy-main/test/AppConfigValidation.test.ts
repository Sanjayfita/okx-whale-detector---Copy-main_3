import { describe, expect, it } from 'vitest';

import { appConfig, type AppConfig } from '../src/config/appConfig';
import { validateAppConfig } from '../src/config/validateAppConfig';
import { MarketState } from '../src/core/MarketState';

const cloneConfig = (): AppConfig =>
  JSON.parse(JSON.stringify(appConfig)) as AppConfig;

describe('application configuration validation', () => {
  it('accepts the production defaults', () => {
    expect(() => validateAppConfig(appConfig)).not.toThrow();
  });

  it('rejects non-positive runtime intervals', () => {
    const config = cloneConfig();

    config.reporting.summaryIntervalMs = 0;
    config.history.candleLimit = -1;

    expect(() => validateAppConfig(config)).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining(
          'reporting.summaryIntervalMs must be a finite number greater than 0',
        ),
      }),
    );

    expect(() => validateAppConfig(config)).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining(
          'history.candleLimit must be a finite number greater than 0',
        ),
      }),
    );
  });

  it('rejects invalid correlated alert configuration', () => {
    const config = cloneConfig();

    config.correlatedAlerts.enabled = 'yes' as never;
    config.correlatedAlerts.minimumAgreementAlertImportance = 101;
    config.correlatedAlerts.cooldownSeconds = 0;
    config.correlatedAlerts.confidenceChangeThreshold = 0;

    expect(() => validateAppConfig(config)).toThrowError(
      expect.objectContaining({
        message: expect.stringMatching(
          /correlatedAlerts\.enabled[\s\S]*correlatedAlerts\.minimumAgreementAlertImportance[\s\S]*correlatedAlerts\.cooldownSeconds[\s\S]*correlatedAlerts\.confidenceChangeThreshold/,
        ),
      }),
    );
  });

  it('rejects invalid correlation weights and confidence settings', () => {
    const config = cloneConfig();

    config.correlation.okxWeight = 0.8;
    config.correlation.externalWeight = 0.3;
    config.correlation.contradictionPenalty = 101;

    expect(() => validateAppConfig(config)).toThrowError(
      expect.objectContaining({
        message: expect.stringMatching(
          /correlation weights must sum to 1[\s\S]*correlation\.contradictionPenalty/,
        ),
      }),
    );
  });

  it('rejects unordered severity thresholds and unreachable gates', () => {
    const config = cloneConfig();

    config.correlatedAlerts.severityThresholds.strong = 50;
    config.correlatedAlerts.minimumContradictionAlertImportance = 40;

    expect(() => validateAppConfig(config)).toThrowError(
      expect.objectContaining({
        message: expect.stringMatching(
          /severity thresholds must increase[\s\S]*minimum importance thresholds must be greater than or equal to the watch severity threshold/,
        ),
      }),
    );
  });

  it('accepts valid correlated alert recording configuration', () => {
    const config = cloneConfig();

    config.correlatedAlertRecording = {
      enabled: true,
      outputPath: 'data/alerts/custom.jsonl',
      flushAfterEachAlert: false,
    };

    expect(() => validateAppConfig(config)).not.toThrow();
  });

  it('rejects an empty correlated alert recording path', () => {
    const config = cloneConfig();

    config.correlatedAlertRecording.outputPath = '   ';

    expect(() => validateAppConfig(config)).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining(
          'correlatedAlertRecording.outputPath must be a non-empty string',
        ),
      }),
    );
  });

  it('rejects relative alert recording paths outside the project', () => {
    const config = cloneConfig();

    config.correlatedAlertRecording.outputPath = '../outside/alerts.jsonl';

    expect(() => validateAppConfig(config)).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining(
          'correlatedAlertRecording.outputPath must not traverse outside the project',
        ),
      }),
    );
  });

  it('rejects strong ages below persistent ages', () => {
    const config = cloneConfig();

    config.whale.strongAfterMs = config.whale.persistentAfterMs - 1;
    config.tracker.strongAfterSeconds =
      config.tracker.persistentAfterSeconds - 1;

    expect(() => validateAppConfig(config)).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining(
          'whale.strongAfterMs must be greater than or equal to whale.persistentAfterMs',
        ),
      }),
    );

    expect(() => validateAppConfig(config)).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining(
          'tracker.strongAfterSeconds must be greater than or equal to tracker.persistentAfterSeconds',
        ),
      }),
    );
  });

  it('rejects an inverted movement-size ratio range', () => {
    const config = cloneConfig();

    config.tracker.minimumMovementSizeRatio = 1.3;
    config.tracker.maximumMovementSizeRatio = 1.2;

    expect(() => validateAppConfig(config)).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining(
          'tracker.minimumMovementSizeRatio must be less than or equal to tracker.maximumMovementSizeRatio',
        ),
      }),
    );
  });

  it('rejects invalid percentages', () => {
    const config = cloneConfig();

    config.refill.recoveryThresholdPercent = 101;
    config.market.neutralBandPercent = 0;

    expect(() => validateAppConfig(config)).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining(
          'refill.recoveryThresholdPercent must be a finite percentage greater than 0 and at most 100',
        ),
      }),
    );

    expect(() => validateAppConfig(config)).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining(
          'market.neutralBandPercent must be a finite percentage greater than 0 and at most 100',
        ),
      }),
    );
  });

  it('rejects score components whose maximum exceeds the total score', () => {
    const config = cloneConfig();

    config.scoring.maxStabilityScore = 25;

    expect(() => validateAppConfig(config)).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining(
          'scoring component maximums must not exceed scoring.maxScore',
        ),
      }),
    );
  });

  it('reports multiple configuration errors together', () => {
    const config = cloneConfig();

    config.events.minimumChangeNotional = 0;
    config.behavior.repeatedIncreaseCount = 2.5;
    config.history.candleLimit = 0;

    expect(() => validateAppConfig(config)).toThrowError(
      expect.objectContaining({
        message: expect.stringMatching(
          /events\.minimumChangeNotional[\s\S]*behavior\.repeatedIncreaseCount must be an integer[\s\S]*history\.candleLimit/,
        ),
      }),
    );
  });

  it('prevents MarketState from using invalid injected configuration', () => {
    const config = cloneConfig();

    config.tracker.minimumNotionalQuote = 0;

    expect(() => new MarketState(config)).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining(
          'tracker.minimumNotionalQuote must be a finite number greater than 0',
        ),
      }),
    );
  });
});
