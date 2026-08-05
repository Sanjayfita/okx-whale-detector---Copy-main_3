import type { ResearchMarketDataRecord } from '../data/ResearchMarketData';
import type {
  ResearchStore,
  ResearchStoreTransaction,
  StoredBacktest,
  StoredFeatureValue,
  StoredOptimizationExperiment,
  StoredOptimizationTrial,
  StoredSignal,
} from './ResearchStore';

export type SqlParameter = string | number | boolean | null;

export interface SqlQueryResult<Row = Readonly<Record<string, unknown>>> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface SqlExecutor {
  query<Row = Readonly<Record<string, unknown>>>(
    text: string,
    parameters?: readonly SqlParameter[],
  ): Promise<SqlQueryResult<Row>>;
}

export interface SqlConnection extends SqlExecutor {
  release(): void;
}

export interface SqlPool extends SqlExecutor {
  connect(): Promise<SqlConnection>;
  end(): Promise<void>;
}

const json = (value: unknown): string => JSON.stringify(value);

const assertFinite = (value: number, name: string): void => {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
};

class PostgresResearchTransaction implements ResearchStoreTransaction {
  public constructor(private readonly executor: SqlExecutor) {}

  public async appendMarketData(
    records: readonly ResearchMarketDataRecord[],
  ): Promise<void> {
    const metadata = records.filter(
      (record) => record.kind === 'CONTRACT_METADATA',
    );
    const remaining = records.filter(
      (record) => record.kind !== 'CONTRACT_METADATA',
    );

    for (const record of metadata) {
      if (record.kind !== 'CONTRACT_METADATA') {
        continue;
      }
      await this.executor.query(
        `INSERT INTO research.instruments (
          instrument_id,
          instrument_type,
          base_currency,
          quote_currency,
          settlement_currency,
          contract_value,
          contract_value_currency,
          tick_size,
          lot_size,
          minimum_contracts,
          maximum_leverage,
          listing_time_ms,
          expiry_time_ms,
          metadata_observed_at_ms,
          metadata
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15::jsonb
        )
        ON CONFLICT (instrument_id) DO UPDATE SET
          instrument_type = EXCLUDED.instrument_type,
          base_currency = EXCLUDED.base_currency,
          quote_currency = EXCLUDED.quote_currency,
          settlement_currency = EXCLUDED.settlement_currency,
          contract_value = EXCLUDED.contract_value,
          contract_value_currency = EXCLUDED.contract_value_currency,
          tick_size = EXCLUDED.tick_size,
          lot_size = EXCLUDED.lot_size,
          minimum_contracts = EXCLUDED.minimum_contracts,
          maximum_leverage = EXCLUDED.maximum_leverage,
          listing_time_ms = EXCLUDED.listing_time_ms,
          expiry_time_ms = EXCLUDED.expiry_time_ms,
          metadata_observed_at_ms = EXCLUDED.metadata_observed_at_ms,
          metadata = EXCLUDED.metadata,
          updated_at = now()`,
        [
          record.instrumentId,
          record.instrumentType,
          record.baseCurrency,
          record.quoteCurrency,
          record.settlementCurrency,
          record.contractValue,
          record.contractValueCurrency,
          record.tickSize,
          record.lotSize,
          record.minimumContracts,
          record.maximumLeverage,
          record.listingTime,
          record.expiryTime,
          record.observedAt,
          json(record),
        ],
      );
    }

    for (const record of remaining) {
      switch (record.kind) {
        case 'TRADE':
          await this.executor.query(
            `INSERT INTO research.market_trades (
              instrument_id, observed_at_ms, received_at_ms, trade_id,
              taker_side, price, contracts, source
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT DO NOTHING`,
            [
              record.instrumentId,
              record.observedAt,
              record.receivedAt,
              record.tradeId,
              record.side,
              record.price,
              record.contracts,
              record.source,
            ],
          );
          break;
        case 'ORDER_BOOK': {
          const bestBid = record.bids[0]?.price;
          const bestAsk = record.asks[0]?.price;
          if (bestBid === undefined || bestAsk === undefined) {
            throw new Error('Order book snapshots require both bid and ask depth');
          }
          await this.executor.query(
            `INSERT INTO research.order_book_snapshots (
              instrument_id, observed_at_ms, received_at_ms, sequence_id,
              best_bid, best_ask, depth_per_side, source
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT DO NOTHING`,
            [
              record.instrumentId,
              record.observedAt,
              record.receivedAt,
              record.sequenceId ?? -1,
              bestBid,
              bestAsk,
              Math.max(record.bids.length, record.asks.length),
              record.source,
            ],
          );
          const sides = [
            ['BID', record.bids],
            ['ASK', record.asks],
          ] as const;
          for (const [side, levels] of sides) {
            for (let levelIndex = 0; levelIndex < levels.length; levelIndex += 1) {
              const level = levels[levelIndex];
              if (level === undefined) {
                continue;
              }
              await this.executor.query(
                `INSERT INTO research.order_book_levels (
                  instrument_id, observed_at_ms, sequence_id, side,
                  level_index, price, contracts, order_count
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT DO NOTHING`,
                [
                  record.instrumentId,
                  record.observedAt,
                  record.sequenceId ?? -1,
                  side,
                  levelIndex,
                  level.price,
                  level.contracts,
                  level.orderCount,
                ],
              );
            }
          }
          break;
        }
        case 'CANDLE':
          await this.executor.query(
            `INSERT INTO research.candles (
              instrument_id, observed_at_ms, received_at_ms, interval_ms,
              open, high, low, close, contract_volume, base_volume,
              quote_volume, confirmed, source
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
            ) ON CONFLICT DO NOTHING`,
            [
              record.instrumentId,
              record.observedAt,
              record.receivedAt,
              record.intervalMs,
              record.open,
              record.high,
              record.low,
              record.close,
              record.contractVolume,
              record.baseVolume,
              record.quoteVolume,
              record.confirmed,
              record.source,
            ],
          );
          break;
        case 'OPEN_INTEREST':
          await this.executor.query(
            `INSERT INTO research.open_interest (
              instrument_id, observed_at_ms, received_at_ms, contracts,
              base_currency_amount, quote_currency_amount, source
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT DO NOTHING`,
            [
              record.instrumentId,
              record.observedAt,
              record.receivedAt,
              record.contracts,
              record.baseCurrencyAmount,
              record.quoteCurrencyAmount,
              record.source,
            ],
          );
          break;
        case 'FUNDING':
          await this.executor.query(
            `INSERT INTO research.funding_rates (
              instrument_id, observed_at_ms, received_at_ms, funding_time_ms,
              funding_rate, realized_rate, source
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT DO NOTHING`,
            [
              record.instrumentId,
              record.observedAt,
              record.receivedAt,
              record.fundingTime,
              record.fundingRate,
              record.realizedRate,
              record.source,
            ],
          );
          break;
        case 'LIQUIDATION':
          await this.executor.query(
            `INSERT INTO research.liquidation_events (
              instrument_id, observed_at_ms, received_at_ms, liquidation_side,
              price, contracts, source, event_hash
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT DO NOTHING`,
            [
              record.instrumentId,
              record.observedAt,
              record.receivedAt,
              record.side,
              record.price,
              record.contracts,
              record.source,
              `${record.side}:${record.price}:${record.contracts}`,
            ],
          );
          break;
        case 'MARK_INDEX':
          await this.executor.query(
            `INSERT INTO research.mark_index_prices (
              instrument_id, observed_at_ms, received_at_ms,
              mark_price, index_price, source
            ) VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT DO NOTHING`,
            [
              record.instrumentId,
              record.observedAt,
              record.receivedAt,
              record.markPrice,
              record.indexPrice,
              record.source,
            ],
          );
          break;
        case 'BEST_QUOTE':
          await this.executor.query(
            `INSERT INTO research.best_quotes (
              instrument_id, observed_at_ms, received_at_ms,
              best_bid, best_ask, bid_contracts, ask_contracts, source
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT DO NOTHING`,
            [
              record.instrumentId,
              record.observedAt,
              record.receivedAt,
              record.bestBid,
              record.bestAsk,
              record.bidContracts,
              record.askContracts,
              record.source,
            ],
          );
          break;
        case 'VOLUME':
          await this.executor.query(
            `INSERT INTO research.market_volumes (
              instrument_id, observed_at_ms, received_at_ms, window_ms,
              contract_volume, base_volume, quote_volume, source
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT DO NOTHING`,
            [
              record.instrumentId,
              record.observedAt,
              record.receivedAt,
              record.windowMs,
              record.contractVolume,
              record.baseVolume,
              record.quoteVolume,
              record.source,
            ],
          );
          break;
        case 'CONTRACT_METADATA':
          break;
      }
    }
  }

