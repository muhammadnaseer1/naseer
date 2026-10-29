import internals from "@prisma/internals";
const { getGenerators } = internals;
import { defaultRegistry } from "@prisma/client-generator-registry";
// The JS driver-adapter client needs no native binaries. Use the official
// generator API directly so the CLI doesn't prefetch an unused schema engine.
const generators = await getGenerators({
  schemaPath: "prisma/schema.prisma",
  registry: defaultRegistry.toInternal(),
  cliCommand: "npm run db:generate",
  skipDownload: true,
});
try {
  for (const generator of generators) await generator.generate();
} finally {
  for (const generator of generators) generator.stop();
}
