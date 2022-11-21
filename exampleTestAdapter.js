/* jshint -W097 */
/* jshint strict: false */
/* jslint node: true */
/* jshint expr: true*/
'use strict';
const expect = require('chai').expect;
const setup  = require('@iobroker/legacy-tests').setup;

let objects = null;
let states  = null;
let onStateChanged = null;

let adapterShortName = setup.adapterName.substring(setup.adapterName.indexOf('.') + 1);

function checkConnectionOfAdapter(cb, counter) {
    counter = counter || 0;
    console.log(`Try check #${counter}`);
    if (counter > 30) {
        cb && cb('Cannot check connection');
        return;
    }

    states.getState(`system.adapter.${adapterShortName}.0.alive`, (err, state) => {
        err && console.error(err);
        if (state && state.val) {
            cb && cb();
        } else {
            setTimeout(() => {
                checkConnectionOfAdapter(cb, counter + 1);
            }, 1000);
        }
    });
}

function checkValueOfState(id, value, cb, counter) {
    counter = counter || 0;
    if (counter > 20) {
        return cb && cb(`Cannot check value Of State ${id}`);
    }

    states.getState(id, (err, state) => {
        err && console.error(err);
        if (value === null && !state) {
            cb && cb();
        } else
        if (state && (value === undefined || state.val === value)) {
            cb && cb();
        } else {
            setTimeout(() =>
                checkValueOfState(id, value, cb, counter + 1), 500);
        }
    });
}

describe(`Test ${adapterShortName} adapter`, function () {
    before(`Test ${adapterShortName} adapter: Start js-controller`, function (_done) {
        this.timeout(600000);

        setup.setupController(async () => {
            let config = await setup.getAdapterConfig();
            // enable adapter
            config.common.enabled  = true;
            config.common.loglevel = 'debug';

            config.native.port   = 15000;
            config.native.devices = [
                {
                    ip: '127.0.0.1',
                    protocol: 'HOME'
                }
            ];
            await setup.setAdapterConfig(config.common, config.native);

            setup.startController(
                true,
                (id, obj) => {},
                (id, state) => onStateChanged && onStateChanged(id, state),
                (_objects, _states) => {
                    objects = _objects;
                    states  = _states;
                    _done();
                },
            );
        });
    });

    it(`Test ${adapterShortName} adapter: Check if adapter started`, done => {
        checkConnectionOfAdapter(res => {
            res && console.log(res);
            expect(res).not.to.be.equal('Cannot check connection');
            done();
        });
    }).timeout(60000);

    // some tests here

    after(`Test ${adapterShortName} adapter: Stop js-controller`, function (done) {
        this.timeout(10000);

        setup.stopController(normalTerminated => {
            console.log(`Adapter normal terminated: ${normalTerminated}`);
            done();
        });
    });
});
