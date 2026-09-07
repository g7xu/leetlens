// chrome.storage.local, enough of it for the credential code, plus a scripted
// fetch. The modules under test touch chrome only at call time, so installing
// these before the call is enough.

export function installFakeChrome(initial = {}) {
  const data = structuredClone(initial);
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          const names = keys === undefined ? Object.keys(data)
            : Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(
            names.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]),
          );
        },
        async set(items) {
          Object.assign(data, structuredClone(items));
        },
        async remove(keys) {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
        },
      },
    },
  };
  return data;
}

/** Queue of responses; each fetch takes the next one and records the request. */
export function installFakeFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch: ${url}`);
    return {
      ok: next.status === undefined || next.status < 400,
      status: next.status ?? 200,
      json: async () => next.json,
      text: async () => JSON.stringify(next.json),
    };
  };
  return calls;
}
