import { lstatSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { normalize, join, basename } from 'node:path';
import { execSync, fork, exec, type ChildProcess } from 'node:child_process';
import { Socket } from 'node:net';
import { type JsonlDB } from '@alcalzone/jsonl-db';
import type { IoBJson } from '@iobroker/types/build/config';
import type { Client as ObjectsClient } from '@iobroker/db-objects-redis';
import type { Client as StatesClient } from '@iobroker/db-states-redis';

export type { ObjectsClient, StatesClient };
/** Minimal shape of an adapter `package.json` */
interface AdapterPackageJson {
    name: string;
    version: string;
    main?: string;
}

/** Result of a finished child process */
interface ExitInfo {
    code: number | null;
    signal: NodeJS.Signals | number | null;
}

/** Options that can be overridden at runtime */
export interface LegacyTestingOptions {
    rootDir?: string;
}

type ChangeHandlerObject = (id: string, obj: ioBroker.Object | null | undefined) => void;
type ChangeHandlerState = (id: string, obj: ioBroker.State | null | undefined) => void;

/**
 * The objects/states database client instances are created from the dynamically
 * resolved `@iobroker/db-objects-*` / `@iobroker/db-states-*` packages of the
 * js-controller. Their full types are not available here, and they are handed to the
 * caller as-is, so they are intentionally left untyped.
 */
type ControllerCallback = (objects: ObjectsClient, states: StatesClient) => void;

/** Subset of the `JsonlDB` class from `@alcalzone/jsonl-db` that is used here */
type JsonlDBConstructor = new (file: string) => JsonlDB;

let rootDir = normalize(`${__dirname}/../../../../`);
const debug = typeof (globalThis as { v8debug?: unknown }).v8debug === 'object';

let JSONLDB: JsonlDBConstructor | undefined;

let adapterParts = normalize(rootDir).replace(/\\/g, '/').split('/');
if (adapterParts[adapterParts.length - 2] === 'vis-2-widgets-testing') {
    rootDir = normalize(`${__dirname}/../../../../../../../`);
    adapterParts = normalize(rootDir).replace(/\\/g, '/').split('/');
}
const adapterName = adapterParts[adapterParts.length - 2];

let pkg!: AdapterPackageJson;

const adaptersStarted: Record<string, boolean> = {};
/**
 * Running child processes keyed by adapter id (plus the boolean `controller` flag).
 * Entries mix `ChildProcess` (with a custom `customResolve` handler), `boolean` and
 * `null`, so the map stays intentionally loosely typed.
 */
const pids: Record<string, any> = {};

let objects: ObjectsClient | null;
let states: StatesClient | null;
let systemConfig: ioBroker.SystemConfigObject | null = null;

/**
 * Initialize logic, you can re-trigger it after config has changed
 */
function initialize(): void {
    pkg = require(`${rootDir}package.json`);
    pkg.main ||= 'main.js';

    if (!existsSync(`${rootDir}tmp`)) {
        mkdirSync(`${rootDir}tmp`);
    }
}

initialize();

function loadJSONLDB(): void {
    if (!JSONLDB) {
        const dbPath = require.resolve('@alcalzone/jsonl-db', {
            paths: [`${rootDir}tmp/node_modules`, rootDir, `${rootDir}tmp/node_modules/iobroker.js-controller`],
        });
        console.log(`JSONLDB path: ${dbPath}`);
        try {
            const { JsonlDB } = require(dbPath);
            JSONLDB = JsonlDB;
        } catch (err) {
            console.log(`Jsonl require error: ${err as Error}`);
        }
    }
}

function copyFileSync(source: string, target: string): void {
    let targetFile = target;

    // if target is a directory a new file with the same name will be created
    if (existsSync(target) && lstatSync(target).isDirectory()) {
        targetFile = join(target, basename(source));
    }

    try {
        writeFileSync(targetFile, readFileSync(source));
    } catch {
        console.log(`file copy error: ${source} -> ${targetFile} (error ignored)`);
    }
}

function copyFolderRecursiveSync(source: string, target: string, ignore?: string[]): void {
    let files: string[] = [];

    let base = basename(source);
    if (base === adapterName) {
        base = pkg.name;
    }
    // check if folder needs to be created or integrated
    const targetFolder = join(target, base);
    if (!existsSync(targetFolder)) {
        mkdirSync(targetFolder);
    }

    // copy
    if (lstatSync(source).isDirectory()) {
        files = readdirSync(source);
        files.forEach(file => {
            if (ignore?.includes(file)) {
                return;
            }

            const curSource = join(source, file);
            const curTarget = join(targetFolder, file);
            if (lstatSync(curSource).isDirectory()) {
                // ignore grunt files
                if (file.includes('grunt') || file === 'chai' || file === 'mocha') {
                    return;
                }
                copyFolderRecursiveSync(curSource, targetFolder, ignore);
            } else {
                copyFileSync(curSource, curTarget);
            }
        });
    }
}

async function storeOriginalFiles(): Promise<void> {
    console.log('Store original files...');
    const dataDir = `${rootDir}tmp/iobroker-data/`;

    if (existsSync(`${dataDir}objects.json`)) {
        const f = readFileSync(`${dataDir}objects.json`);
        const objs = JSON.parse(f.toString());
        if (objs['system.adapter.admin.0'] && objs['system.adapter.admin.0'].common) {
            objs['system.adapter.admin.0'].common.enabled = false;
        }
        if (objs['system.adapter.admin.1'] && objs['system.adapter.admin.1'].common) {
            objs['system.adapter.admin.1'].common.enabled = false;
        }

        writeFileSync(`${dataDir}objects.json.original`, JSON.stringify(objs));
        console.log('Store original objects.json');
    }

    if (existsSync(`${dataDir}states.json`)) {
        try {
            const f = readFileSync(`${dataDir}states.json`);
            writeFileSync(`${dataDir}states.json.original`, f);
            console.log('Store original states.json');
        } catch {
            console.log('no states.json found - ignore');
        }
    }

    if (existsSync(`${dataDir}objects.jsonl`)) {
        loadJSONLDB();
        const db = new JSONLDB!(`${dataDir}objects.jsonl`);
        await db.open();

        const admin0 = db.get('system.adapter.admin.0') as ioBroker.InstanceObject;
        if (admin0?.common) {
            admin0.common.enabled = false;
            db.set('system.adapter.admin.0', admin0);
        }

        const admin1 = db.get('system.adapter.admin.1') as ioBroker.InstanceObject;
        if (admin1?.common) {
            admin1.common.enabled = false;
            db.set('system.adapter.admin.1', admin1);
        }
        await db.close();

        const f = readFileSync(`${dataDir}objects.jsonl`);
        writeFileSync(`${dataDir}objects.jsonl.original`, f);
        console.log('Store original objects.jsonl');
    }

    if (existsSync(`${dataDir}states.jsonl`)) {
        const f = readFileSync(`${dataDir}states.jsonl`);
        writeFileSync(`${dataDir}states.jsonl.original`, f);
        console.log('Store original states.jsonl');
    }
}

function restoreOriginalFiles(): void {
    console.log('restoreOriginalFiles...');
    const dataDir = `${rootDir}tmp/iobroker-data/`;

    if (existsSync(`${dataDir}objects.json.original`)) {
        const f = readFileSync(`${dataDir}objects.json.original`);
        writeFileSync(`${dataDir}objects.json`, f);
    }
    if (existsSync(`${dataDir}objects.json.original`)) {
        const f = readFileSync(`${dataDir}states.json.original`);
        writeFileSync(`${dataDir}states.json`, f);
    }

    if (existsSync(`${dataDir}objects.jsonl.original`)) {
        const f = readFileSync(`${dataDir}objects.jsonl.original`);
        writeFileSync(`${dataDir}objects.jsonl`, f);
    }
    if (existsSync(`${dataDir}objects.jsonl.original`)) {
        const f = readFileSync(`${dataDir}states.jsonl.original`);
        writeFileSync(`${dataDir}states.jsonl`, f);
    }
}

async function checkIsAdapterInstalled(
    cb?: (error?: string) => void,
    counter?: number,
    customAdapterName?: string | null,
    customInstance?: number,
): Promise<void> {
    customAdapterName ||= pkg.name.split('.').pop();
    counter ||= 0;
    console.log(`[${customAdapterName}] checkIsAdapterInstalled...`);

    try {
        const obj = await getObject(`system.adapter.${customAdapterName}.${customInstance || 0}`);
        if (obj?.common) {
            console.log(`[${customAdapterName}] checkIsAdapterInstalled: ready! ${JSON.stringify(obj)}`);
            setTimeout(() => cb?.(), 100);
            return;
        }
        console.warn(`[${customAdapterName}] checkIsAdapterInstalled: still not ready`);
    } catch (err) {
        console.log(`[${customAdapterName}] checkIsAdapterInstalled: catch ${err as Error}`);
    }

    if (counter > 20) {
        console.error(`[${customAdapterName}] checkIsAdapterInstalled: Cannot install!`);
        cb?.('Cannot install');
    } else {
        console.log(`[${customAdapterName}] checkIsAdapterInstalled: wait...`);
        setTimeout(() => checkIsAdapterInstalled(cb, counter + 1, customAdapterName, customInstance), 1000);
    }
}

function checkIsAdapterInstalledAsync(
    counter?: number,
    customAdapterName?: string | null,
    customInstance?: number,
): Promise<void> {
    return new Promise((resolve, reject) => {
        void checkIsAdapterInstalled(
            err => {
                if (err) {
                    reject(new Error(err));
                } else {
                    resolve();
                }
            },
            counter,
            customAdapterName,
            customInstance,
        );
    });
}

async function checkIsControllerInstalled(cb?: (error?: string) => void, counter?: number): Promise<void> {
    counter ||= 0;

    console.log('checkIsControllerInstalled...');
    try {
        const obj = await getObject('system.certificates');
        if (obj?.common) {
            console.log('checkIsControllerInstalled: installed!');
            setTimeout(() => cb?.(), 100);
            return;
        }
    } catch {
        // ignore
    }

    if (counter > 20) {
        console.log('checkIsControllerInstalled: Cannot install!');
        cb?.('Cannot install');
    } else {
        console.log('checkIsControllerInstalled: wait...');
        setTimeout(() => checkIsControllerInstalled(cb, counter + 1), 1000);
    }
}

function checkIsControllerInstalledAsync(counter?: number): Promise<void> {
    return new Promise((resolve, reject) => {
        void checkIsControllerInstalled(err => {
            if (err) {
                reject(new Error(err));
            } else {
                resolve();
            }
        }, counter);
    });
}

async function installAdapter(customAdapterName?: string | (() => void) | null, cb?: () => void): Promise<void> {
    if (typeof customAdapterName === 'function') {
        cb = customAdapterName;
        customAdapterName = null;
    }

    customAdapterName ||= pkg.name;
    console.log(`[${customAdapterName}] Install adapter...`);

    if (customAdapterName.includes('@')) {
        installCustomAdapter(customAdapterName);
    }

    const startFile = `node_modules/iobroker.js-controller/iobroker.js`;
    // make first install
    if (debug) {
        execSync(`node ${startFile} add ${customAdapterName} --enabled false`, {
            cwd: `${rootDir}tmp`,
            stdio: [0, 1, 2],
        });
    } else {
        // add controller
        const _pid = fork(startFile, ['add', customAdapterName, '--enabled', 'false'], {
            cwd: `${rootDir}tmp`,
            stdio: [0, 1, 2, 'ipc'],
        });

        await waitForEndAsync(_pid);
    }

    const name = customAdapterName.split('@')[0].split('.').pop(); // extract from iobroker.adaptername@version => adaptername

    await checkIsAdapterInstalledAsync(undefined, name);
    console.log(`[${customAdapterName}] Adapter installed.`);
    cb?.();
}

function installAdapterAsync(customAdapterName?: string): Promise<void> {
    return new Promise(resolve => installAdapter(customAdapterName, () => resolve()));
}

function waitForEndAsync(_pid: ChildProcess | null | undefined): Promise<ExitInfo> | ExitInfo {
    if (!_pid) {
        return { code: -1, signal: -1 };
    }
    return new Promise<ExitInfo>(resolve => {
        let pid: ChildProcess | null = _pid;
        pid.on('exit', (code, signal) => {
            if (pid) {
                pid = null;
                resolve({ code, signal });
            }
        });
        pid.on('close', (code, signal) => {
            if (pid) {
                pid = null;
                resolve({ code, signal });
            }
        });
    });
}

/**
 * Determine the js-controller version to install: the explicitly requested
 * `JS_CONTROLLER_VERSION`, or - if none is given - the default that matches the
 * current Node.js version: `7.2.2` for Node.js <= 20 and the `dev` build otherwise.
 */
function getJsControllerVersion(): string {
    if (process.env.JS_CONTROLLER_VERSION) {
        return process.env.JS_CONTROLLER_VERSION;
    }
    const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
    return nodeMajor <= 20 ? '7.2.2' : 'dev';
}

async function installJsController(
    preInstalledAdapters?: string[] | ((isInitialized: boolean) => void) | null,
    cb?: (isInitialized: boolean) => void,
): Promise<void> {
    if (typeof preInstalledAdapters === 'function') {
        cb = preInstalledAdapters;
        preInstalledAdapters = null;
    }

    console.log('installJsController...');
    if (
        !existsSync(`${rootDir}tmp/node_modules/iobroker.js-controller`) ||
        !existsSync(`${rootDir}tmp/iobroker-data`)
    ) {
        // try to detect appName.js-controller in node_modules/appName.js-controller
        // travis CI installs js-controller into node_modules
        if (existsSync(`${rootDir}node_modules/iobroker.js-controller`)) {
            console.log(
                `installJsController: no js-controller => copy it from "${rootDir}node_modules/iobroker.js-controller"`,
            );
            // copy all
            // stop the controller
            console.log('Stop controller if running...');
            let _pid: ChildProcess;
            if (debug) {
                // start controller
                _pid = exec(`node iobroker.js stop`, {
                    cwd: `${rootDir}node_modules/iobroker.js-controller`,
                });
            } else {
                _pid = fork(`iobroker.js`, ['stop'], {
                    cwd: `${rootDir}node_modules/iobroker.js-controller`,
                    stdio: [0, 1, 2, 'ipc'],
                });
            }

            await waitForEndAsync(_pid);
            // copy all files into
            if (!existsSync(`${rootDir}tmp`)) {
                mkdirSync(`${rootDir}tmp`);
                if (!existsSync(`${rootDir}tmp/node_modules`)) {
                    mkdirSync(`${rootDir}tmp/node_modules`);
                }
            }

            if (!existsSync(`${rootDir}tmp/node_modules/iobroker.js-controller`)) {
                console.log('Copy js-controller...');
                copyFolderRecursiveSync(`${rootDir}node_modules/iobroker.js-controller`, `${rootDir}tmp/node_modules/`);
            }

            console.log('Setup js-controller...');
            let __pid: ChildProcess;
            if (debug) {
                // start controller
                __pid = exec(`node iobroker.js setup first --console`, {
                    cwd: `${rootDir}tmp/node_modules/iobroker.js-controller`,
                });
            } else {
                __pid = fork(`iobroker.js`, ['setup', 'first', '--console'], {
                    cwd: `${rootDir}tmp/node_modules/iobroker.js-controller`,
                    stdio: [0, 1, 2, 'ipc'],
                });
            }
            await waitForEndAsync(__pid);
            await checkIsControllerInstalledAsync();
        } else {
            // check if port 9000 is free, else admin adapter will be added to running instance
            const client = new Socket();
            client.on('error', () => {
                // ignore
            });
            client.connect(9000, '127.0.0.1', () => {
                console.error(
                    'Cannot initiate the first run of test, because one instance of application is running on this PC. Stop it and repeat.',
                );
                process.exit(0);
            });

            await new Promise<void>(resolve => setTimeout(resolve, 1000));
            client.destroy();

            if (!existsSync(`${rootDir}tmp/node_modules/iobroker.js-controller`)) {
                const jsControllerVersion = getJsControllerVersion();
                console.log(`installJsController: no js-controller => install "${jsControllerVersion}" build from npm`);

                execSync(`npm install iobroker.js-controller@${jsControllerVersion} --prefix ./ --omit=dev`, {
                    cwd: `${rootDir}tmp/`,
                    stdio: [0, 1, 2],
                });
            } else {
                console.log('Setup js-controller...');
                let __pid: ChildProcess;
                if (debug) {
                    // start controller
                    __pid = exec(`node iobroker.js setup first`, {
                        cwd: `${rootDir}tmp/node_modules/iobroker.js-controller`,
                    });
                } else {
                    __pid = fork(`iobroker.js`, ['setup', 'first'], {
                        cwd: `${rootDir}tmp/node_modules/iobroker.js-controller`,
                        stdio: [0, 1, 2, 'ipc'],
                    });
                }
                await waitForEndAsync(__pid);
            }

            // let npm install admin and run setup
            await checkIsControllerInstalledAsync();
            let _pid: ChildProcess | undefined;

            if (existsSync(`${rootDir}node_modules/iobroker.js-controller/iobroker.js`)) {
                _pid = fork(`iobroker.js`, ['stop'], {
                    cwd: `${rootDir}node_modules/iobroker.js-controller`,
                    stdio: [0, 1, 2, 'ipc'],
                });
            }

            await waitForEndAsync(_pid);
        }

        // change ports for the object and state DBs
        const config: IoBJson = require(`${rootDir}tmp/iobroker-data/iobroker.json`);
        config.objects.port = 19001;
        config.states.port = 19000;

        writeFileSync(`${rootDir}tmp/iobroker-data/iobroker.json`, JSON.stringify(config, null, 2));
        console.log('Setup finished.');

        copyAdapterToController();
        if (preInstalledAdapters) {
            for (let p = 0; p < preInstalledAdapters.length; p++) {
                await installAdapterAsync(preInstalledAdapters[p]);
            }
        }

        await installAdapterAsync();
        await storeOriginalFiles();
        cb?.(true);
    } else {
        if (preInstalledAdapters) {
            for (let p = 0; p < preInstalledAdapters.length; p++) {
                // if not installed
                const parts = preInstalledAdapters[p].split('@');
                const name = parts[0];
                const version = parts[1];
                if (!existsSync(`${rootDir}tmp/node_modules/${name}`)) {
                    await installAdapterAsync(preInstalledAdapters[p]);
                } else {
                    const pack = require(`${rootDir}tmp/node_modules/${name}/package.json`);
                    if (pack.version !== version) {
                        await installAdapterAsync(preInstalledAdapters[p]);
                    }
                }
            }
        }
        setTimeout(() => {
            console.log('installJsController: js-controller installed');
            cb?.(false);
        }, 0);
    }
}

function copyAdapterToController(): void {
    console.log('Pack adapter...');

    existsSync(`${rootDir}${pkg.name}-${pkg.version}.tgz`) && unlinkSync(`${rootDir}${pkg.name}-${pkg.version}.tgz`);
    existsSync(`${rootDir}tmp/${pkg.name}-${pkg.version}.tgz`) &&
        unlinkSync(`${rootDir}tmp/${pkg.name}-${pkg.version}.tgz`);

    execSync(`npm pack`, {
        cwd: rootDir,
        stdio: [0, 1, 2],
    });
    copyFileSync(`${rootDir}${pkg.name}-${pkg.version}.tgz`, `${rootDir}tmp/${pkg.name}-${pkg.version}.tgz`);
    execSync(`npm install ${pkg.name}-${pkg.version}.tgz --prefix ./ --omit=dev`, {
        cwd: `${rootDir}tmp`,
        stdio: [0, 1, 2],
    });
    console.log('Adapter copied.');

    // update admin files
    execSync(
        `node ${rootDir}tmp/node_modules/iobroker.js-controller/iobroker.js upload ${pkg.name.replace('iobroker.', '')}`,
        {
            cwd: `${rootDir}tmp`,
            stdio: [0, 1, 2],
        },
    );

    console.log('Adapter uploaded.');
}

function installCustomAdapter(customAdapterName: string): void {
    if (!existsSync(`${rootDir}tmp/node_modules/${customAdapterName}`)) {
        console.log(`Install ${customAdapterName}`);
        execSync(`npm install ${customAdapterName} --prefix ./ --omit=dev`, {
            cwd: `${rootDir}tmp/`,
            stdio: [0, 1, 2],
        });
    }
}

function clearControllerLog(): void {
    const dirPath = `${rootDir}tmp/log`;
    let files: string[];
    try {
        if (existsSync(dirPath)) {
            console.log('Clear controller log...');
            files = readdirSync(dirPath);
        } else {
            console.log('Create controller log directory...');
            files = [];
            mkdirSync(dirPath);
        }
    } catch {
        console.error(`Cannot read "${dirPath}"`);
        return;
    }
    if (files.length > 0) {
        try {
            for (let i = 0; i < files.length; i++) {
                const filePath = `${dirPath}/${files[i]}`;
                unlinkSync(filePath);
            }
            console.log('Controller log cleared');
        } catch (err) {
            console.error(`cannot clear log: ${err as Error}`);
        }
    }
}

function clearDB(): void {
    const dirPath = `${rootDir}tmp/iobroker-data/sqlite`;
    let files: string[];
    try {
        if (existsSync(dirPath)) {
            console.log('Clear sqlite DB...');
            files = readdirSync(dirPath);
        } else {
            console.log('Create controller log directory...');
            files = [];
            mkdirSync(dirPath);
        }
    } catch {
        console.error(`Cannot read "${dirPath}"`);
        return;
    }
    if (files.length > 0) {
        try {
            for (let i = 0; i < files.length; i++) {
                const filePath = `${dirPath}/${files[i]}`;
                unlinkSync(filePath);
            }
            console.log('Clear sqlite DB');
        } catch (err) {
            console.error(`cannot clear DB: ${err as Error}`);
        }
    }
}

/**
 * Override options
 *
 * @param options specify attributes which should be overridden
 */
function setOptions(options: LegacyTestingOptions): void {
    if (options.rootDir && existsSync(options.rootDir) && rootDir !== options.rootDir) {
        rootDir = options.rootDir;
        initialize();
    }
}

/**
 * Install js-controller and set up the adapter
 *
 * @param preInstalledAdapters list of adapters which need to be installed additionally
 * @param cb callback
 */
function setupController(
    preInstalledAdapters?: string[] | ((systemConfig: ioBroker.SystemConfigObject) => void) | null,
    cb?: (systemConfig: ioBroker.SystemConfigObject) => void,
): void {
    if (typeof preInstalledAdapters === 'function') {
        cb = preInstalledAdapters;
        preInstalledAdapters = null;
    }

    void installJsController(preInstalledAdapters, async isInitialized => {
        try {
            clearControllerLog();
            clearDB();

            if (!isInitialized) {
                restoreOriginalFiles();
                copyAdapterToController();
            }

            // read system.config object
            const config = await getObject<ioBroker.SystemConfigObject>('system.config');
            systemConfig = config || ({} as ioBroker.SystemConfigObject);
            cb?.(systemConfig);
        } catch (err) {
            console.error(`setupController: ${err as Error}`);
        }
    });
}

async function getObject<T extends ioBroker.Object = ioBroker.Object>(id: string): Promise<T | null | undefined> {
    if (existsSync(`${rootDir}tmp/iobroker-data/objects.json`)) {
        const objs = JSON.parse(readFileSync(`${rootDir}tmp/iobroker-data/objects.json`).toString());
        return objs[id] as T | undefined;
    }
    if (existsSync(`${rootDir}tmp/iobroker-data/objects.jsonl`)) {
        loadJSONLDB();
        const db = new JSONLDB!(`${rootDir}tmp/iobroker-data/objects.jsonl`);
        try {
            await db.open();
        } catch (err) {
            if (err instanceof Error && err.message.includes('Failed to lock DB file')) {
                console.log(`getObject: DB still opened ...`);
            }
            throw err;
        }

        const obj = (db.get(id) as T) || ({} as T);
        await db.close();
        return obj;
    }
    console.error(`setAdapterConfig: No objects file found in datadir ${rootDir}tmp/iobroker-data/`);
    return null;
}

async function setObject(id: string, obj: ioBroker.Object): Promise<ioBroker.Object | null | undefined> {
    if (existsSync(`${rootDir}tmp/iobroker-data/objects.json`)) {
        const objs = JSON.parse(readFileSync(`${rootDir}tmp/iobroker-data/objects.json`).toString());
        objs[id] = obj;
        return undefined;
    }
    if (existsSync(`${rootDir}tmp/iobroker-data/objects.jsonl`)) {
        loadJSONLDB();
        const db = new JSONLDB!(`${rootDir}tmp/iobroker-data/objects.jsonl`);
        try {
            await db.open();
        } catch (err) {
            if (err instanceof Error && err.message.includes('Failed to lock DB file')) {
                console.log(`getObject: DB still opened ...`);
            }
            throw err;
        }

        db.set(id, obj);
        await db.close();
        return obj;
    }
    console.error(`setAdapterConfig: No objects file found in datadir ${rootDir}tmp/iobroker-data/`);
    return null;
}

async function getSecret(): Promise<string | undefined> {
    if (systemConfig) {
        return systemConfig.native.secret as string | undefined;
    }
    systemConfig = (await getObject<ioBroker.SystemConfigObject>('system.config')) ?? null;
    return systemConfig?.native.secret as string | undefined;
}

function encrypt(key: string, value: string): string {
    let result = '';
    for (let i = 0; i < value.length; ++i) {
        result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
    }
    return result;
}

function startAdapter(objects: ObjectsClient, states: StatesClient, callback?: ControllerCallback): void {
    startCustomAdapter();
    callback?.(objects, states);
}

function startCustomAdapter(customAdapterName?: string, adapterInstance?: number): void {
    adapterInstance ||= 0;
    const id = `${customAdapterName || pkg.name.split('.')[1]}.${adapterInstance}`;
    if (adaptersStarted[id]) {
        console.log(`Adapter ${id} already started ...`);
        return;
    }
    adaptersStarted[id] = true;
    console.log(`startAdapter ${id} ...`);
    const _pkg: AdapterPackageJson = customAdapterName
        ? require(`${rootDir}tmp/node_modules/iobroker.${customAdapterName}/package.json`)
        : pkg;
    customAdapterName ||= pkg.name.split('.')[1];
    if (existsSync(`${rootDir}tmp/node_modules/iobroker.${customAdapterName}/${_pkg.main || 'main.js'}`)) {
        try {
            if (debug) {
                // start controller
                pids[id] = exec(
                    `node node_modules/iobroker.${customAdapterName}/${_pkg.main || 'main.js'} ${adapterInstance} --debug --console silly`,
                    {
                        cwd: `${rootDir}tmp`,
                    },
                );
            } else {
                // start controller
                pids[id] = fork(
                    `node_modules/iobroker.${customAdapterName}/${_pkg.main || 'main.js'}`,
                    [String(adapterInstance), '--debug ', '--console', 'silly'],
                    {
                        cwd: `${rootDir}tmp`,
                        stdio: [0, 1, 2, 'ipc'],
                    },
                );
            }
            pids[id].on('exit', (_code: number | null, signal: string) => {
                if (pids[id]) {
                    console.log(`child process terminated 1 due to receipt of signal ${signal}`);
                    const resolve = pids[id].customResolve;
                    if (resolve) {
                        delete pids[id].customResolve;
                    }
                    pids[id] = null;
                    resolve?.();
                }
            });
            pids[id].on('close', () => {
                if (pids[id]) {
                    const resolve = pids[id].customResolve;
                    if (resolve) {
                        delete pids[id].customResolve;
                    }
                    pids[id] = null;
                    resolve?.();
                }
            });
        } catch (error) {
            console.error(JSON.stringify(error));
        }
    } else {
        console.error(
            `Cannot find: ${rootDir}tmp/node_modules/iobroker.${customAdapterName}/${_pkg.main || 'main.js'}`,
        );
    }
}
function startController(
    _isStartAdapter: boolean,
    _onObjectChange: ChangeHandlerObject,
    _onStateChange: ChangeHandlerState,
    _callback?: ControllerCallback,
): void;

function startController(
    _onObjectChange: ChangeHandlerObject,
    _onStateChange: ChangeHandlerState,
    _callback?: ControllerCallback,
): void;

function startController(_isStartAdapter: boolean, _callback?: ControllerCallback): void;

function startController(
    _isStartAdapter?: unknown,
    _onObjectChange?: unknown,
    _onStateChange?: unknown,
    _callback?: unknown,
): void {
    let onObjectChange: ChangeHandlerObject | undefined;
    let onStateChange: ChangeHandlerState | undefined;
    let callback: ControllerCallback | undefined;
    let isStartAdapter = typeof _isStartAdapter === 'boolean' ? _isStartAdapter : true;

    if (typeof _isStartAdapter === 'function') {
        callback = _onStateChange as ControllerCallback;
        _onStateChange = undefined;
        onStateChange = _onObjectChange as ChangeHandlerState;
        _onObjectChange = undefined;
        onObjectChange = _isStartAdapter as ChangeHandlerObject;
        isStartAdapter = true;
    }
    if (_onStateChange === undefined) {
        callback = _onObjectChange as ControllerCallback;
        isStartAdapter = _isStartAdapter as boolean;
        _onObjectChange = undefined;
    }
    if (typeof _onStateChange === 'function') {
        onStateChange = _onStateChange as ChangeHandlerState;
    }
    if (typeof _onObjectChange === 'function') {
        onObjectChange = _onObjectChange as ChangeHandlerObject;
    }
    if (typeof _callback === 'function') {
        callback = _callback as ControllerCallback;
    }

    if (pids.controller) {
        console.error('Controller is already started!');
    } else {
        pids.controller = true;

        console.log('startController...');
        try {
            const config: IoBJson = require(`${rootDir}tmp/iobroker-data/iobroker.json`);

            adaptersStarted[`${pkg.name}.0`] = false;
            let isObjectConnected: boolean;
            let isStatesConnected: boolean;

            // rootDir + 'tmp/node_modules
            const objPath = require.resolve(`@iobroker/db-objects-${config.objects.type}`, {
                paths: [`${rootDir}tmp/node_modules`, rootDir, `${rootDir}tmp/node_modules/iobroker.js-controller`],
            });
            console.log(`Objects Path: ${objPath}`);
            const Objects = require(objPath).Server;
            objects = new Objects({
                connection: {
                    type: config.objects.type,
                    host: '127.0.0.1',
                    port: 19001,
                    user: '',
                    pass: '',
                    noFileCache: false,
                    connectTimeout: 2000,
                },
                logger: {
                    silly: (msg: string) => console.log(msg),
                    debug: (msg: string) => console.log(msg),
                    info: (msg: string) => console.log(msg),
                    warn: (msg: string) => console.warn(msg),
                    error: (msg: string) => console.error(msg),
                },
                connected: () => {
                    isObjectConnected = true;
                    if (isStatesConnected) {
                        console.log('startController: started!');
                        if (isStartAdapter && states && objects) {
                            startAdapter(objects, states, callback);
                        } else if (callback && states && objects) {
                            callback(objects, states);
                            callback = undefined;
                        }
                    }
                },
                change: onObjectChange,
            });

            // Just open in memory DB itself
            const statePath = require.resolve(`@iobroker/db-states-${config.states.type}`, {
                paths: [`${rootDir}tmp/node_modules`, rootDir, `${rootDir}tmp/node_modules/iobroker.js-controller`],
            });
            console.log(`States Path: ${statePath}`);
            const States = require(statePath).Server;
            states = new States({
                connection: {
                    type: config.states.type,
                    host: '127.0.0.1',
                    port: 19000,
                    options: {
                        auth_pass: null,
                        retry_max_delay: 15000,
                    },
                },
                logger: {
                    silly: (msg: string) => console.log(msg),
                    debug: (msg: string) => console.log(msg),
                    info: (msg: string) => console.log(msg),
                    warn: (msg: string) => console.log(msg),
                    error: (msg: string) => console.log(msg),
                },
                connected: () => {
                    isStatesConnected = true;
                    if (isObjectConnected) {
                        console.log('startController: started!!');
                        if (isStartAdapter && states && objects) {
                            startAdapter(objects, states, callback);
                        } else if (callback && states && objects) {
                            callback(objects, states);
                            callback = undefined;
                        }
                    }
                },
                change: onStateChange,
            });
        } catch (err) {
            console.log(err);
        }
    }
}

async function stopAdapter(cb?: () => void): Promise<void> {
    await stopCustomAdapter();
    cb?.();
}

function stopCustomAdapter(customAdapterName?: string, adapterInstance?: number): Promise<void> {
    const id = `${customAdapterName || pkg.name.split('.')[1]}.${adapterInstance || 0}`;
    if (!pids[id]) {
        console.error(`Adapter instance ${id} is not running!`);
        return Promise.resolve();
    }
    adaptersStarted[id] = false;
    return new Promise(resolve => {
        pids[id].customResolve = resolve;
        pids[id].on('exit', (_code: number | null, signal: string) => {
            if (pids[id]) {
                console.log(`child process terminated 3 due to receipt of signal ${signal}`);
                delete pids[id].customResolve;
                pids[id] = null;
                resolve();
            }
        });

        pids[id].on('close', () => {
            if (pids[id]) {
                delete pids[id].customResolve;
                pids[id] = null;
                resolve();
            }
        });

        pids[id].kill('SIGTERM');
    });
}

async function _stopController(): Promise<void> {
    if (objects) {
        await objects.destroy();
        objects = null;
    }
    if (states) {
        await states.destroy();
        states = null;
    }
}

async function stopController(cb?: (normalTerminated: boolean) => void): Promise<void> {
    const instance0: `${string}.0` = `${pkg.name.split('.')[1]}.0`;
    let timeout: NodeJS.Timeout | null;
    if (objects) {
        console.log(`Set system.adapter.${instance0}`);
        let obj = await objects.getObject(`system.adapter.${instance0}`);
        obj ||= {
            _id: `system.adapter.${instance0}`,
            common: {
                enabled: false,
            } as ioBroker.InstanceCommon,
            type: 'instance',
            native: {},
            instanceObjects: [],
            objects: [],
        };
        obj.common ||= {
            enabled: false,
        } as ioBroker.InstanceCommon;
        obj.common.enabled = false;
        await objects.setObject(`system.adapter.${instance0}`, obj);
    }

    void stopAdapter(async (): Promise<void> => {
        if (timeout) {
            clearTimeout(timeout);
            timeout = null;
        }

        await _stopController();

        if (cb) {
            cb(true);
            cb = undefined;
        }
        pids.controller = null;
    });

    timeout = setTimeout(async (): Promise<void> => {
        timeout = null;
        console.log('child process NOT terminated');

        await _stopController();

        if (cb) {
            cb(false);
            cb = undefined;
        }
        pids.controller = null;
    }, 5000);
}

// Set up the adapter
async function setAdapterConfig(
    common?: ioBroker.InstanceObject['common'],
    native?: ioBroker.InstanceObject['native'],
    instance?: number,
    customAdapterName?: string,
): Promise<void> {
    const id = `system.adapter.${(customAdapterName || adapterName).split('.').pop()}.${instance || 0}`;
    const obj = (await getObject<ioBroker.InstanceObject>(id)) || ({} as ioBroker.InstanceObject);
    if (common) {
        obj.common = common;
    }
    if (native) {
        obj.native = native;
    }
    await setObject(id, obj);
}

// Read config of the adapter
async function getAdapterConfig(
    instance?: number,
    customAdapterName?: string,
): Promise<ioBroker.InstanceObject | null | undefined> {
    return getObject<ioBroker.InstanceObject>(
        `system.adapter.${(customAdapterName || adapterName).split('.').pop()}.${instance || 0}`,
    );
}

async function setOfflineState(id: string, state: ioBroker.SettableState): Promise<void> {
    if (existsSync(`${rootDir}tmp/iobroker-data/states.json`)) {
        const statesObj = JSON.parse(readFileSync(`${rootDir}tmp/iobroker-data/states.json`).toString());
        statesObj[id] = state;
        writeFileSync(`${rootDir}tmp/iobroker-data/states.json`, JSON.stringify(objects));
    } else if (existsSync(`${rootDir}tmp/iobroker-data/states.jsonl`)) {
        loadJSONLDB();
        const db = new JSONLDB!(`${rootDir}tmp/iobroker-data/states.jsonl`);
        await db.open();

        db.set(id, state);

        await db.close();
    } else {
        console.error(`setAdapterConfig: No objects file found in datadir ${rootDir}tmp/iobroker-data/`);
    }
}

// Read config of the adapter
async function getOfflineState(id: string): Promise<ioBroker.State | null | undefined> {
    if (existsSync(`${rootDir}tmp/iobroker-data/states.json`)) {
        const statesObj = JSON.parse(readFileSync(`${rootDir}tmp/iobroker-data/states.json`).toString());
        return statesObj[id] as ioBroker.State | undefined;
    }
    if (existsSync(`${rootDir}tmp/iobroker-data/states.jsonl`)) {
        loadJSONLDB();
        const db = new JSONLDB!(`${rootDir}tmp/iobroker-data/states.jsonl`);
        await db.open();

        const state = db.get(id) as ioBroker.State;

        await db.close();
        return state;
    }
    console.error(`getAdapterConfig: No objects file found in datadir ${rootDir}tmp/iobroker-data/`);
    return undefined;
}

export {
    getAdapterConfig,
    setAdapterConfig,
    startController,
    stopController,
    setupController,
    stopAdapter,
    startAdapter,
    installAdapter,
    adapterName,
    getSecret,
    encrypt,
    setOfflineState,
    getOfflineState,
    stopCustomAdapter,
    startCustomAdapter,
    installCustomAdapter,
    getObject,
    setObject,
    setOptions,
    initialize,
};
