/*!
 * Copyright(c) 2014 Jan Blaha
 *
 * PhantomManager is responsible of managing pool of phantomjs worker processes
 * and distributing pdf rendering tasks to them.
 */

var events = require("events"),
    util = require("util"),
    _ = require("underscore"),
    numCPUs = require('os').cpus().length,
    PhantomWorker = require("./phantomWorker.js");

var PhantomManager = module.exports = function (options) {
    this._phantomInstances = [];
    this.options = options || {};
    this.options.numberOfWorkers = this.options.numberOfWorkers || numCPUs;
    this.options.timeout = options.timeout || 180000;
    this.tasksQueue = [];
};

util.inherits(PhantomManager, events.EventEmitter);

PhantomManager.prototype.start = function (cb) {
    var self = this;

    process.once("exit", function () {
        self.kill();
    });

    var started = 0;
    for (var i = 0; i < self.options.numberOfWorkers; i++) {
        self._phantomInstances.push(new PhantomWorker({
            pathToPhantomScript: self.options.pathToPhantomScript
        }));
        self._phantomInstances[i].start(function(err) {
            if (err)
                cb(err);

            started++;
            if (started === self.options.numberOfWorkers)
                cb(null);
        });
    };
};

PhantomManager.prototype.kill = function() {
    this._phantomInstances.forEach(function (i) {
        i.kill();
    });
}

PhantomManager.prototype.execute = function (options, cb) {
    var self = this;

    var freePhantomInstance = _.findWhere(this._phantomInstances, {
        isBusy: false
    });

    if (freePhantomInstance) {
        this._executeInWorker(freePhantomInstance, options, cb);
        return;
    }

    this.tasksQueue.push({options: options, cb: cb});
};

PhantomManager.prototype._executeInWorker = function (worker, options, cb) {
    var self = this;
    var isDone = false;

    setTimeout(function () {
        if (isDone)
            return;

        isDone = true;

        self.emit("timeout", worker);

        worker.recycle(function () {
            var error = new Error();
            error.weak = true;
            error.message = "Timeout";
            cb(error);

            self.tryFlushQueue();
        });
    }, this.options.timeout);

    worker.execute(options, function (err, result) {
        if (err)
            return cb(err);

        isDone = true;
        self.tryFlushQueue();
        cb(null, result);
    });
};

PhantomManager.prototype.tryFlushQueue = function () {
    if (this.tasksQueue.length === 0)
        return;

    var freePhantomInstance = _.findWhere(this._phantomInstances, {
        isBusy: false
    });

    if (!freePhantomInstance)
        return;

    var task = this.tasksQueue.shift();

    this._executeInWorker(freePhantomInstance, task.options, task.cb);
};



