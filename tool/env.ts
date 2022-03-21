import * as fs from "fs";
import dotenv from "dotenv";

export function getEnv(env: string) {
  const dotEnvFile = `.env.${env}`;
  if (!fs.existsSync(dotEnvFile)) {
    throw new Error("dotenv not found: " + dotEnvFile);
  }
  return dotenv.parse(fs.readFileSync(dotEnvFile));
}
