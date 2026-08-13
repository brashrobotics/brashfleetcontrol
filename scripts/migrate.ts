import { loadPersistenceConfig, loadSiteConfig } from "@brash/config";
import { PostgresPersistence } from "@brash/persistence";

const config = loadPersistenceConfig({
  ...process.env,
  FLEET_PERSISTENCE: "postgres",
});
const persistence = new PostgresPersistence(config.database!);

try {
  await persistence.migrate();
  await persistence.bindSite(loadSiteConfig().siteId);
  console.log("Fleet database migrations are up to date.");
} finally {
  await persistence.close();
}
