import path from 'node:path';

export const isSafeCorrelatedAlertOutputPath = (
  outputPath: string,
  projectRoot: string = process.cwd(),
): boolean => {
  if (outputPath.includes('\0') || path.isAbsolute(outputPath)) {
    return !outputPath.includes('\0');
  }

  const resolvedRoot = path.resolve(projectRoot);
  const resolvedOutput = path.resolve(resolvedRoot, outputPath);
  const relative = path.relative(resolvedRoot, resolvedOutput);

  return (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};
