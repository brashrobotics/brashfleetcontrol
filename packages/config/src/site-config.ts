export interface SiteConfig {
  siteId: string;
}

export function loadSiteConfig(environment: NodeJS.ProcessEnv = process.env): SiteConfig {
  const siteId = environment.FLEET_SITE_ID?.trim() || (environment.NODE_ENV === "production" ? "" : "plant-a");
  if (!siteId) throw new Error("FLEET_SITE_ID is required when NODE_ENV=production.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(siteId)) throw new Error("FLEET_SITE_ID must be a lowercase kebab-case identifier.");
  return { siteId };
}
