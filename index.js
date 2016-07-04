var TextareaMonitor = function(el, callback) {
  this.el = el;
  this.callback = callback;
  this.resync();
};
TextareaMonitor.prototype = {
  resync: function() {
    this.valLast = this.el.value;
  },
  monitor: function() {
    // https://github.com/share/ShareJS/blob/master/lib/client/textarea.js#L26
    var applyChange = function(ctx, oldval, newval) {
      if (oldval === newval) return;

      var commonStart = 0;
      while (oldval.charAt(commonStart) === newval.charAt(commonStart)) {
        commonStart++;
      }

      var commonEnd = 0;
      while (oldval.charAt(oldval.length - 1 - commonEnd) === newval.charAt(newval.length - 1 - commonEnd) &&
          commonEnd + commonStart < oldval.length && commonEnd + commonStart < newval.length) {
        commonEnd++;
      }

      if (oldval.length !== commonStart + commonEnd) {
        ctx.remove(commonStart, oldval.length - commonStart - commonEnd);
      }
      if (newval.length !== commonStart + commonEnd) {
        ctx.insert(commonStart, newval.slice(commonStart, newval.length - commonEnd));
      }
    };

    this.el.addEventListener("input", function(event) {
      var valNext = this.el.value;
      var ctx = {
        insert: function(pos, str) {
          for (var idx = 0; idx < str.length; idx++) {
            this.callback(["ins", pos + idx, str.slice(idx, idx + 1)]);
          } 
        }.bind(this),
        remove: function(pos, len) {
          for (var idx = len - 1; idx >= 0; idx--) {
            this.callback(["del", pos + idx + 1]);
          }
        }.bind(this)
      };
      applyChange(ctx, this.valLast, valNext);
      this.resync();
    }.bind(this));
  }
};

var EventBus = function() {
  this.subscribers = [];
}
EventBus.prototype = {
  publish: function(clientId, op) {
    for (var idx = 0; idx < this.subscribers.length; idx++) {
      var subscriber = this.subscribers[idx]
      if (subscriber.clientId !== clientId) {
        var opClone = JSON.parse(JSON.stringify(op)); // only needed locally
        subscriber.callback(opClone);
      }
    }
  },
  subscribe: function(clientId, callback) {
    this.subscribers.push({ clientId: clientId, callback: callback });
  }
};
var eventBus = new EventBus;

