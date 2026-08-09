import { createServer, type Server } from 'node:http';

import { generateEvidenceProfitabilityReport } from './generateEvidenceProfitability';
import { generateStatisticalValidationReport } from './generateStatisticalValidation';

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const format = (value: number | null): string =>
  value !== null && Number.isFinite(value) ? value.toFixed(4) : 'N/A';

export const renderEvidenceDashboardHtml = async (
  evaluationId: string,
): Promise<string> => {
  const [report, statistics] = await Promise.all([
    generateEvidenceProfitabilityReport({ evaluationId }),
    generateStatisticalValidationReport({
      evaluationId,
      bootstrapIterations: 500,
    }),
  ]);
  const row = (group: (typeof report.byHorizon)[number]): string => `
    <tr>
      <td>${escapeHtml(group.key)}</td>
      <td>${group.observations}</td>
      <td>${format(group.winRatePercent)}%</td>
      <td>${format(group.averageGrossReturnPercent)}%</td>
      <td>${format(group.averageNetReturnPercent)}%</td>
      <td>${format(group.netExpectancyUsdt)}</td>
      <td>${format(group.hypotheticalNetPnlUsdt)}</td>
      <td>${format(group.averageMfePercent)}%</td>
      <td>${format(group.averageMaePercent)}%</td>
    </tr>`;

  const groupTable = (
    title: string,
    groups: typeof report.byHorizon,
  ): string => `
    <section class="panel">
      <h2>${title}</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Group</th><th>Obs.</th><th>Win rate</th><th>Gross avg.</th><th>Net avg.</th><th>Net expectancy</th><th>Net PnL</th><th>MFE</th><th>MAE</th></tr></thead>
        <tbody>${groups.map(row).join('')}</tbody>
      </table></div>
    </section>`;
  const statisticalReasons =
    statistics.reasons.length === 0
      ? '<li>No blocking statistical reasons.</li>'
      : statistics.reasons
          .map((reason) => `<li>${escapeHtml(reason)}</li>`)
          .join('');
  const primaryHorizon = report.policy.primaryHorizonMinutes;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="30"><title>OKX Evidence Profitability Dashboard</title>
<style>
:root{font-family:Inter,Segoe UI,Arial,sans-serif;color:#e8eef8;background:#08111f}body{margin:0;padding:24px;background:linear-gradient(135deg,#08111f,#10233d);min-height:100vh}.wrap{max-width:1280px;margin:auto}.header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.badge{background:#103b2c;border:1px solid #2dd481;color:#aaf2d0;padding:10px 14px;border-radius:10px;font-weight:700}.warning{background:#3a2810;border-color:#e7a63b;color:#ffe0a6}.blocked{background:#401b22;border-color:#ff6f7d;color:#ffc1c8}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin:22px 0}.card,.panel{background:rgba(15,31,53,.94);border:1px solid #284769;border-radius:14px;padding:18px;box-shadow:0 12px 30px rgba(0,0,0,.22)}.label{color:#90a8c4;font-size:.82rem;text-transform:uppercase;letter-spacing:.08em}.value{font-size:1.65rem;font-weight:750;margin-top:6px}.panel{margin-top:16px}h1,h2{margin-top:0}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:820px}th,td{text-align:right;padding:10px;border-bottom:1px solid #263f5d}th:first-child,td:first-child{text-align:left}th{color:#9fb6d0}.footer{color:#8fa4bd;margin:20px 4px;font-size:.9rem}code{color:#a9d6ff}.positive{color:#52df9d}.negative{color:#ff8d8d}li{margin:8px 0}
</style></head><body><main class="wrap">
<div class="header"><div><h1>Evidence Profitability Dashboard</h1><p>Evaluation: <code>${escapeHtml(report.evaluationId)}</code> · refreshes every 30 seconds</p></div><div class="badge">READ ONLY · EXECUTION DISABLED</div></div>
<div class="cards">
<div class="card"><div class="label">Raw qualified alerts</div><div class="value">${report.qualifiedAlerts}</div></div>
<div class="card"><div class="label">Completed horizon observations</div><div class="value">${report.completedObservations}</div></div>
<div class="card"><div class="label">Primary horizon</div><div class="value">${primaryHorizon}m</div></div>
<div class="card"><div class="label">Primary-horizon outcomes</div><div class="value">${report.primaryHorizonCompleteAlerts}</div></div>
<div class="card"><div class="label">Independent episodes</div><div class="value">${report.independentPrimaryHorizonAlerts}</div></div>
<div class="card"><div class="label">Overlapping alerts</div><div class="value">${report.dependentPrimaryHorizonAlerts}</div></div>
<div class="card"><div class="label">${primaryHorizon}m win rate</div><div class="value">${format(report.overall.winRatePercent)}%</div></div>
<div class="card"><div class="label">${primaryHorizon}m net expectancy / alert</div><div class="value ${report.overall.netExpectancyUsdt >= 0 ? 'positive' : 'negative'}">${format(report.overall.netExpectancyUsdt)} USDT</div></div>
<div class="card"><div class="label">${primaryHorizon}m hypothetical net PnL</div><div class="value ${report.overall.hypotheticalNetPnlUsdt >= 0 ? 'positive' : 'negative'}">${format(report.overall.hypotheticalNetPnlUsdt)} USDT</div></div>
<div class="card"><div class="label">Estimated round-trip cost</div><div class="value">${format(report.policy.roundTripCostPercent)}%</div></div>
<div class="card"><div class="label">Independent bootstrap lower bound</div><div class="value ${statistics.overallConfidenceInterval.lower > 0 ? 'positive' : 'negative'}">${format(statistics.overallConfidenceInterval.lower)}%</div></div>
<div class="card"><div class="label">Purged independent test mean</div><div class="value ${statistics.chronologicalSplit.testMeanNetReturnPercent > 0 ? 'positive' : 'negative'}">${format(statistics.chronologicalSplit.testMeanNetReturnPercent)}%</div></div>
<div class="card"><div class="label">Unmatched observations</div><div class="value">${report.unmatchedObservations}</div></div>
<div class="card"><div class="label">Malformed records</div><div class="value">${report.malformedRecords}</div></div>
</div>
${report.insufficientData ? '<div class="badge warning">INSUFFICIENT DATA: fewer than 100 independent primary-horizon episodes. Do not treat this as profitability proof.</div>' : ''}
<div class="badge ${statistics.readyForQualification ? '' : 'blocked'}">STATISTICAL QUALIFICATION: ${statistics.readyForQualification ? 'READY' : 'BLOCKED'}</div>
<section class="panel"><h2>Statistical validation</h2><p>Inference uses ${statistics.independentAlerts} non-overlapping ${statistics.primaryHorizonMinutes}m episodes. Block-bootstrap ${format(statistics.overallConfidenceInterval.confidenceLevel * 100)}% interval: <strong>${format(statistics.overallConfidenceInterval.lower)}%</strong> to <strong>${format(statistics.overallConfidenceInterval.upper)}%</strong>. Purged chronological split: ${statistics.chronologicalSplit.trainCount} train / ${statistics.chronologicalSplit.validationCount} validation / ${statistics.chronologicalSplit.testCount} test observations.</p><ul>${statisticalReasons}</ul></section>
${groupTable('Descriptive performance by horizon', report.byHorizon)}
${groupTable(`Primary ${primaryHorizon}m performance by instrument`, report.byInstrument)}
${groupTable(`Primary ${primaryHorizon}m performance by direction`, report.byDirection)}
<section class="panel"><h2>Frozen paper policy</h2><p>Primary holding horizon: ${primaryHorizon} minutes · Starting capital: ${format(report.policy.startingCapital)} USDT · Fixed notional: ${format(report.policy.positionNotional)} USDT per alert · No leverage · No compounding · Estimated round-trip cost: ${format(report.policy.roundTripCostPercent)}%</p></section>
<p class="footer">Research analytics only. This page cannot submit orders, access private OKX APIs, or authorize execution. Generated at ${new Date(report.generatedAt).toISOString()}.</p>
</main></body></html>`;
};

export const createEvidenceDashboardServer = (evaluationId: string): Server =>
  createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
      });
      response.end(
        JSON.stringify({
          status: 'ok',
          mode: 'research-only',
          liveOrderExecutionAllowed: false,
          orderExecutionAuthorized: false,
        }),
      );
      return;
    }
    void renderEvidenceDashboardHtml(evaluationId)
      .then((html) => {
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        });
        response.end(html);
      })
      .catch((error: unknown) => {
        response.writeHead(500, {
          'content-type': 'text/plain; charset=utf-8',
        });
        response.end(error instanceof Error ? error.message : String(error));
      });
  });

const main = (): void => {
  const evaluationId = process.argv[2] ?? 'eval-2026-08-02-v1';
  const port = Number(process.env.EVIDENCE_DASHBOARD_PORT ?? 4173);
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
    throw new Error('EVIDENCE_DASHBOARD_PORT must be a valid port');
  }
  const server = createEvidenceDashboardServer(evaluationId);
  server.listen(port, '127.0.0.1', () => {
    console.log(`Evidence profitability dashboard: http://127.0.0.1:${port}`);
    console.log(`Evaluation ID: ${evaluationId}`);
    console.log(
      'Read-only research dashboard. Live order execution remains disabled.',
    );
  });
  const stop = (): void => {
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
};

if (require.main === module) main();
