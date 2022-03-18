import fetch from "node-fetch";
import * as util from "util";
import * as fs from "fs";

const CLOUDFLARE_API_KEY = process.env.CLOUDFLARE_API_KEY;
const accountTag = "7e155f728b0311833218e72046aaa90a";
const scriptName = "whiteboard";

function graphql(s: TemplateStringsArray): string {
  return s.join("");
}

async function workersInvocationsAdaptive() {
  const q = graphql`
    query workersInvocationsAdaptive(
      $accountTag: string
      $date_geq: string
      $date_leq: string
      $scriptName: string
    ) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptive(
            limit: 100
            filter: {
              date_geq: $date_geq
              date_leq: $date_leq
              scriptName: $scriptName
            }
            orderBy: [date_DESC]
          ) {
            max {
              cpuTime
              duration
              wallTime
              responseBodySize
            }
            sum {
              requests
              subrequests
              errors
              duration
              wallTime
              responseBodySize
            }
            dimensions {
              date
            }
          }
        }
      }
    }
  `;
  const data = await send(q, {
    accountTag,
    date_geq: "2022-02-17",
    date_leq: "2022-03-17",
    scriptName,
  });
  return data.viewer.accounts[0].workersInvocationsAdaptive;
}

async function durableObjectsInvocationsAdaptiveGroups() {
  const q = graphql`
    query durableObjectsInvocationsAdaptiveGroups(
      $accountTag: string
      $date_geq: string
      $date_leq: string
      $scriptName: string
    ) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          durableObjectsInvocationsAdaptiveGroups(
            limit: 100
            filter: {
              date_geq: $date_geq
              date_leq: $date_leq
              scriptName: $scriptName
            }
            orderBy: [date_DESC]
          ) {
            quantiles {
              responseBodySizeP50
              wallTimeP50
            }
            max {
              responseBodySize
              wallTime
            }
            sum {
              requests
              errors
              responseBodySize
              wallTime
            }
            dimensions {
              date
              # namespaceId
              # objectId
            }
          }
        }
      }
    }
  `;
  const data = await send(q, {
    accountTag,
    date_geq: "2022-02-17",
    date_leq: "2022-03-17",
    scriptName,
  });
  return data.viewer.accounts[0].durableObjectsInvocationsAdaptiveGroups;
}
async function durableObjectsStorageGroups() {
  const q = graphql`
    query durableObjectsStorageGroups(
      $accountTag: string
      $date_geq: string
      $date_leq: string
    ) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          durableObjectsStorageGroups(
            limit: 100
            filter: { date_geq: $date_geq, date_leq: $date_leq }
            orderBy: [date_DESC]
          ) {
            max {
              storedBytes
            }
            dimensions {
              date
            }
          }
        }
      }
    }
  `;
  const data = await send(q, {
    accountTag,
    date_geq: "2022-02-17",
    date_leq: "2022-03-17",
  });
  return data.viewer.accounts[0].durableObjectsStorageGroups;
}

async function durableObjectsPeriodicGroups() {
  const q = graphql`
    query durableObjectsPeriodicGroups(
      $accountTag: string
      $date_geq: string
      $date_leq: string
    ) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          durableObjectsPeriodicGroups(
            limit: 100
            filter: { date_geq: $date_geq, date_leq: $date_leq }
            orderBy: [date_DESC]
          ) {
            max {
              activeWebsocketConnections
            }
            sum {
              cpuTime
              activeTime
              subrequests
              storageDeletes
              storageReadUnits
              exceededCpuErrors
              storageWriteUnits
              fatalInternalErrors
              exceededMemoryErrors
              inboundWebsocketMsgCount
              outboundWebsocketMsgCount
            }
            dimensions {
              # namespaceId
              date
            }
          }
        }
      }
    }
  `;
  const data = await send(q, {
    accountTag,
    date_geq: "2022-02-17",
    date_leq: "2022-03-17",
  });
  return data.viewer.accounts[0].durableObjectsPeriodicGroups;
}

async function send(query: string, variables: Record<string, string>) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/graphql/`, {
    method: "POST",
    body: JSON.stringify({
      query,
      variables,
    }),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CLOUDFLARE_API_KEY}`,
    },
  });
  const { data, errors } = await res.json();
  if (errors != null) {
    throw new Error(JSON.stringify(errors));
  }
  return data;
}

