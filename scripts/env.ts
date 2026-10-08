// Loads .env.local then .env for scripts run outside Next.js.
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
