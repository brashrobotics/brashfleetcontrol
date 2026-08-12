import { loadPersistenceConfig } from "@brash/config";
import { PostgresPersistence } from "@brash/persistence";

const config = loadPersistenceConfig({
  ...process.env,
  FLEET_PERSISTENCE: "postgres",
});
const persistence = new PostgresPersistence(config.database!);

try {
  await persistence.migrate();
  console.log("Fleet database migrations are up to date.");
} finally {
  await persistence.close();
}
