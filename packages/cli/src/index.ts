import { main } from "./main.js";
import { nodeDeps } from "./nodeDeps.js";

process.exitCode = await main(process.argv.slice(2), nodeDeps());