  public async appendFeatures(
    features: readonly StoredFeatureValue[],
  ): Promise<void> {
    for (const feature of features) {
      assertFinite(feature.featureValue, 'featureValue');
      await this.executor.query(
        `INSERT INTO research.features (
          feature_set_id, instrument_id, observed_at_ms, feature_name,
          feature_value, source_max_observed_at_ms, calculation_version
        ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
        ON CONFLICT DO NOTHING`,
        [
          feature.featureSetId,
          feature.instrumentId,
          feature.observedAt,
          feature.featureName,
          feature.featureValue,
          feature.sourceMaxObservedAt,
          feature.calculationVersion,
        ],
      );
    }
  }

  public async appendSignals(signals: readonly StoredSignal[]): Promise<void> {
    for (const signal of signals) {
      assertFinite(signal.score, 'signal.score');
      await this.executor.query(
        `INSERT INTO research.signals (
          signal_id, strategy_id, instrument_id, observed_at_ms, direction,
          score, parameters, feature_values, episode_id,
          live_execution_allowed
        ) VALUES (
          $1::uuid, $2::uuid, $3, $4, $5, $6,
          $7::jsonb, $8::jsonb, $9, $10
        ) ON CONFLICT DO NOTHING`,
        [
          signal.signalId,
          signal.strategyId,
          signal.instrumentId,
          signal.observedAt,
          signal.direction,
          signal.score,
          json(signal.parameters),
          json(signal.featureValues),
          signal.episodeId,
          signal.liveExecutionAllowed,
        ],
      );
    }
  }

