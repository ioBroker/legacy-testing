/**
 * This file starts and stops the admin adapter including js-controller
 */
import { existsSync, readdirSync, statSync, rmdirSync, unlinkSync } from 'node:fs';
import {
    setOfflineState,
    setupController,
    setObject,
    getAdapterConfig,
    setAdapterConfig,
    startController,
    startCustomAdapter,
    stopCustomAdapter,
    stopController,
    type ObjectsClient,
    type StatesClient,
} from './setup';

type OnStateChanged = (id: string, state: ioBroker.State | null | undefined) => void;

/** Options for {@link startIoBrokerAdapters} */
export interface StartIoBrokerAdaptersOptions {
    /** The root directory of the project */
    rootDir?: string;
    /** The adapters to start. Default is `['admin']` */
    adapters?: string[];
}

let rootDir = `${__dirname}/../../../../`;
let objects: ObjectsClient | null = null;
let states: StatesClient | null = null;
let onStateChanged: OnStateChanged | null = null;

function deleteFoldersRecursive(path: string): void {
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

let startedAdapters: string[] = ['admin'];

/**
 * Start ioBroker controller and provided adapters. If no adapters are provided, only the admin will be started.
 *
 * @param options options for starting the adapters
 */
function startIoBrokerAdapters(
    options?: StartIoBrokerAdaptersOptions,
): Promise<{ objects: ObjectsClient; states: StatesClient }> {
    const opts = options || {};
    if (opts.rootDir) {
        rootDir = opts.rootDir;
    }

    return new Promise(resolve => {
        void (async (): Promise<void> => {
            // delete the old project
            deleteFoldersRecursive(`${rootDir}tmp/screenshots`);

            const adapters = opts.adapters || startedAdapters;
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
                    () => {},
                    (id, state) => onStateChanged?.(id, state),
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
        })();
    });
}

async function stopIoBrokerAdapters(): Promise<void> {
    for (let a = 0; a < startedAdapters.length; a++) {
        await stopCustomAdapter(startedAdapters[a], 0);
    }

    await new Promise<void>(resolve =>
        stopController(normalTerminated => {
            console.log(`Adapter normal terminated: ${normalTerminated}`);
            resolve();
        }),
    );
}

function checkIsAdapterStarted(
    adapterName: string,
    states: StatesClient,
    cb?: (error?: string) => void,
    counter?: number,
): void {
    counter ??= 20;
    if (counter === 0) {
        return cb?.(`Cannot check value Of State system.adapter.${adapterName}.0.alive`);
    }

    void states.getState(
        `system.adapter.${adapterName}.0.alive`,
        (err: Error | null | undefined, state: ioBroker.State | null | undefined) => {
            console.log(
                `[${counter}]Check if ${adapterName} is started "system.adapter.${adapterName}.0.alive" = ${JSON.stringify(state)}`,
            );
            if (err) {
                console.error(err);
            }
            if (state?.val) {
                cb?.();
            } else {
                setTimeout(() => checkIsAdapterStarted(adapterName, states, cb, counter - 1), 500);
            }
        },
    );
}

function checkIsAdapterStartedAsync(adapterName: string, states: StatesClient, counter?: number): Promise<void> {
    return new Promise(resolve => checkIsAdapterStarted(adapterName, states, () => resolve(), counter));
}

export { startIoBrokerAdapters, stopIoBrokerAdapters };

export function setOnStateChanged(cb: OnStateChanged): void {
    onStateChanged = cb;
}
