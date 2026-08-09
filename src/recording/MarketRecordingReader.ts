import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import type { MarketRecordingSummary } from './marketRecordingFormat';
import {
  MarketRecordingParser,
  type MarketRecordingParserOptions,
} from './recordingValidation';

export class MarketRecordingReader {
  public constructor(
    private readonly parserOptions: MarketRecordingParserOptions = {},
  ) {}

  public async read(filePath: string): Promise<MarketRecordingSummary> {
    const parser = new MarketRecordingParser(this.parserOptions);
    const input = createInterface({
      input: createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Number.POSITIVE_INFINITY,
    });

    for await (const line of input) {
      if (line.trim().length > 0) {
        parser.parseLine(line);
      }
    }

    return parser.finish();
  }
}
