import * as fs from "fs";
import dotenv from "dotenv";
import { execSync } from "child_process";

const env = process.argv[2];
if (env == null) {
  throw new Error("arg not found");
}
const dotEnvFile =
  env === "production" ? ".env" : env === "develop" ? ".env.develop" : null;
if (dotEnvFile == null) {
  throw new Error("unknown environment: " + env);
}
if (!fs.existsSync(dotEnvFile)) {
  throw new Error("dotenv not found: " + dotEnvFile);
}
const envFlag =
  env === "production" ? "--env production" : env === "develop" ? "" : null;
if (envFlag == null) {
  throw new Error("unknown environment: " + env);
}
const config = dotenv.parse(fs.readFileSync(dotEnvFile));

const list = execSync("npx wrangler secret list", { encoding: "utf8" });
const existingKeys = JSON.parse(list).map((item) => item.name);

const keysToSync = [
  "AUTH_TYPE",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_ORG",
  "SLACK_CLIENT_ID",
  "SLACK_CLIENT_SECRET",
  "COOKIE_SECRET",
  "SLACK_APP",
  "SLACK_SIGNING_SECRET",
  "DEBUG_API",
  "ADMIN_KEY",
];
for (const key of keysToSync) {
  if (config[key] != null) {
    execSync(`npx wrangler secret put ${envFlag} ${key}`, {
      input: config[key],
      stdio: ["pipe", "inherit", "inherit"],
    });
  }
}
for (const key of existingKeys) {
  if (config[key] == null) {
    execSync(`npx wrangler secret delete ${envFlag} ${key}`, {
      input: "y",
      stdio: ["pipe", "inherit", "inherit"],
    });
  }
}
