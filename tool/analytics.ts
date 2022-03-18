import * as util from "util";
import * as fs from "fs";
import * as load from "./load";
import * as report from "./report";

async function getData(days: string[], jsonFile: string): Promise<void> {
  console.log("Fetching...");
  const result = {
    workerReqs: new Map<string, number>(),
    workerDurations: new Map<string, number>(), // GB*s
    durableObjectReqs: new Map<string, number>(),
    durableObjectWallTimes: new Map<string, number>(), // microsecond
    durableObjectCpuTimes: new Map<string, number>(), // microsecond
    durableObjectReads: new Map<string, number>(), // unit
    durableObjectWrites: new Map<string, number>(), // unit
    durableObjectDeletes: new Map<string, number>(), // unit
    durableObjectStored: new Map<string, number>(), // byte
  };
  const range = {
    firstDate: days[0],
    lastDate: days.at(-1),
  };
  for (const d of await load.workersInvocationsAdaptive(range)) {
    const date = d.dimensions.date;
    result.workerReqs.set(date, d.sum.requests);
    result.workerDurations.set(date, d.sum.duration);
  }
  for (const d of await load.durableObjectsInvocationsAdaptiveGroups(range)) {
    const date = d.dimensions.date;
    result.durableObjectReqs.set(date, d.sum.requests);
    result.durableObjectWallTimes.set(date, d.sum.wallTime);
  }
  for (const d of await load.durableObjectsStorageGroups(range)) {
    const date = d.dimensions.date;
    result.durableObjectStored.set(date, d.max.storedBytes);
  }
  for (const d of await load.durableObjectsPeriodicGroups(range)) {
    const date = d.dimensions.date;
    result.durableObjectCpuTimes.set(date, d.sum.cpuTime);
    result.durableObjectReads.set(date, d.sum.storageReadUnits);
    result.durableObjectWrites.set(date, d.sum.storageWriteUnits);
    result.durableObjectDeletes.set(date, d.sum.storageDeletes); // unit ではない？
  }
  console.log("result", util.inspect(result, { colors: true, depth: 20 }));
  const out = {
    days,
    workerReqs: [],
    workerDurations: [],
    durableObjectReqs: [],
    durableObjectWallTimes: [],
    durableObjectCpuTimes: [],
    durableObjectReads: [],
    durableObjectWrites: [],
    durableObjectDeletes: [],
    durableObjectStored: [],
  };
  for (const d of days) {
    out.workerReqs.push(result.workerReqs.get(d) ?? 0);
    out.workerDurations.push(result.workerDurations.get(d) ?? 0);
    out.durableObjectReqs.push(result.durableObjectReqs.get(d) ?? 0);
    out.durableObjectWallTimes.push(result.durableObjectWallTimes.get(d) ?? 0);
    out.durableObjectCpuTimes.push(result.durableObjectCpuTimes.get(d) ?? 0);
    out.durableObjectReads.push(result.durableObjectReads.get(d) ?? 0);
    out.durableObjectWrites.push(result.durableObjectWrites.get(d) ?? 0);
    out.durableObjectDeletes.push(result.durableObjectDeletes.get(d) ?? 0);
    out.durableObjectStored.push(result.durableObjectStored.get(d) ?? 0);
  }
  fs.writeFileSync(jsonFile, JSON.stringify(out, null, 2));
}
function get30DaysUntilToday(): string[] {
  const date = new Date();
  const dates = [];
  for (let i = 0; i < 30; i++) {
    const yyyymmdd = date.toISOString().slice(0, 10);
    dates.unshift(yyyymmdd);
    date.setDate(date.getDate() - 1);
  }
  return dates;
}

async function run(): Promise<void> {
  fs.mkdirSync("work", { recursive: true });
  const days = get30DaysUntilToday();
  const jsonFile = "work/data.json";
  await getData(days, jsonFile);
  const data = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
  const html = report.writeHTMLReport(data);
  const htmlFile = "work/index.html";
  fs.writeFileSync(htmlFile, html);
  console.log(`Done. Open ${htmlFile}.`);
}

run().catch((e) => {
  console.log(e);
  process.exit(1);
});
