import fetch from "node-fetch";

export type Config = {
  CLOUDFLARE_API_TOKEN: string;
  ACCOUNT_ID: string;
  SCRIPT_NAME: string;
};

function graphql(s: TemplateStringsArray): string {
  return s.join("");
}

async function send(
  config: Config,
  query: string,
  variables: Record<string, string>
) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/graphql/`, {
    method: "POST",
    body: JSON.stringify({
      query,
      variables,
    }),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.CLOUDFLARE_API_TOKEN}`,
      Accepts: "application/json",
    },
  });
  if (res.status >= 400) {
    throw new Error(
      JSON.stringify({
        status: res.status,
        body: await res.text(),
      })
    );
  }
  const { data, errors } = await res.json();
  if (errors != null) {
    throw new Error(JSON.stringify(errors));
  }
  return data;
}

export type DateRange = {
  firstDate: string;
  lastDate: string;
};

export async function workersInvocationsAdaptive(
  config: Config,
  range: DateRange
) {
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
            orderBy: [date_ASC]
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
  const data = await send(config, q, {
    accountTag: config.ACCOUNT_ID,
    date_geq: range.firstDate,
    date_leq: range.lastDate,
    scriptName: config.SCRIPT_NAME,
  });
  return data.viewer.accounts[0].workersInvocationsAdaptive;
}

export async function durableObjectsInvocationsAdaptiveGroups(
  config: Config,
  range: DateRange
) {
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
            orderBy: [date_ASC]
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
  const data = await send(config, q, {
    accountTag: config.ACCOUNT_ID,
    date_geq: range.firstDate,
    date_leq: range.lastDate,
    scriptName: config.SCRIPT_NAME,
  });
  return data.viewer.accounts[0].durableObjectsInvocationsAdaptiveGroups;
}

export async function durableObjectsStorageGroups(
  config: Config,
  range: DateRange
) {
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
            orderBy: [date_ASC]
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
  const data = await send(config, q, {
    accountTag: config.ACCOUNT_ID,
    date_geq: range.firstDate,
    date_leq: range.lastDate,
  });
  return data.viewer.accounts[0].durableObjectsStorageGroups;
}

export async function durableObjectsPeriodicGroups(
  config: Config,
  range: DateRange
) {
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
            orderBy: [date_ASC]
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
              date
            }
          }
        }
      }
    }
  `;
  const data = await send(config, q, {
    accountTag: config.ACCOUNT_ID,
    date_geq: range.firstDate,
    date_leq: range.lastDate,
  });
  return data.viewer.accounts[0].durableObjectsPeriodicGroups;
}
