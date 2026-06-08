import { bootstrapAuth } from "../modules/auth/auth.service.js";
import { closeDatabase } from "./client.js";
import { logger } from "../lib/logger.js";

/**
 * Standalone seed CLI: ensures the single user exists and an API token is
 * available. Invoked via `npm run db:seed`; the server runs the same
 * `bootstrapAuth` at startup, so this is only needed for out-of-band setup.
 */
bootstrapAuth()
  .then(() => closeDatabase())
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    logger.error({ err: error }, "Seed failed");
    process.exit(1);
  });