var beans = function(editor) {
  // wchar
  var WChar = function(id, v, a, id_cp, id_cn) {
    this.id = id;
    this.v = v;
    this.a = a;
    this.id_cp = id_cp;
    this.id_cn = id_cn;
  };

  // wstring
  var WString = function() {
    var id_C_b = [0, 0];
    var id_C_e = [999, 0];
    this.C_b = new WChar(id_C_b, true, "", null, id_C_e);
    this.C_e = new WChar(id_C_e, true, "", id_C_b, null);
    this.S = [this.C_b, this.C_e];
    this.index = {};
    this.index[this.C_b.id.join(",")] = [this.C_b, 0];
    this.index[this.C_e.id.join(",")] = [this.C_e, 1];
  };
  WString.prototype = {
    magnitude: function() {
      return this.S.length;
    },
    at: function(p) {
      return this.S[p];
    },
    pos: function(c) {
      return this.index[c.id.join(",")][1];//_.findIndex(this.S, function(c_i) { return areEqualIds(c_i.id, c.id); });
    },
    posVisible: function(c) {
      var c_pos = this.pos(c);
      return _.reduce(this.S.slice(0, c_pos + 1), function(m, c_i) {
        if (c_i.v) {
          return m + 1;
        } else {
          return m;
        }
      }, 0);
    },
    byId: function(id) {
      return this.index[id.join(',')][0];//_.find(this.S, function(c_i) { return areEqualIds(c_i.id, id); });
    },
    insert: function(c, p) {
      this.index[c.id.join(',')] = [c, p];
      this.S.splice(p, 0, c);
      var tail = this.S.slice(p + 1, this.magnitude());
      for (var idx = 0; idx < tail.length; idx++) {
        this.index[tail[idx].id.join(",")][1]++;
      }
    },
    subseq: function(c, d) {
      return this.S.slice(this.pos(c) + 1, this.pos(d));
    },
    contains: function(c) {
      return !!this.index[c.id.join(',')];//_.findIndex(this.S, function(c_i) { return areEqualIds(c_i.id, c.id); }) > -1;
    },
    value: function() {
      return _.reduce(this.S, function(m, c_i) {
        if (c_i.v) {
          return m + c_i.a;
        } else {
          return m;
        }
      }, "");
    },
    ithVisible: function(i) {
      return _.filter(this.S, function(c_i) { return c_i.v; })[i];
    },
    isExecutable: function(op) {
      var c = char(op);
      if (type(op) === "del") {
        return this.contains(c);
      } else {
        return !!(this.byId(c.id_cp) && this.byId(c.id_cn));
      }
    },
    integrateDel: function(c) {
      this.S[this.pos(c)].v = false;
    },
    integrateIns: function(c, c_p, c_n) {
      var S_prime = this.subseq(c_p, c_n);
      if (S_prime.length === 0) {
        this.insert(c, this.pos(c_n));
      } else {
        var c_p_pos = this.pos(c_p);
        var c_n_pos = this.pos(c_n);
        var d = _.filter(S_prime, function(d_i) {
          var d_i_p = this.byId(d_i.id_cp);
          var d_i_n = this.byId(d_i.id_cn);
          return this.pos(d_i_p) <= c_p_pos && c_n_pos <= this.pos(d_i_n);
        }.bind(this));
        var L = [c_p].concat(d, c_n);
        var i = 1;
        while (
          i < L.length - 1 && (
            L[i].id[0] < c.id[0] ||
            L[i].id[0] === c.id[0] && L[i].id[1] < c.id[1]
          )
        ) {
          i++;
        }
        this.integrateIns(c, L[i - 1], L[i]);
      }
    }
  };

  // ops
  var type = function(op) {
    return op[0];
  };
  var char = function(op) {
    return op[1];
  };
  var generateIns = function(pos, a) {
    var c_p = wString.ithVisible(pos);
    var c_n = wString.ithVisible(pos + 1);
    var wChar = new WChar(generateId(), true, a, c_p.id, c_n.id);
    wString.integrateIns(wChar, c_p, c_n);
    broadcast(["ins", wChar]);
  };
  var generateDel = function(pos) {
    var wChar = wString.ithVisible(pos);
    wString.integrateDel(wChar);
    broadcast(["del", wChar]);
  };

  // util
  var generateId = function() {
    return [numSite, H++];
  };

  var areEqualIds = function(a, b) {
    return a[0] === b[0] && a[1] === b[1];
  };

  // global state
  var numSite = Math.floor(Math.random() * 999 - 1) + 1; // [0, 999]
  var H = 0;
  var wString = new WString();
  var pool = [];

  // network
  var broadcast = function(op) {
    // console.log(editor.id, "broadcast", op);
    eventBus.publish(editor.id, op);
  };
  var reception = function(op) {
    pool.push(op);
    // window.setTimeout(function() { pool.push(op); }, Math.round(Math.random() * 500));
  };
  var drainPool = function() {
    var op;
    var poolNext = [];
    while (op = pool.shift()) {
      // console.log('loop', processed);
      if (wString.isExecutable(op)) { // simulates some randomness
        var c = char(op);
        if (type(op) === "del") {
          // console.log('del', op);
          var pVis = wString.posVisible(c) - 1; // account for invisi. begin char
          wString.integrateDel(c);

          if (editor === document.activeElement) {
            var caret0 = editor.selectionStart;
            var caret1 = editor.selectionEnd;
            if (pVis < caret0) {
              caret0--;
              caret1--;
            } else if (pVis < caret1) {
              caret1--;
            }
          }
          editor.value = wString.value();
          if (editor === document.activeElement) {
            editor.setSelectionRange(caret0, caret1);
          }
          // monitor.resync();
        } else {
          var c_p = wString.byId(c.id_cp);
          var c_n = wString.byId(c.id_cn);
          if (!c_p) throw 'fudge1';
          if (!c_n) throw 'fudge2';
          var pVis = wString.posVisible(c_p) - 1; // account for invisi. begin char
          wString.integrateIns(c, c_p, c_n);

          if (editor === document.activeElement) {
            var caret0 = editor.selectionStart;
            var caret1 = editor.selectionEnd;
            // console.log('ins', pVis, caret0);
            if (pVis < caret0) {
              caret0++;
              caret1++;
            } else if (pVis < caret1) {
              caret1++;
            }
          }
          editor.value = wString.value();
          if (editor === document.activeElement) {
            editor.setSelectionRange(caret0, caret1);
          }
        }
        // processed = true;
        monitor.resync();
      } else {
        poolNext.push(op);
      }
    }
    pool = poolNext;
    window.setTimeout(drainPool, 1000);
  };
  eventBus.subscribe(editor.id, reception);
  drainPool();

  // io
  var monitor = new TextareaMonitor(editor, function(change) {
    if (change[0] === "del") {
      generateDel(change[1]);
    } else {
      generateIns(change[1], change[2]);
    }
  });
  editor.value = wString.value();
  monitor.resync();
  monitor.monitor();
};

beans(document.getElementById('editor1'));
beans(document.getElementById('editor2'));
