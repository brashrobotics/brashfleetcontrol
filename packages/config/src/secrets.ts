import { readFileSync, statSync } from "node:fs";

export interface SecretResolutionOptions {
  required?: boolean;
  maxBytes?: number;
}

/** Resolves NAME or NAME_FILE, never both, without logging secret material. */
export function resolveSecret(
  name: string,
  environment: NodeJS.ProcessEnv = process.env,
  options: SecretResolutionOptions = {},
): string | undefined {
  const direct = environment[name];
  const fileName = environment[`${name}_FILE`]?.trim();
  if (direct !== undefined && fileName) throw new Error(`${name} and ${name}_FILE are mutually exclusive.`);

  let value = direct;
  if (fileName) {
    const stat = statSync(fileName);
    if (!stat.isFile()) throw new Error(`${name}_FILE must reference a regular file.`);
    const maxBytes = options.maxBytes ?? 1_048_576;
    if (stat.size > maxBytes) throw new Error(`${name}_FILE exceeds the ${maxBytes}-byte limit.`);
    value = readFileSync(fileName, "utf8").replace(/\r?\n$/, "");
  }
  if (value?.includes("\0")) throw new Error(`${name} contains an invalid null byte.`);
  if (options.required && !value) throw new Error(`${name} or ${name}_FILE is required.`);
  return value || undefined;
}
