import { createDry } from "@drystack/astro/dry";
import config from "../../drystack.config";

// One shared instance for the whole app - safe because .singleton() never
// caches a resolved value across calls (see createDry's doc comment in
// @drystack/astro/dry), so every call site still reads fresh content.
export const dry = createDry(config);
