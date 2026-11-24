(function(){
  var Real = window.WebSocket;
  var seed = 7; function rnd(){ seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
  function Fake(url){
    var self = this; this.url = url; this.readyState = 0; this.id = 1000; this.mid = 61280; this.tid = 900000;
    setTimeout(function(){ self.readyState = 1; if (self.onopen) self.onopen({}); self.t = setInterval(function(){ self.tick() }, 100) }, 30);
  }
  Fake.prototype.close = function(){ clearInterval(this.t); this.readyState = 3 };
  Fake.prototype.send = function(){};
  Fake.prototype.emit = function(stream, data){ if (this.onmessage) this.onmessage({data: JSON.stringify({stream: stream, data: data})}) };
  Fake.prototype.tick = function(){
    var pair = (/streams=([a-z0-9]+)@/.exec(this.url) || [0, 'btcusdt'])[1];
    this.mid += (rnd() - 0.5) * 6;
    var b = [], a = [];
    for (var i = 0; i < 12; i++) { b.push([(Math.round(this.mid) - 1 - Math.floor(rnd() * 150)).toFixed(2), (rnd() < 0.15 ? 0 : rnd() * (rnd() < 0.05 ? 40 : 3)).toFixed(4)]); a.push([(Math.round(this.mid) + 1 + Math.floor(rnd() * 150)).toFixed(2), (rnd() < 0.15 ? 0 : rnd() * (rnd() < 0.05 ? 40 : 3)).toFixed(4)]) }
    b.push([(Math.round(this.mid) - 1).toFixed(2), (1 + rnd() * 2).toFixed(4)]); a.push([(Math.round(this.mid) + 1).toFixed(2), (1 + rnd() * 2).toFixed(4)]);
    this.mid = Math.max(61230, Math.min(61330, this.mid));
    var m0 = Math.round(this.mid);
    for (var c = 0; c < 8; c++) { b.push([(m0 + c).toFixed(2), '0']); a.push([(m0 - c).toFixed(2), '0']) }
    this.emit(pair + '@depth@100ms', {e: 'depthUpdate', U: this.id + 1, u: this.id + 3, b: b, a: a}); this.id += 3;
    for (var k = 0; k < 3; k++) { var sell = rnd() < 0.5; this.emit(pair + '@aggTrade', {e: 'aggTrade', a: this.tid++, p: (this.mid + (sell ? -1 : 1)).toFixed(2), q: (rnd() < 0.02 ? 5 + rnd() * 10 : rnd() * 0.3).toFixed(5), T: Date.now(), m: sell}) }
  };
  window.WebSocket = function(url, p){ return /binance/.test(url) ? new Fake(url) : new Real(url, p) };
  window.WebSocket.OPEN = 1; window.WebSocket.CLOSED = 3;
})();
