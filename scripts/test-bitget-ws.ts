const ws = new WebSocket("wss://ws.bitget.com/v2/ws/public");
ws.onopen = () => { console.log("open"); ws.send(JSON.stringify({op:"subscribe",args:[{instType:"USDT-FUTURES",channel:"ticker",instId:"BTCUSDT"}]})); };
ws.onmessage = (e) => { console.log("msg", String(e.data).slice(0,200)); ws.close(); };
ws.onerror = (e) => console.log("error", e);
ws.onclose = (e) => console.log("close", e.code, e.reason);