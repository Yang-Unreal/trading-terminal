const ws = new WebSocket("ws://127.0.0.1:9001");
ws.onopen = () => { console.log("open"); ws.send(JSON.stringify({op:"subscribe",args:[{instType:"USDT-FUTURES",channel:"ticker",instId:"BTCUSDT"}]})); };
ws.onmessage = (e) => console.log("msg", e.data);
ws.onclose = (e) => console.log("close", e.code, e.reason);