  public async saveBacktest(backtest: StoredBacktest): Promise<void> {
    await this.executor.query(
      `INSERT INTO research.backtests (
        backtest_id, strategy_id, dataset_id, code_commit,
        configuration_hash, started_at, completed_at, status,
        training_range, test_range, untouched_holdout, metrics,
        rejection_reasons
      ) VALUES (
        $1::uuid, $2::uuid, $3, $4, $5, $6::timestamptz,
        $7::timestamptz, $8,
        CASE WHEN $9 IS NULL THEN NULL ELSE int8range($9, $10, '[)') END,
        CASE WHEN $11 IS NULL THEN NULL ELSE int8range($11, $12, '[)') END,
        $13, $14::jsonb, $15::jsonb
      )
      ON CONFLICT (backtest_id) DO UPDATE SET
        completed_at = EXCLUDED.completed_at,
        status = EXCLUDED.status,
        metrics = EXCLUDED.metrics,
        rejection_reasons = EXCLUDED.rejection_reasons`,
      [
        backtest.backtestId,
        backtest.strategyId,
        backtest.datasetId,
        backtest.codeCommit,
        backtest.configurationHash,
        backtest.startedAt,
        backtest.completedAt,
        backtest.status,
        backtest.trainingRange?.[0] ?? null,
        backtest.trainingRange?.[1] ?? null,
        backtest.testRange?.[0] ?? null,
        backtest.testRange?.[1] ?? null,
        backtest.untouchedHoldout,
        backtest.metrics === null ? null : json(backtest.metrics),
        json(backtest.rejectionReasons),
      ],
    );
  }

