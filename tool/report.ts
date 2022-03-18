// https://developers.cloudflare.com/workers/platform/pricing
const WORKER_REQ_LIMIT = 1000 * 1000;
const WORKER_DURATION_LIMIT = 400 * 1000;
const DURABLE_OBJECT_REQ_LIMIT = 1000 * 1000;
const DURABLE_OBJECT_DURATION_LIMIT = 400 * 1000;
const DURABLE_STORAGE_READ_LIMIT = 1000 * 1000;
const DURABLE_STORAGE_WRITE_LIMIT = 1000 * 1000;
const DURABLE_STORAGE_DELETE_LIMIT = 1000 * 1000;
const DURABLE_STORAGE_AMOUNT_LIMIT = 1000 * 1000 * 1000;

function sum(array: number[]) {
  return array.reduce((a, b) => a + b, 0);
}
const color1 = "#36a";
const color2 = "#a63";
const color3 = "#6a3";
const color4 = "#a36";

export function writeHTMLReport(data: any): string {
  const workerReqsTotal = sum(data.workerReqs);
  const workerDurationsTotal = sum(data.workerDurations);
  const durableObjectReqsTotal = sum(data.durableObjectReqs);
  const durableObjectWallTimes = data.durableObjectWallTimes.map(
    (microsecs) => ((microsecs / 1000 / 1000) * 128) / 1000
  ); // GB*s
  const durableObjectCpuTimes = data.durableObjectCpuTimes.map(
    (microsecs) => ((microsecs / 1000 / 1000) * 128) / 1000
  ); // GB*s
  const durableObjectDurationTotal = Math.max(
    sum(durableObjectWallTimes),
    sum(durableObjectCpuTimes)
  ); // GB*s
  const durableObjectReadsTotal = sum(data.durableObjectReads);
  const durableObjectWritesTotal = sum(data.durableObjectWrites);
  const durableObjectDeletesTotal = sum(data.durableObjectDeletes);
  const durableObjectStoredMax = sum(data.durableObjectStored);

  const dayLabels = data.days.map((d) =>
    d.slice(5).replaceAll("0", "").replace("-", "/")
  );
  const chart1 = renderLineChart({
    id: "worker-reqs",
    title: "workers requests",
    labels: dayLabels,
    datasets: [
      {
        color: color1,
        label: "Requests",
        data: data.workerReqs,
      },
    ],
  });
  const chart2 = renderLineChart({
    id: "worker-durations",
    title: "workers durations",
    labels: dayLabels,
    datasets: [
      {
        color: color1,
        label: "Duration (GB * s)",
        data: data.workerDurations,
      },
    ],
  });
  const pichart1 = renderPieChart({
    id: "worker-requests-pie",
    title: "workers requests",
    color: color1,
    label: "Requests",
    value: workerReqsTotal,
    limit: WORKER_REQ_LIMIT,
  });
  const pichart2 = renderPieChart({
    id: "worker-durations-pie",
    title: "workers durations",
    color: color1,
    label: "Duration",
    value: workerDurationsTotal,
    limit: WORKER_DURATION_LIMIT,
  });
  const chart3 = renderLineChart({
    id: "durable-object-requests",
    title: "durable object requests",
    labels: dayLabels,
    datasets: [
      {
        color: color1,
        label: "Requests",
        data: data.durableObjectReqs,
      },
    ],
  });
  const chart4 = renderLineChart({
    id: "durable-object-durations",
    title: "durable object durations",
    labels: dayLabels,
    datasets: [
      {
        color: color1,
        label: "Wall times (GB * s)",
        data: durableObjectWallTimes,
      },
      {
        color: color2,
        label: "CPU times (GB * s)",
        data: durableObjectCpuTimes,
      },
    ],
  });
  const pichart3 = renderPieChart({
    id: "durable-object-requests-pie",
    title: "durable object requests",
    color: color1,
    label: "Requests",
    value: durableObjectReqsTotal,
    limit: DURABLE_OBJECT_REQ_LIMIT,
  });
  const pichart4 = renderPieChart({
    id: "durable-object-durations-pie",
    title: "durable object durations",
    color: color1,
    label: "Duration",
    value: durableObjectDurationTotal,
    limit: DURABLE_OBJECT_DURATION_LIMIT,
  });
  const chart5 = renderLineChart({
    id: "durable-storage-requests",
    title: "durable storage requests",
    labels: dayLabels,
    datasets: [
      {
        color: color1,
        label: "Reads (unit)",
        data: data.durableObjectReads,
      },
      {
        color: color3,
        label: "Writes (unit)",
        data: data.durableObjectWrites,
      },
      {
        color: color4,
        label: "Deletes (unit)",
        data: data.durableObjectDeletes,
      },
    ],
  });
  const pichart5a = renderPieChart({
    id: "durable-storage-reads-pie",
    title: "durable storage reads",
    color: color1,
    label: "Reads",
    value: durableObjectReadsTotal,
    limit: DURABLE_STORAGE_READ_LIMIT,
  });
  const pichart5b = renderPieChart({
    id: "durable-storage-writes-pie",
    title: "durable storage writes",
    color: color3,
    label: "Writes",
    value: durableObjectWritesTotal,
    limit: DURABLE_STORAGE_WRITE_LIMIT,
  });
  const pichart5c = renderPieChart({
    id: "durable-storage-deletes-pie",
    title: "durable storage deletes",
    color: color4,
    label: "Deletes",
    value: durableObjectDeletesTotal,
    limit: DURABLE_STORAGE_DELETE_LIMIT,
  });
  const chart6 = renderLineChart({
    id: "durable-storage-amount",
    title: "durable storage amount",
    labels: dayLabels,
    datasets: [
      {
        color: color1,
        label: "Amount (byte)",
        data: data.durableObjectStored,
      },
    ],
  });
  const pichart6 = renderPieChart({
    id: "durable-storage-amount-pie",
    title: "durable storage amount",
    color: color1,
    label: "Amount",
    value: durableObjectStoredMax,
    limit: DURABLE_STORAGE_AMOUNT_LIMIT,
  });
  return `
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
}

function renderLineChart(o: {
  id: string;
  title: string;
  labels: string[];
  datasets: {
    color: string;
    label: string;
    data: number[];
  }[];
}) {
  return renderOneChart(o.id, o.title, {
    type: "line",
    data: {
      labels: o.labels,
      datasets: o.datasets.map((ds) => {
        return {
          borderColor: ds.color,
          backgroundColor: ds.color,
          label: ds.label,
          data: ds.data,
        };
      }),
    },
    options: {
      maintainAspectRatio: false,
    },
  });
}
function renderPieChart(o: {
  id: string;
  title: string;
  color: string;
  label: string;
  value: number;
  limit: number;
}) {
  return renderOneChart(
    o.id,
    o.title,
    {
      type: "pie",
      data: {
        labels: [o.label],
        datasets: [
          {
            borderColor: [o.color, "#eee"],
            backgroundColor: [o.color, "#eee"],
            data: [o.value, o.limit - o.value],
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
      },
    },
    true
  );
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
