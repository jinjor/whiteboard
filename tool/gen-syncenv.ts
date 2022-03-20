import * as fs from "fs";
import dotenv from "dotenv";

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
const config = dotenv.parse(fs.readFileSync(dotEnvFile));

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
const lines = [];
lines.push("#!/bin/sh");
lines.push("set -e");
for (const key of keysToSync) {
  if (config[key] != null) {
    const envFlag =
      env === "production" ? "--env production" : env === "develop" ? "" : null;
    if (envFlag == null) {
      continue;
    }
    lines.push(
      `echo ${config[key]} | npx wrangler secret put ${envFlag} ${key}`
    );
  }
}
const shellFile = `sync.${env}.sh`;
fs.writeFileSync(shellFile, lines.join("\n"));
fs.chmodSync(shellFile, 0o755);
