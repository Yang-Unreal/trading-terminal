const SYMBOL = "BTCUSDT";
const PORT = 9001;
let counter = 0;
const prices = ["65000.50", "65001.25"];

Bun.serve({
  port: PORT,
  websocket: {
    open(ws) {
      ws.send(JSON.stringify({ event: "subscribe", arg: { instType: "USDT-FUTURES", channel: "ticker", instId: SYMBOL }, code: "0", msg: "success" }));
      const sendTicker = () => {
        const last = prices[counter % prices.length];
        counter += 1;
        const msg = {
          action: "update",
          arg: { instType: "USDT-FUTURES", channel: "ticker", instId: SYMBOL },
          data: [{
            symbol: SYMBOL,
            lastPr: last,
            bidPr: "65000.40",
            askPr: "65000.60",
            markPrice: "65001.00",
            indexPrice: "64999.80",
            fundingRate: "0.0001",
            ts: String(Date.now()),
          }],
        };
        ws.send(JSON.stringify(msg));
      };
      sendTicker();
      const interval = setInterval(sendTicker, 2000);
      (ws as unknown as { __interval: ReturnType<typeof setInterval> }).__interval = interval;
    },
    message(ws, message) {
      try {
        const payload = JSON.parse(String(message));
        if (payload.op === "subscribe") {
          ws.send(JSON.stringify({ event: "subscribe", arg: payload.args?.[0], code: "0", msg: "success" }));
        }
      } catch {
        // ignore malformed messages
      }
    },
    close(ws) {
      const interval = (ws as unknown as { __interval?: ReturnType<typeof setInterval> }).__interval;
      if (interval) clearInterval(interval);
    },
  },
  fetch(req, server) {
    if (server.upgrade(req)) return;
    return new Response("Mock exchange running");
  },
});

console.log(`Mock exchange listening on ws://127.0.0.1:${PORT}`);