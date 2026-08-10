import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';

import { isErrorWithCode } from '../core/errorGuards';

const wait = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Durable same-directory replacement with bounded Windows rename retries. */
export const writeEvidenceJsonAtomically = async (
  targetPath: string,
  value: unknown,
): Promise<void> => {
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  const file = await open(temporaryPath, 'wx');
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }

  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rename(temporaryPath, targetPath);
        return;
      } catch (error: unknown) {
        const retryable =
          isErrorWithCode(error, 'EPERM') ||
          isErrorWithCode(error, 'EACCES') ||
          isErrorWithCode(error, 'EBUSY');
        if (!retryable || attempt === 4) throw error;
        await wait(10 * 2 ** attempt);
      }
    }
  } catch (renameError: unknown) {
    try {
      await unlink(temporaryPath);
    } catch (cleanupError: unknown) {
      if (!isErrorWithCode(cleanupError, 'ENOENT')) {
        throw new AggregateError(
          [renameError, cleanupError],
          'Atomic evidence replacement and temporary-file cleanup failed',
        );
      }
    }
    throw renameError;
  }
};
