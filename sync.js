/* Save the Date — shared state over MQTT.
   State lives in a RETAINED message on <base>/state so late joiners get the game instantly.
   Players publish join/vote messages to <base>/msg; the host (game creator) is authoritative. */
(function () {
  // Public MQTT broker over secure WebSockets (works from GitHub Pages / https).
  // Swap here if a broker is blocked on your network:
  //   HiveMQ: 'wss://broker.hivemq.com:8884/mqtt'
  //   Mosquitto test: 'wss://test.mosquitto.org:8081/mqtt'
  const BROKER_URL = 'wss://broker.emqx.io:8084/mqtt';

  class MqttSync {
    constructor(room) {
      this.room = room;
      this.base = 'savethedate/v1/' + room;
      this.client = null;
      this.handlers = {};
    }
    on(ev, cb) { this.handlers[ev] = cb; }

    connect(clientId) {
      return new Promise((resolve, reject) => {
        this.client = mqtt.connect(BROKER_URL, {
          clientId, clean: true, connectTimeout: 10000, reconnectPeriod: 2500, keepalive: 30
        });
        let settled = false;
        this.client.on('connect', () => { if (!settled) { settled = true; resolve(); } });
        this.client.on('error', (e) => { if (this.handlers.error) this.handlers.error(e); if (!settled) { settled = true; reject(e); } });
        this.client.on('reconnect', () => { if (this.handlers.reconnect) this.handlers.reconnect(); });
        this.client.on('message', (topic, payload) => {
          let data;
          try { data = JSON.parse(payload.toString()); } catch (e) { return; }
          if (topic === this.base + '/state' && this.handlers.state) this.handlers.state(data);
          if (topic === this.base + '/msg' && this.handlers.msg) this.handlers.msg(data);
        });
      });
    }

    subscribeState() { this.client.subscribe(this.base + '/state', { qos: 0 }); }
    subscribeMsg()   { this.client.subscribe(this.base + '/msg',   { qos: 0 }); }

    publishState(state) {
      this.client.publish(this.base + '/state', JSON.stringify(state), { retain: true, qos: 0 });
    }
    sendMsg(msg) {
      this.client.publish(this.base + '/msg', JSON.stringify(msg), { qos: 0 });
    }
  }

  window.MqttSync = MqttSync;
})();