  public async saveOptimizationExperiment(
    experiment: StoredOptimizationExperiment,
  ): Promise<void> {
    await this.executor.query(
      `INSERT INTO research.hyperparameter_experiments (
        experiment_id, strategy_id, dataset_id, code_commit, search_space,
        optimizer, objective_definition, seed, status, created_at,
        completed_at
      ) VALUES (
        $1::uuid, $2::uuid, $3, $4, $5::jsonb,
        $6, $7::jsonb, $8, $9, $10::timestamptz, $11::timestamptz
      )
      ON CONFLICT (experiment_id) DO UPDATE SET
        status = EXCLUDED.status,
        completed_at = EXCLUDED.completed_at`,
      [
        experiment.experimentId,
        experiment.strategyId,
        experiment.datasetId,
        experiment.codeCommit,
        json(experiment.searchSpace),
        experiment.optimizer,
        json(experiment.objectiveDefinition),
        experiment.seed,
        experiment.status,
        experiment.createdAt,
        experiment.completedAt,
      ],
    );
  }

  public async saveOptimizationTrials(
    trials: readonly StoredOptimizationTrial[],
  ): Promise<void> {
    for (const trial of trials) {
      if (trial.objectiveValue !== null) {
        assertFinite(trial.objectiveValue, 'trial.objectiveValue');
      }
      await this.executor.query(
        `INSERT INTO research.hyperparameter_trials (
          experiment_id, trial_index, parameters, fold_metrics,
          objective_value, overfit_reasons, status
        ) VALUES ($1::uuid, $2, $3::jsonb, $4::jsonb, $5, $6::jsonb, $7)
        ON CONFLICT (experiment_id, trial_index) DO UPDATE SET
          parameters = EXCLUDED.parameters,
          fold_metrics = EXCLUDED.fold_metrics,
          objective_value = EXCLUDED.objective_value,
          overfit_reasons = EXCLUDED.overfit_reasons,
          status = EXCLUDED.status`,
        [
          trial.experimentId,
          trial.trialIndex,
          json(trial.parameters),
          json(trial.foldMetrics),
          trial.objectiveValue,
          json(trial.overfitReasons),
          trial.status,
        ],
      );
    }
  }
}

export class PostgresResearchStore implements ResearchStore {
  private readonly transaction: PostgresResearchTransaction;

  public constructor(private readonly pool: SqlPool) {
    this.transaction = new PostgresResearchTransaction(pool);
  }

  public appendMarketData(
    records: readonly ResearchMarketDataRecord[],
  ): Promise<void> {
    return this.transaction.appendMarketData(records);
  }

  public appendFeatures(features: readonly StoredFeatureValue[]): Promise<void> {
    return this.transaction.appendFeatures(features);
  }

  public appendSignals(signals: readonly StoredSignal[]): Promise<void> {
    return this.transaction.appendSignals(signals);
  }

  public saveBacktest(backtest: StoredBacktest): Promise<void> {
    return this.transaction.saveBacktest(backtest);
  }

  public saveOptimizationExperiment(
    experiment: StoredOptimizationExperiment,
  ): Promise<void> {
    return this.transaction.saveOptimizationExperiment(experiment);
  }

  public saveOptimizationTrials(
    trials: readonly StoredOptimizationTrial[],
  ): Promise<void> {
    return this.transaction.saveOptimizationTrials(trials);
  }

  public async withTransaction<T>(
    operation: (transaction: ResearchStoreTransaction) => Promise<T>,
  ): Promise<T> {
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN');
      const transaction = new PostgresResearchTransaction(connection);
      const result = await operation(transaction);
      await connection.query('COMMIT');
      return result;
    } catch (error: unknown) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  }

  public close(): Promise<void> {
    return this.pool.end();
  }
}
