import { readAlertQualityThresholdEvaluations } from '../evaluation';

export const runInspectAlertQualityThresholdEvaluationsCli = async (
  args: readonly string[],
  dependencies: { log?: (...values: unknown[]) => void; error?: (...values: unknown[]) => void } = {},
): Promise<number> => {
  const log = dependencies.log ?? console.log;
  const errorLog = dependencies.error ?? console.error;
  try {
    if (args.length !== 2 || args[0] !== '--file' || !args[1]) {
      throw new Error('Usage: --file <threshold-evaluations.jsonl>');
    }
    const result = await readAlertQualityThresholdEvaluations(args[1]);
    log('ALERT QUALITY THRESHOLD EVALUATIONS');
    log(`Valid evaluations: ${result.evaluations.length}`);
    log(`Exact duplicates: ${result.exactDuplicateCount}`);
    log(`Read issues: ${result.issues.length}`);
    result.evaluations.forEach((evaluation) => {
      log(`${evaluation.evaluationRunId} @ ${evaluation.generatedAt}`);
      log(`Source report: ${evaluation.sourceReportRunId} @ ${evaluation.sourceReportGeneratedAt}`);
      log(`Policy fingerprint: ${evaluation.policyFingerprint}`);
      log(`PASS=${evaluation.passedCount} FAIL=${evaluation.failedCount} INSUFFICIENT_DATA=${evaluation.insufficientDataCount}`);
    });
    result.issues.forEach((issue) => {
      log(`ISSUE line=${issue.lineNumber} reason=${issue.reason} message=${issue.message}`);
    });
    log('Research analytics only. This output is not a trading recommendation.');
    return result.issues.length === 0 ? 0 : 1;
  } catch (error: unknown) {
    errorLog('Alert-quality threshold evaluation inspection failed:', error instanceof Error ? error.message : error);
    return 1;
  }
};

if (require.main === module) {
  void runInspectAlertQualityThresholdEvaluationsCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