async function getData(days: string[]): Promise<any> {
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
  {
    const data = await workersInvocationsAdaptive();
    console.log(
      "workersInvocationsAdaptive",
      util.inspect(data, { colors: true, depth: 20 })
    );
    for (const d of data) {
      const date = d.dimensions.date;
      result.workerReqs.set(date, d.sum.requests);
      result.workerDurations.set(date, d.sum.duration);
    }
  }
  {
    const data = await durableObjectsInvocationsAdaptiveGroups();
    console.log(
      "durableObjectsInvocationsAdaptiveGroups",
      util.inspect(data, { colors: true, depth: 20 })
    );
    for (const d of data) {
      const date = d.dimensions.date;
      result.durableObjectReqs.set(date, d.sum.requests);
      result.durableObjectWallTimes.set(date, d.sum.wallTime);
    }
  }
  {
    const data = await durableObjectsStorageGroups();
    console.log(
      "durableObjectsStorageGroups",
      util.inspect(data, { colors: true, depth: 20 })
    );
    for (const d of data) {
      const date = d.dimensions.date;
      result.durableObjectStored.set(date, d.max.storedBytes);
    }
  }
  {
    const data = await durableObjectsPeriodicGroups();
    console.log(
      "durableObjectsPeriodicGroups",
      util.inspect(data, { colors: true, depth: 20 })
    );
    for (const d of data) {
      const date = d.dimensions.date;
      result.durableObjectCpuTimes.set(date, d.sum.cpuTime);
      result.durableObjectReads.set(date, d.sum.storageReadUnits);
      result.durableObjectWrites.set(date, d.sum.storageWriteUnits);
      result.durableObjectDeletes.set(date, d.sum.storageDeletes); // unit ではない？
    }
  }
  const a = {
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
  for (const day of days) {
    a.workerReqs.push(result.workerReqs.get(day) ?? 0);
    a.workerDurations.push(result.workerDurations.get(day) ?? 0);
    a.durableObjectReqs.push(result.durableObjectReqs.get(day) ?? 0);
    a.durableObjectWallTimes.push(result.durableObjectWallTimes.get(day) ?? 0);
    a.durableObjectCpuTimes.push(result.durableObjectCpuTimes.get(day) ?? 0);
    a.durableObjectReads.push(result.durableObjectReads.get(day) ?? 0);
    a.durableObjectWrites.push(result.durableObjectWrites.get(day) ?? 0);
    a.durableObjectDeletes.push(result.durableObjectDeletes.get(day) ?? 0);
    a.durableObjectStored.push(result.durableObjectStored.get(day) ?? 0);
  }
  return a;
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
  {
    const data = await getData(days);
    console.log(
      "raw",
      util.inspect(data, { colors: true, depth: 20, breakLength: 200 })
    );
    fs.writeFileSync("work/data.json", JSON.stringify(data, null, 2));
  }
  const data = JSON.parse(fs.readFileSync("work/data.json") as any);
  const workerReqsTotal = data.workerReqs.reduce((a, b) => a + b, 0);
  console.log("workerReqsTotal", workerReqsTotal, "/", 1000 * 1000);
  const chart1 = renderOneChart("worker-reqs", "workers requests", {
    type: "line",
    data: {
      labels: days.map((d) => d.slice(5)),
      datasets: [
        {
          borderColor: "#36a",
          backgroundColor: "#36a",
          label: "Requests",
          data: data.workerReqs,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
    },
  });
  const workerDurationsTotal = data.workerDurations.reduce((a, b) => a + b, 0);
  console.log(
    "workerDurationsTotal",
    Math.floor(workerDurationsTotal),
    "/",
    400 * 1000
  );
  const chart2 = renderOneChart("worker-durations", "workers durations", {
    type: "line",
    data: {
      labels: days.map((d) => d.slice(5)),
      datasets: [
        {
          borderColor: "#36a",
          backgroundColor: "#36a",
          label: "Durations",
          data: data.workerDurations,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
    },
  });
  const pichart1 = renderOneChart("worker-requests-pie", "workers requests", {
    type: "pie",
    data: {
      labels: ["Used"],
      datasets: [
        {
          borderColor: ["#36a", "#eee"],
          backgroundColor: ["#36a", "#eee"],
          label: "Requests",
          data: [workerReqsTotal, 1000 * 1000 - workerReqsTotal],
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
    },
  });
  const pichart2 = renderOneChart("worker-durations-pie", "workers durations", {
    type: "pie",
    data: {
      labels: ["Used"],
      datasets: [
        {
          borderColor: ["#36a", "#eee"],
          backgroundColor: ["#36a", "#eee"],
          label: "Duration",
          data: [workerDurationsTotal, 400 * 1000 - workerDurationsTotal],
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
    },
  });

  const durableObjectReqsTotal = data.durableObjectReqs.reduce(
    (a, b) => a + b,
    0
  );
  console.log(
    "durableObjectReqsTotal",
    durableObjectReqsTotal,
    "/",
    1000 * 1000
  );
  const chart3 = renderOneChart(
    "durable-object-requests",
    "durable object requests",
    {
      type: "line",
      data: {
        labels: days.map((d) => d.slice(5)),
        datasets: [
          {
            borderColor: "#36a",
            backgroundColor: "#36a",
            label: "Requests",
            data: data.durableObjectReqs,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
      },
    }
  );
  const durableObjectWallTimes = data.durableObjectWallTimes.map(
    (microsecs) => ((microsecs / 1000 / 1000) * 128) / 1000
  ); // GB*s
  const durableObjectCpuTimes = data.durableObjectCpuTimes.map(
    (microsecs) => ((microsecs / 1000 / 1000) * 128) / 1000
  ); // GB*s
  const durableObjectDurationTotal = Math.max(
    durableObjectWallTimes.reduce((a, b) => a + b, 0),
    durableObjectCpuTimes.reduce((a, b) => a + b, 0)
  ); // GB*s
  console.log(
    "durableObjectDurationTotal",
    Math.floor(durableObjectDurationTotal),
    "/",
    400 * 1000
  );

  const chart4 = renderOneChart(
    "durable-object-durations",
    "durable object durations",
    {
      type: "line",
      data: {
        labels: days.map((d) => d.slice(5)),
        datasets: [
          {
            borderColor: "#36a",
            backgroundColor: "#36a",
            label: "Wall times",
            data: durableObjectWallTimes,
          },
          {
            borderColor: "#a63",
            backgroundColor: "#a63",
            label: "CPU times",
            data: durableObjectCpuTimes,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
      },
    }
  );
  const pichart3 = renderOneChart(
    "durable-object-requests-pie",
    "durable object requests",
    {
      type: "pie",
      data: {
        labels: ["Used"],
        datasets: [
          {
            borderColor: ["#36a", "#eee"],
            backgroundColor: ["#36a", "#eee"],
            label: "Duration",
            data: [
              durableObjectReqsTotal,
              1000 * 1000 - durableObjectReqsTotal,
            ],
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
      },
    }
  );
  const pichart4 = renderOneChart(
    "durable-object-durations-pie",
    "durable object durations",
    {
      type: "pie",
      data: {
        labels: ["Used"],
        datasets: [
          {
            borderColor: ["#36a", "#eee"],
            backgroundColor: ["#36a", "#eee"],
            label: "Duration",
            data: [
              durableObjectDurationTotal,
              400 * 1000 - durableObjectDurationTotal,
            ],
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
      },
    }
  );

  const durableObjectReadsTotal = data.durableObjectReads.reduce(
    (a, b) => a + b,
    0
  );
  console.log(
    "durableObjectReadsTotal",
    durableObjectReadsTotal,
    "/",
    1000 * 1000
  );
  const durableObjectWritesTotal = data.durableObjectWrites.reduce(
    (a, b) => a + b,
    0
  );
  console.log(
    "durableObjectWritesTotal",
    durableObjectWritesTotal,
    "/",
    1000 * 1000
  );
  const durableObjectDeletesTotal = data.durableObjectDeletes.reduce(
    (a, b) => a + b,
    0
  );
  console.log(
    "durableObjectDeletesTotal",
    durableObjectDeletesTotal,
    "/",
    1000 * 1000
  );
  const chart5 = renderOneChart(
    "durable-storage-requests",
    "durable storage requests",
    {
      type: "line",
      data: {
        labels: days.map((d) => d.slice(5)),
        datasets: [
          {
            borderColor: "#36a",
            backgroundColor: "#36a",
            label: "Reads",
            data: data.durableObjectReads,
          },
          {
            borderColor: "#6a3",
            backgroundColor: "#6a3",
            label: "Writes",
            data: data.durableObjectWrites,
          },
          {
            borderColor: "#a36",
            backgroundColor: "#a36",
            label: "Deletes",
            data: data.durableObjectDeletes,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
      },
    }
  );
  const pichart5a = renderOneChart(
    "durable-storage-reads-pie",
    "durable storage reads",
    {
      type: "pie",
      data: {
        labels: ["Used"],
        datasets: [
          {
            borderColor: ["#36a", "#eee"],
            backgroundColor: ["#36a", "#eee"],
            label: "Duration",
            data: [
              durableObjectReadsTotal,
              1000 * 1000 - durableObjectReadsTotal,
            ],
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
      },
    },
    true
  );
  const pichart5b = renderOneChart(
    "durable-storage-writes-pie",
    "durable storage writes",
    {
      type: "pie",
      data: {
        labels: ["Used"],
        datasets: [
          {
            borderColor: ["#6a3", "#eee"],
            backgroundColor: ["#6a3", "#eee"],
            label: "Duration",
            data: [
              durableObjectWritesTotal,
              1000 * 1000 - durableObjectWritesTotal,
            ],
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
      },
    },
    true
  );
  const pichart5c = renderOneChart(
    "durable-storage-deletes-pie",
    "durable storage deletes",
    {
      type: "pie",
      data: {
        labels: ["Used"],
        datasets: [
          {
            borderColor: ["#a36", "#eee"],
            backgroundColor: ["#a36", "#eee"],
            label: "Duration",
            data: [
              durableObjectDeletesTotal,
              1000 * 1000 - durableObjectDeletesTotal,
            ],
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
      },
    },
    true
  );

  const durableObjectStoredMax = data.durableObjectStored.reduce(
    (a, b) => Math.max(a, b),
    0
  );
  console.log(
    "durableObjectStoredMax",
    durableObjectStoredMax,
    "/",
    1000 * 1000 * 1000
  );
  const chart6 = renderOneChart(
    "durable-storage-amount",
    "durable storage amount",
    {
      type: "line",
      data: {
        labels: days.map((d) => d.slice(5)),
        datasets: [
          {
            borderColor: "#36a",
            backgroundColor: "#36a",
            label: "Amount",
            data: data.durableObjectStored,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
      },
    }
  );
  const pichart6 = renderOneChart(
    "durable-storage-amount-pie",
    "durable storage amount",
    {
      type: "pie",
      data: {
        labels: ["Used"],
        datasets: [
          {
            borderColor: ["#36a", "#eee"],
            backgroundColor: ["#36a", "#eee"],
            label: "Amount",
            data: [
              durableObjectStoredMax,
              1000 * 1000 * 1000 - durableObjectStoredMax,
            ],
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
      },
    },
    true
  );

  const html = `
<html>
<head>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@3.7.1/dist/chart.min.js"></script>
  <style>
  h2 { font-size: 20px; }
  .raw { margin-bottom: 40px; display: flex; gap: 20px; }
  </style>
</head>
<body>
  <h2>Worker</h2>
  <div class="raw">${chart1}${chart2}</div>
  <div class="raw">${pichart1}${pichart2}</div>
  <h2>Durable Object</h2>
  <div class="raw">${chart3}${chart4}</div>
  <div class="raw">${pichart3}${pichart4}</div>
  <h2>Durable Storage</h2>
  <div class="raw">${chart5}${chart6}</div>
  <div class="raw">${pichart5a}${pichart5b}${pichart5c}${pichart6}</div>
</body>
</html>
  `;

  fs.writeFileSync("work/index.html", html);
}

function renderOneChart(
  id: string,
  title: string,
  settings: any,
  half = false
) {
  return `
<div class="chart-container" style="position: relative; height:200px; width: ${
    half ? 200 : 400
  }px;">
  <canvas id="${id}"></canvas>
</div>
<script>
(() => {
  const ctx = document.getElementById('${id}').getContext('2d');
  const chart = new Chart(ctx, ${JSON.stringify(settings)});
})();
</script>
  `;
}

run().catch((e) => {
  console.log(e);
  process.exit(1);
});
