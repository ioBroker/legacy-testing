/*
 * This is an example test file that shows how to use `@iobroker/legacy-testing`
 * inside an adapter. Copy it into your adapter's `test` folder and adapt it.
 * It is intentionally excluded from the build/lint of this repository because it
 * references the published package by name (which is only resolvable in a consumer).
 */
import * as setup from '@iobroker/legacy-testing';
import assert from 'node:assert';

let objects: setup.ObjectsClient | null = null;
let states: setup.StatesClient | null = null;
const onStateChanged: ((id: string, state: ioBroker.State | null | undefined) => void) | null = null;

const adapterShortName = setup.adapterName.substring(setup.adapterName.indexOf('.') + 1);

function checkConnectionOfAdapter(cb?: (error?: string) => void, counter?: number): void {
    counter ||= 0;
    console.log(`Try check #${counter}`);
    if (counter > 30) {
        cb?.('Cannot check connection');
        return;
    }

    states?.getState(
        `system.adapter.${adapterShortName}.0.alive`,
        (err: Error | null | undefined, state: ioBroker.State | null | undefined) => {
            err && console.error(err);
            if (state?.val) {
                cb?.();
            } else {
                setTimeout(() => checkConnectionOfAdapter(cb, counter + 1), 1000);
            }
        },
    );
}

function checkValueOfState(
    id: string,
    value: ioBroker.StateValue,
    cb?: (error?: string) => void,
    counter?: number,
): void {
    counter ||= 0;
    if (counter > 20) {
        return cb?.(`Cannot check value Of State ${id}`);
    }

    states?.getState(id, (err: Error | null | undefined, state: ioBroker.State | null | undefined) => {
        err && console.error(err);
        if (value === null && !state) {
            cb?.();
        } else if (state && (value === undefined || state.val === value)) {
            cb?.();
        } else {
            setTimeout(() => checkValueOfState(id, value, cb, counter + 1), 500);
        }
    });
}

describe(`Test ${adapterShortName} adapter`, function () {
    before(`Test ${adapterShortName} adapter: Start js-controller`, function (_done) {
        this.timeout(600000);

        setup.setupController(async () => {
            const config = await setup.getAdapterConfig();
            if (!config) {
                throw new Error('Unable to initialize adapter as config is missing');
            }
            // enable adapter
            config.common.enabled = true;
            config.common.loglevel = 'debug';

            config.native.port = 15000;
            config.native.devices = [
                {
                    ip: '127.0.0.1',
                    protocol: 'HOME',
                },
            ];
            await setup.setAdapterConfig(config.common, config.native);

            setup.startController(
                true,
                () => {},
                // @ts-expect-error onStateChanged is only example
                (id, state) => onStateChanged?.(id, state),
                (_objects, _states) => {
                    objects = _objects;
                    states = _states;
                    _done();
                },
            );
        });
    });

    it(`Test ${adapterShortName} adapter: Check if adapter started`, done => {
        checkConnectionOfAdapter(res => {
            res && console.log(res);
            assert.notStrictEqual(res, 'Cannot check connection');
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
