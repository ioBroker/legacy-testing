/**
 * This file starts and stops the admin adapter including js-controller
 */
const { existsSync, readdirSync, statSync, rmdirSync, unlinkSync } = require('node:fs');
const {
    setOfflineState,
    setupController,
    setObject,
    getAdapterConfig,
    setAdapterConfig,
    startController,
    startCustomAdapter,
    stopCustomAdapter,
    stopController,
} = require('./setup');

let rootDir = `${__dirname}/../../../`;
let objects = null;
let states = null;
let onStateChanged = null;

function deleteFoldersRecursive(path) {
    if (path.endsWith('/')) {
        path = path.substring(0, path.length - 1);
    }
    if (existsSync(path)) {
        const files = readdirSync(path);
        for (const file of files) {
            const curPath = `${path}/${file}`;
            const stat = statSync(curPath);
            if (stat.isDirectory()) {
                deleteFoldersRecursive(curPath);
                rmdirSync(curPath);
            } else {
                unlinkSync(curPath);
            }
        }
    }
}

let startedAdapters = ['admin'];

/**
 * Start ioBroker controller and provided adapters. If no adapters are provided, only the admin will be started.
 *
 * @param options.rootDir {string} The root directory of the project
 * @param options.adapters {string[]} The adapters to start. Default is ['admin']
 *
 * @return {Promise<unknown>}
 */
function startIoBrokerAdapters(options) {
    options = options || {};
    if (options.rootDir) {
        rootDir = options.rootDir;
    }

    return new Promise(async resolve => {
        // delete the old project
        deleteFoldersRecursive(`${rootDir}tmp/screenshots`);

        const adapters = options.adapters || startedAdapters;
        startedAdapters = adapters;
        for (let a = 0; a < adapters.length; a++) {
            await setOfflineState(`system.adapter.${adapters[a]}.0.alive`, { val: false });
        }

        setupController(adapters, async systemConfig => {
            // disable statistics and set license accepted
            systemConfig.common.licenseConfirmed = true;
            systemConfig.common.diag = 'none';
            await setObject('system.config', systemConfig);

            // start adapters
            for (let a = 0; a < adapters.length; a++) {
                const adapter = adapters[a];
                const adapterConfig = await getAdapterConfig(0, adapter);
                if (adapterConfig?.common) {
                    adapterConfig.common.enabled = true;
                    await setAdapterConfig(adapterConfig.common, adapterConfig.native, 0, adapter);
                }
            }

            startController(
                false, // do not start widgets
                (/* id, obj */) => {},
                (id, state) => onStateChanged && onStateChanged(id, state),
                async (_objects, _states) => {
                    objects = _objects;
                    states = _states;
                    for (let a = 0; a < adapters.length; a++) {
                        startCustomAdapter(adapters[a], 0);
                        await checkIsAdapterStartedAsync(adapters[a], states);
                    }
                    resolve({ objects, states });
                },
            );
        });
    });
}

async function stopIoBrokerAdapters() {
    for (let a = 0; a < startedAdapters.length; a++) {
        await stopCustomAdapter(startedAdapters[a], 0);
    }

    await new Promise(resolve =>
        stopController(normalTerminated => {
            console.log(`Adapter normal terminated: ${normalTerminated}`);
            resolve();
        }),
    );
}

function checkIsAdapterStarted(adapterName, states, cb, counter) {
    counter = counter === undefined ? 20 : counter;
    if (counter === 0) {
        return cb && cb(`Cannot check value Of State system.adapter.${adapterName}.0.alive`);
    }

    states.getState(`system.adapter.${adapterName}.0.alive`, (err, state) => {
        console.log(
            `[${counter}]Check if ${adapterName} is started "system.adapter.${adapterName}.0.alive" = ${JSON.stringify(state)}`,
        );
        err && console.error(err);
        if (state && state.val) {
            cb && cb();
        } else {
            setTimeout(() => checkIsAdapterStarted(adapterName, states, cb, counter - 1), 500);
        }
    });
}

function checkIsAdapterStartedAsync(adapterName, states, counter) {
    return new Promise(resolve => checkIsAdapterStarted(adapterName, states, resolve, counter));
}

module.exports = {
    startIoBrokerAdapters,
    stopIoBrokerAdapters,
    setOnStateChanged: cb => (onStateChanged = cb),
};
