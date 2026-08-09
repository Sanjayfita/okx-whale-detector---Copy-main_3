import { readTestnetOrderIntentDocument } from '../safety/testnetOrderIntentPersistence';

export interface InspectTestnetOrderIntentCliDependencies {
  readDocument?: typeof readTestnetOrderIntentDocument;
  log?: (message: string) => void;
  error?: (message: string) => void;
}

const readArgument = (args: readonly string[], name: string): string | null => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1]! : null;
};

export const runInspectTestnetOrderIntentCli = async (
  args: readonly string[],
  dependencies: InspectTestnetOrderIntentCliDependencies = {},
): Promise<number> => {
  const filePath = readArgument(args, '--file');
  const log = dependencies.log ?? console.log;
  const error = dependencies.error ?? console.error;

  if (filePath === null || filePath.trim() === '') {
    error('Usage: safety:inspect-testnet-intent -- --file <intent.json>');
    return 2;
  }

  try {
    const readDocument = dependencies.readDocument ?? readTestnetOrderIntentDocument;
    const document = await readDocument(filePath);
    const intent = document.intent;

    log('TESTNET ORDER INTENT');
    log(`File: ${filePath}`);
    log(`Schema version: ${document.schemaVersion}`);
    log(`Generator version: ${document.generatorVersion}`);
    log(`Document generated at: ${document.generatedAt}`);
    log(`Intent created at: ${intent.createdAt}`);
    log(`Status: ${intent.status}`);
    log(`Environment: ${intent.environment}`);
    log(`Instrument: ${intent.instrumentId}`);
    log(`Side: ${intent.side}`);
    log(`Order type: ${intent.orderType}`);
    log(`Quantity: ${intent.quantity}`);
    log(`Reference price: ${intent.referencePrice}`);
    log(`Limit price: ${intent.limitPrice ?? 'none'}`);
    log(`Estimated notional: ${intent.estimatedNotional}`);
    log(`Maximum notional: ${intent.maximumNotional}`);
    log(`Dry run only: ${intent.dryRunOnly}`);
    log(`Transport dispatch allowed: ${intent.transportDispatchAllowed}`);
    log(`Testnet execution authorized: ${intent.testnetExecutionAuthorized}`);
    log(`Order execution authorized: ${intent.orderExecutionAuthorized}`);

    for (const reason of intent.reasons) {
      log(`REASON | ${reason}`);
    }

    return intent.status === 'REJECTED' ? 1 : 0;
  } catch (cause) {
    error(
      `Testnet order intent inspection failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    return 2;
  }
};

if (require.main === module) {
  void runInspectTestnetOrderIntentCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
