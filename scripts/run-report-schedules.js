import "dotenv/config";
import { runScheduledReports } from "../app/services/report-schedules-runner.server.js";

(async () => {
  try {
    await runScheduledReports();
  } catch (error) {
    console.error("Scheduled report runner failed", error);
    process.exit(1);
  }
})();
