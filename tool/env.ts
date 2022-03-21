import * as fs from "fs";
import dotenv from "dotenv";

export function getEnv(env: string) {
  const dotEnvFile =
    env === "production" ? ".env" : env === "develop" ? ".env.develop" : null;
  if (dotEnvFile == null) {
    throw new Error("unknown environment: " + env);
  }
  if (!fs.existsSync(dotEnvFile)) {
    throw new Error("dotenv not found: " + dotEnvFile);
  }
  return dotenv.parse(fs.readFileSync(dotEnvFile));
}
