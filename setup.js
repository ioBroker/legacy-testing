/* jshint -W097 */
/* jshint strict: false */
/* jslint node: true */

// check if tmp directory exists
const fs            = require('fs');
const path          = require('path');
const cp            = require('child_process');
const rootDir       = path.normalize(`${__dirname}/../../../`);
const pkg           = require(`${rootDir}package.json`);
const debug         = typeof v8debug === 'object';
pkg.main = pkg.main || 'main.js';

let JSONLDB;

let adapterName = path.normalize(rootDir).replace(/\\/g, '/').split('/');
adapterName = adapterName[adapterName.length - 2];
const adaptersStarted = {};
const pids = {};

let objects;
let states;
let systemConfig = null;

function getAppName() {
    const parts = rootDir.replace(/\\/g, '/').split('/');
    parts.pop();
    return parts.pop().split('.')[0];
}

const appName = getAppName().toLowerCase();

function loadJSONLDB() {
    if (!JSONLDB) {
        const dbPath = require.resolve('@alcalzone/jsonl-db', {
            paths: [`${rootDir}tmp/node_modules`, rootDir, `${rootDir}tmp/node_modules/${appName}.js-controller`]
        });
        console.log(`JSONLDB path: ${dbPath}`);
        try {
            const { JsonlDB } = require(dbPath);
            JSONLDB = JsonlDB;
        } catch (err) {
            console.log(`Jsonl require error: ${err}`);
        }
    }
}

function copyFileSync(source, target) {
    let targetFile = target;

    //if target is a directory a new file with the same name will be created
    if (fs.existsSync(target) && fs.lstatSync(target).isDirectory() ) {
        targetFile = path.join(target, path.basename(source));
    }

    try {
        fs.writeFileSync(targetFile, fs.readFileSync(source));
    } catch (err) {
        console.log(`file copy error: ${source} -> ${targetFile} (error ignored)`);
    }
}

function copyFolderRecursiveSync(source, target, ignore) {
    let files = [];

    let base = path.basename(source);
    if (base === adapterName) {
        base = pkg.name;
    }
    //check if folder needs to be created or integrated
    const targetFolder = path.join(target, base);
    if (!fs.existsSync(targetFolder)) {
        fs.mkdirSync(targetFolder);
    }

    //copy
    if (fs.lstatSync(source).isDirectory()) {
        files = fs.readdirSync(source);
        files.forEach(file => {
            if (ignore && ignore.includes(file)) {
                return;
            }

            const curSource = path.join(source, file);
            const curTarget = path.join(targetFolder, file);
            if (fs.lstatSync(curSource).isDirectory()) {
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

!fs.existsSync(`${rootDir}tmp`) && fs.mkdirSync(`${rootDir}tmp`);

async function storeOriginalFiles() {
    console.log('Store original files...');
    const dataDir = `${rootDir}tmp/${appName}-data/`;

    if (fs.existsSync(`${dataDir}objects.json`)) {
        const f = fs.readFileSync(`${dataDir}objects.json`);
        const objects = JSON.parse(f.toString());
        if (objects['system.adapter.admin.0'] && objects['system.adapter.admin.0'].common) {
            objects['system.adapter.admin.0'].common.enabled = false;
        }
        if (objects['system.adapter.admin.1'] && objects['system.adapter.admin.1'].common) {
            objects['system.adapter.admin.1'].common.enabled = false;
        }

        fs.writeFileSync(`${dataDir}objects.json.original`, JSON.stringify(objects));
        console.log('Store original objects.json');
    }

    if (fs.existsSync(`${dataDir}states.json`)) {
        try {
            const f = fs.readFileSync(`${dataDir}states.json`);
            fs.writeFileSync(`${dataDir}states.json.original`, f);
            console.log('Store original states.json');
        } catch (err) {
            console.log('no states.json found - ignore');
        }
    }

    if (fs.existsSync(`${dataDir}objects.jsonl`)) {
        loadJSONLDB();
        const db = new JSONLDB(`${dataDir}objects.jsonl`);
        await db.open();

        const admin0 = db.get('system.adapter.admin.0');
        if (admin0) {
            if (admin0.common) {
                admin0.common.enabled = false;
                db.set('system.adapter.admin.0', admin0);
            }
        }

        const admin1 = db.get('system.adapter.admin.1');
        if (admin1) {
            if (admin1.common) {
                admin1.common.enabled = false;
                db.set('system.adapter.admin.1', admin1);
            }
        }
        await db.close();

        const f = fs.readFileSync(`${dataDir}objects.jsonl`);
        fs.writeFileSync(`${dataDir}objects.jsonl.original`, f);
        console.log('Store original objects.jsonl');
    }

    if (fs.existsSync(`${dataDir}states.jsonl`)) {
        const f = fs.readFileSync(`${dataDir}states.jsonl`);
        fs.writeFileSync(`${dataDir}states.jsonl.original`, f);
        console.log('Store original states.jsonl');
    }
}

function restoreOriginalFiles() {
    console.log('restoreOriginalFiles...');
    const dataDir = `${rootDir}tmp/${appName}-data/`;

    if (fs.existsSync(`${dataDir}objects.json.original`)) {
        const f = fs.readFileSync(`${dataDir}objects.json.original`);
        fs.writeFileSync(`${dataDir}objects.json`, f);
    }
    if (fs.existsSync(`${dataDir}objects.json.original`)) {
        const f = fs.readFileSync(`${dataDir}states.json.original`);
        fs.writeFileSync(`${dataDir}states.json`, f);
    }

    if (fs.existsSync(`${dataDir}objects.jsonl.original`)) {
        const f = fs.readFileSync(`${dataDir}objects.jsonl.original`);
        fs.writeFileSync(`${dataDir}objects.jsonl`, f);
    }
    if (fs.existsSync(`${dataDir}objects.jsonl.original`)) {
        const f = fs.readFileSync(`${dataDir}states.jsonl.original`);
        fs.writeFileSync(`${dataDir}states.jsonl`, f);
    }
}

async function checkIsAdapterInstalled(cb, counter, customAdapterName, customInstance) {
    customAdapterName = customAdapterName || pkg.name.split('.').pop();
    counter = counter || 0;
    console.log(`[${customAdapterName}] checkIsAdapterInstalled...`);

    try {
        const obj = await getObject(`system.adapter.${customAdapterName}.${customInstance || 0}`);
        if (obj && obj.common) {
            console.log(`[${customAdapterName}] checkIsAdapterInstalled: ready! ${JSON.stringify(obj)}`);
            setTimeout(() => cb && cb(), 100);
            return;
        }
        console.warn(`[${customAdapterName}] checkIsAdapterInstalled: still not ready`);
    } catch (err) {
        console.log(`[${customAdapterName}] checkIsAdapterInstalled: catch ${err}`);
    }

    if (counter > 20) {
        console.error(`[${customAdapterName}] checkIsAdapterInstalled: Cannot install!`);
        cb && cb('Cannot install');
    } else {
        console.log(`[${customAdapterName}] checkIsAdapterInstalled: wait...`);
        setTimeout(() => checkIsAdapterInstalled(cb, counter + 1, customAdapterName, customInstance), 1000);
    }
}

function checkIsAdapterInstalledAsync(counter, customAdapterName, customInstance) {
    return new Promise((resolve, reject) => {
        checkIsAdapterInstalled(err => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        }, counter, customAdapterName, customInstance);
    });
}

async function checkIsControllerInstalled(cb, counter) {
    counter = counter || 0;

    console.log('checkIsControllerInstalled...');
    try {
        const obj = await getObject('system.certificates');
        if (obj && obj.common) {
            console.log('checkIsControllerInstalled: installed!');
            setTimeout(() => cb && cb(), 100);
            return;
        }
    } catch (err) {
        // ignore
    }

    if (counter > 20) {
        console.log('checkIsControllerInstalled: Cannot install!');
        cb && cb('Cannot install');
    } else {
        console.log('checkIsControllerInstalled: wait...');
        setTimeout(() => checkIsControllerInstalled(cb, counter + 1), 1000);
    }
}

function checkIsControllerInstalledAsync(counter) {
    return new Promise((resolve, reject) => {
        checkIsControllerInstalled(err => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        }, counter);
    });
}

async function installAdapter(customAdapterName, cb) {
    if (typeof customAdapterName === 'function') {
        cb = customAdapterName;
        customAdapterName = null;
    }
    customAdapterName = customAdapterName || pkg.name;
    console.log(`[${customAdapterName}] Install adapter...`);

    if (customAdapterName.includes('@')) {
        installCustomAdapter(customAdapterName);
    }

    const startFile = `node_modules/${appName}.js-controller/${appName}.js`;
    // make first install
    if (debug) {
        cp.execSync(`node ${startFile} add ${customAdapterName} --enabled false`, {
            cwd:   `${rootDir}tmp`,
            stdio: [0, 1, 2],
        });
    } else {
        // add controller
        const _pid = cp.fork(startFile, ['add', customAdapterName, '--enabled', 'false'], {
            cwd:   `${rootDir}tmp`,
            stdio: [0, 1, 2, 'ipc'],
        });

        await waitForEndAsync(_pid);
    }

    const name = (customAdapterName.split('@')[0]).split('.').pop(); // extract from iobroker.adaptername@version => adaptername

    try {
        await checkIsAdapterInstalledAsync(null, name);
    } catch (err) {
        console.warn(`[${customAdapterName}] Adapter not installed: ${err}`);
        // try workaround
        installCustomAdapter(customAdapterName);
        // make first install
        if (debug) {
            cp.execSync(`node ${startFile} add ${customAdapterName} --enabled false`, {
                cwd:   `${rootDir}tmp`,
                stdio: [0, 1, 2],
            });
        } else {
            // add controller
            const _pid = cp.fork(startFile, ['add', customAdapterName, '--enabled', 'false'], {
                cwd:   `${rootDir}tmp`,
                stdio: [0, 1, 2, 'ipc'],
            });

            await waitForEndAsync(_pid);
        }
        await checkIsAdapterInstalledAsync(null, name);
    }
    console.log(`[${customAdapterName}] Adapter installed.`);
    cb && cb();
}

function installAdapterAsync(customAdapterName) {
    return new Promise(resolve =>
        installAdapter(customAdapterName, () => resolve()));
}

function waitForEnd(_pid, cb) {
    if (!_pid) {
        cb(-1, -1);
    } else {
        _pid.on('exit', (code, signal) => {
            if (_pid) {
                _pid = null;
                cb(code, signal);
            }
        });
        _pid.on('close', (code, signal) => {
            if (_pid) {
                _pid = null;
                cb(code, signal);
            }
        });
    }
}

function waitForEndAsync(_pid) {
    if (!_pid) {
        return {code: -1, signal: -1};
    } else {
        return new Promise(resolve => {
            _pid.on('exit', (code, signal) => {
                if (_pid) {
                    _pid = null;
                    resolve({code, signal});
                }
            });
            _pid.on('close', (code, signal) => {
                if (_pid) {
                    _pid = null;
                    resolve({code, signal});
                }
            });
        });
    }
}

async function installJsController(preInstalledAdapters, cb) {
    if (typeof preInstalledAdapters === 'function') {
        cb = preInstalledAdapters;
        preInstalledAdapters = null;
    }

    console.log('installJsController...');
    if (!fs.existsSync(`${rootDir}tmp/node_modules/${appName}.js-controller`) ||
        !fs.existsSync(`${rootDir}tmp/${appName}-data`)) {
        // try to detect appName.js-controller in node_modules/appName.js-controller
        // travis CI installs js-controller into node_modules
        if (fs.existsSync(`${rootDir}node_modules/${appName}.js-controller`)) {
            console.log(`installJsController: no js-controller => copy it from "${rootDir}node_modules/${appName}.js-controller"`);
            // copy all
            // stop the controller
            console.log('Stop controller if running...');
            let _pid;
            if (debug) {
                // start controller
                _pid = cp.exec(`node ${appName}.js stop`, {
                    cwd: `${rootDir}node_modules/${appName}.js-controller`,
                    stdio: [0, 1, 2],
                });
            } else {
                _pid = cp.fork(`${appName}.js`, ['stop'], {
                    cwd:   `${rootDir}node_modules/${appName}.js-controller`,
                    stdio: [0, 1, 2, 'ipc'],
                });
            }

            await waitForEndAsync(_pid);
            // copy all files into
            !fs.existsSync(`${rootDir}tmp`) && fs.mkdirSync(`${rootDir}tmp`);
            !fs.existsSync(`${rootDir}tmp/node_modules`) && fs.mkdirSync(`${rootDir}tmp/node_modules`);

            if (!fs.existsSync(`${rootDir}tmp/node_modules/${appName}.js-controller`)){
                console.log('Copy js-controller...');
                copyFolderRecursiveSync(`${rootDir}node_modules/${appName}.js-controller`, `${rootDir}tmp/node_modules/`);
            }

            console.log('Setup js-controller...');
            let __pid;
            if (debug) {
                // start controller
                __pid = cp.exec(`node ${appName}.js setup first --console`, {
                    cwd: `${rootDir}tmp/node_modules/${appName}.js-controller`,
                    stdio: [0, 1, 2]
                });
            } else {
                __pid = cp.fork(`${appName}.js`, ['setup', 'first', '--console'], {
                    cwd:   `${rootDir}tmp/node_modules/${appName}.js-controller`,
                    stdio: [0, 1, 2, 'ipc']
                });
            }
            await waitForEnd(__pid);
            await checkIsControllerInstalledAsync();
        } else {
            // check if port 9000 is free, else admin adapter will be added to running instance
            const {Socket} = require('net')
            const client = new Socket();
            client.on('error', () => {
            });
            client.connect(9000, '127.0.0.1', () => {
                console.error('Cannot initiate the first run of test, because one instance of application is running on this PC. Stop it and repeat.');
                process.exit(0);
            });

            await new Promise(resolve => setTimeout(resolve, 1000));
            client.destroy();

            if (!fs.existsSync(`${rootDir}tmp/node_modules/${appName}.js-controller`)) {
                console.log('installJsController: no js-controller => install dev build from npm');

                cp.execSync(`npm install ${appName}.js-controller@dev --prefix ./ --production`, {
                    cwd: `${rootDir}tmp/`,
                    stdio: [0, 1, 2],
                });
            } else {
                console.log('Setup js-controller...');
                let __pid;
                if (debug) {
                    // start controller
                    __pid = cp.exec(`node ${appName}.js setup first`, {
                        cwd: `${rootDir}tmp/node_modules/${appName}.js-controller`,
                        stdio: [0, 1, 2],
                    });
                } else {
                    __pid = cp.fork(`${appName}.js`, ['setup', 'first'], {
                        cwd: `${rootDir}tmp/node_modules/${appName}.js-controller`,
                        stdio: [0, 1, 2, 'ipc'],
                    });
                }
                await waitForEnd(__pid);
            }

            // let npm install admin and run setup
            await checkIsControllerInstalledAsync();
            let _pid;

            if (fs.existsSync(`${rootDir}node_modules/${appName}.js-controller/${appName}.js`)) {
                _pid = cp.fork(`${appName}.js`, ['stop'], {
                    cwd: `${rootDir}node_modules/${appName}.js-controller`,
                    stdio: [0, 1, 2, 'ipc']
                });
            }

            await waitForEndAsync(_pid);
        }

        // change ports for the object and state DBs
        const config = require(`${rootDir}tmp/${appName}-data/${appName}.json`);
        config.objects.port = 19001;
        config.states.port  = 19000;

        fs.writeFileSync(`${rootDir}tmp/${appName}-data/${appName}.json`, JSON.stringify(config, null, 2));
        console.log('Setup finished.');

        copyAdapterToController();
        if (preInstalledAdapters) {
            for (let p = 0; p < preInstalledAdapters.length; p++) {
                await installAdapterAsync(preInstalledAdapters[p]);
            }
        }

        await installAdapterAsync();
        await storeOriginalFiles();
        cb && cb(true);
    } else {
        setTimeout(() => {
            console.log('installJsController: js-controller installed');
            cb && cb(false);
        }, 0);
    }
}

function copyAdapterToController() {
    console.log('Copy adapter...');
    // Copy adapter to tmp/node_modules/appName.adapter
    copyFolderRecursiveSync(rootDir, `${rootDir}tmp/node_modules/`, ['.github', '.idea', 'test', 'tmp', '.git', 'src', 'src-widgets', `${appName}.js-controller`]);
    console.log('Adapter copied.');
}

function installCustomAdapter(adapterName) {
    if (!fs.existsSync(`${rootDir}tmp/node_modules/${adapterName}`)) {
        console.log(`Install ${adapterName}`);
        cp.execSync(`npm install ${adapterName} --prefix ./ --production`, {
            cwd:   `${rootDir}tmp/`,
            stdio: [0, 1, 2],
        });
    }
}

function clearControllerLog() {
    const dirPath = `${rootDir}tmp/log`;
    let files;
    try {
        if (fs.existsSync(dirPath)) {
            console.log('Clear controller log...');
            files = fs.readdirSync(dirPath);
        } else {
            console.log('Create controller log directory...');
            files = [];
            fs.mkdirSync(dirPath);
        }
    } catch(e) {
        console.error(`Cannot read "${dirPath}"`);
        return;
    }
    if (files.length > 0) {
        try {
            for (let i = 0; i < files.length; i++) {
                const filePath = `${dirPath}/${files[i]}`;
                fs.unlinkSync(filePath);
            }
            console.log('Controller log cleared');
        } catch (err) {
            console.error(`cannot clear log: ${err}`);
        }
    }
}

function clearDB() {
    const dirPath = `${rootDir}tmp/iobroker-data/sqlite`;
    let files;
    try {
        if (fs.existsSync(dirPath)) {
            console.log('Clear sqlite DB...');
            files = fs.readdirSync(dirPath);
        } else {
            console.log('Create controller log directory...');
            files = [];
            fs.mkdirSync(dirPath);
        }
    } catch(e) {
        console.error(`Cannot read "${dirPath}"`);
        return;
    }
    if (files.length > 0) {
        try {
            for (let i = 0; i < files.length; i++) {
                const filePath = `${dirPath}/${files[i]}`;
                fs.unlinkSync(filePath);
            }
            console.log('Clear sqlite DB');
        } catch (err) {
            console.error(`cannot clear DB: ${err}`);
        }
    }
}

function setupController(preInstalledAdapters, cb) {
    installJsController(preInstalledAdapters, async isInitialized => {
        try {
            clearControllerLog();
            clearDB();

            if (!isInitialized) {
                restoreOriginalFiles();
                copyAdapterToController();
            }

            // read system.config object
            const config = await getObject('system.config');
            systemConfig = config || {};
            cb && cb(systemConfig);
        } catch (err) {
            console.error(`setupController: ${err}`);
        }
    });
}

async function getObject(id){
    if (fs.existsSync(`${rootDir}tmp/${appName}-data/objects.json`)) {
        const objects = JSON.parse(fs.readFileSync(`${rootDir}tmp/${appName}-data/objects.json`).toString());
        return objects[id];
    } else if (fs.existsSync(`${rootDir}tmp/${appName}-data/objects.jsonl`)) {
        loadJSONLDB();
        const db = new JSONLDB(`${rootDir}tmp/${appName}-data/objects.jsonl`);
        try {
            await db.open();
        } catch (err) {
            if (err.message.includes('Failed to lock DB file')) {
                console.log(`getObject: DB still opened ...`);
            }
            throw err;
        }

        const obj = db.get(id) || {};
        await db.close();
        return obj;
    } else {
        console.error(`setAdapterConfig: No objects file found in datadir ${rootDir}tmp/${appName}-data/`);
        return null;
    }
}

async function setObject(id, obj){
    if (fs.existsSync(`${rootDir}tmp/${appName}-data/objects.json`)) {
        const objects = JSON.parse(fs.readFileSync(`${rootDir}tmp/${appName}-data/objects.json`).toString());
        objects[id] = obj;
    } else if (fs.existsSync(`${rootDir}tmp/${appName}-data/objects.jsonl`)) {
        loadJSONLDB();
        const db = new JSONLDB(`${rootDir}tmp/${appName}-data/objects.jsonl`);
        try {
            await db.open();
        } catch (err) {
            if (err.message.includes('Failed to lock DB file')) {
                console.log(`getObject: DB still opened ...`);
            }
            throw err;
        }

        db.set(id, obj);
        await db.close();
        return obj;
    } else {
        console.error(`setAdapterConfig: No objects file found in datadir ${rootDir}tmp/${appName}-data/`);
        return null;
    }
}

async function getSecret() {
    if (systemConfig) {
        return systemConfig.native.secret;
    }
    systemConfig = await getObject('system.config');
    return systemConfig.native.secret;
}

function encrypt (key, value) {
    let result = '';
    for (let i = 0; i < value.length; ++i) {
        result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
    }
    return result;
}

function startAdapter(objects, states, callback) {
    startCustomAdapter();
    callback && callback(objects, states);
}

function startCustomAdapter(adapterName, adapterInstance) {
    adapterInstance = adapterInstance || 0;
    const id = `${adapterName || pkg.name}.${adapterInstance}`;
    if (adaptersStarted[id]) {
        console.log(`Adapter ${id} already started ...`);
        return;
    }
    adaptersStarted[id] = true;
    console.log(`startAdapter ${id} ...`);
    const _pkg = adapterName ? require(`${rootDir}tmp/node_modules/iobroker.${adapterName}/package.json`) : pkg;
    adapterName = adapterName || pkg.name;
    if (fs.existsSync(`${rootDir}tmp/node_modules/iobroker.${adapterName}/${_pkg.main || 'main.js'}`)) {
        try {
            if (debug) {
                // start controller
                pids[id] = cp.exec(`node node_modules/iobroker.${adapterName}/${_pkg.main || 'main.js'} ${adapterInstance} --debug --console silly`, {
                    cwd: `${rootDir}tmp`,
                    stdio: [0, 1, 2],
                });
            } else {
                // start controller
                pids[id] = cp.fork(`node_modules/iobroker.${adapterName}/${_pkg.main || 'main.js'}`, [adapterInstance, '--debug ', '--console', 'silly'], {
                    cwd:   `${rootDir}tmp`,
                    stdio: [0, 1, 2, 'ipc'],
                });
            }
        } catch (error) {
            console.error(JSON.stringify(error));
        }
    } else {
        console.error(`Cannot find: ${rootDir}tmp/node_modules/iobroker.${adapterName}/${_pkg.main || 'main.js'}`);
    }
}

function startController(isStartAdapter, onObjectChange, onStateChange, callback) {
    if (typeof isStartAdapter === 'function') {
        callback = onStateChange;
        onStateChange = onObjectChange;
        onObjectChange = isStartAdapter;
        isStartAdapter = true;
    }

    if (onStateChange === undefined) {
        callback  = onObjectChange;
        onObjectChange = undefined;
    }

    if (pids[`${pkg.name}.0`]) {
        console.error('Controller is already started!');
    } else {
        console.log('startController...');
        try {
            const config = require(`${rootDir}tmp/${appName}-data/${appName}.json`);

            adaptersStarted[`${pkg.name}.0`] = false;
            let isObjectConnected;
            let isStatesConnected;

            // rootDir + 'tmp/node_modules
            const objPath = require.resolve(`@iobroker/db-objects-${config.objects.type}`, {
                paths: [`${rootDir}tmp/node_modules`, rootDir, `${rootDir}tmp/node_modules/${appName}.js-controller`]
            });
            console.log(`Objects Path: ${objPath}`);
            const Objects = require(objPath).Server;
            objects = new Objects({
                connection: {
                    'type': config.objects.type,
                    'host': '127.0.0.1',
                    'port': 19001,
                    'user': '',
                    'pass': '',
                    'noFileCache': false,
                    'connectTimeout': 2000
                },
                logger: {
                    silly: msg => console.log(msg),
                    debug: msg => console.log(msg),
                    info: msg => console.log(msg),
                    warn: msg => console.warn(msg),
                    error: msg => console.error(msg)
                },
                connected: () => {
                    isObjectConnected = true;
                    if (isStatesConnected) {
                        console.log('startController: started!');
                        if (isStartAdapter) {
                            startAdapter(objects, states, callback);
                        } else {
                            if (callback) {
                                callback(objects, states);
                                callback = null;
                            }
                        }
                    }
                },
                change: onObjectChange
            });

            // Just open in memory DB itself
            const statePath = require.resolve(`@iobroker/db-states-${config.states.type}`, {
                paths: [ `${rootDir}tmp/node_modules`, rootDir, `${rootDir}tmp/node_modules/${appName}.js-controller`]
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
                        retry_max_delay: 15000
                    }
                },
                logger: {
                    silly: function (msg) {
                        console.log(msg);
                    },
                    debug: function (msg) {
                        console.log(msg);
                    },
                    info: function (msg) {
                        console.log(msg);
                    },
                    warn: function (msg) {
                        console.log(msg);
                    },
                    error: function (msg) {
                        console.log(msg);
                    }
                },
                connected: function () {
                    isStatesConnected = true;
                    if (isObjectConnected) {
                        console.log('startController: started!!');
                        if (isStartAdapter) {
                            startAdapter(objects, states, callback);
                        } else {
                            if (callback) {
                                callback(objects, states);
                                callback = null;
                            }
                        }
                    }
                },
                change: onStateChange
            });
        } catch (err) {
            console.log(err);
        }
    }
}

function stopAdapter(cb) {
    const id = `${pkg.name}.0`;
    if (!pids[id]) {
        console.error('Controller is not running!');
        cb && setTimeout(() => cb(false), 0);
    } else {
        adaptersStarted[id] = false;
        pids[id].on('exit', (code, signal) => {
            if (pids[id]) {
                console.log(`child process terminated due to receipt of signal ${signal}`);
                cb && cb();
                pids[id] = null;
            }
        });

        pids[id].on('close', (/* code, signal */) => {
            if (pids[id]) {
                cb && cb();
                pids[id] = null;
            }
        });

        pids[id].kill('SIGTERM');
    }
}

function stopCustomAdapter(adapterName, adapterInstance) {
    const id = `${adapterName}.${adapterInstance || 0}`;
    if (!pids[id]) {
        console.error(`Adapter instance ${id} is not running!`);
        return Promise.resolve();
    } else {
        adaptersStarted[id] = false;
        return new Promise(resolve => {
            pids[id].on('exit', (code, signal) => {
                if (pids[id]) {
                    console.log(`child process terminated due to receipt of signal ${signal}`);
                    pids[id] = null;
                    resolve();
                }
            });

            pids[id].on('close', (/* code, signal */) => {
                if (pids[id]) {
                    pids[id] = null;
                    resolve();
                }
            });

            pids[id].kill('SIGTERM');
        });
    }
}

function _stopController() {
    if (objects) {
        objects.destroy();
        objects = null;
    }
    if (states) {
        states.destroy();
        states = null;
    }
}

function stopController(cb) {
    let timeout;
    if (objects) {
        console.log(`Set system.adapter.${pkg.name}.0`);
        objects.setObject(`system.adapter.${pkg.name}.0`, {
            common: {
                enabled: false,
            },
        });
    }

    stopAdapter(() => {
        if (timeout) {
            clearTimeout(timeout);
            timeout = null;
        }

        _stopController();

        if (cb) {
            cb(true);
            cb = null;
        }
    });

    timeout = setTimeout(() => {
        timeout = null;
        console.log('child process NOT terminated');

        _stopController();

        if (cb) {
            cb(false);
            cb = null;
        }
        pids[`${pkg.name}.0`] = null;
    }, 5000);
}

// Set up the adapter
async function setAdapterConfig(common, native, instance, customAdapterName) {
    const id = `system.adapter.${(customAdapterName || adapterName).split('.').pop()}.${instance || 0}`;
    const obj = (await getObject(id)) || {};
    if (common) {
        obj.common = common;
    }
    if (native) {
        obj.native = native;
    }
    await setObject(id, obj);
}

// Read config of the adapter
async function getAdapterConfig(instance, customAdapterName) {
    return getObject(`system.adapter.${(customAdapterName || adapterName).split('.').pop()}.${instance || 0}`);
}

async function setOfflineState(id, state) {
    if (fs.existsSync(`${rootDir}tmp/${appName}-data/states.json`)) {
        const states = JSON.parse(fs.readFileSync(`${rootDir}tmp/${appName}-data/states.json`).toString());
        states[id] = state;
        fs.writeFileSync(`${rootDir}tmp/${appName}-data/states.json`, JSON.stringify(objects));
    } else if (fs.existsSync(`${rootDir}tmp/${appName}-data/states.jsonl`)) {
        loadJSONLDB();
        const db = new JSONLDB(`${rootDir}tmp/${appName}-data/states.jsonl`);
        await db.open();

        db.set(id, state);

        await db.close();
    } else {
        console.error(`setAdapterConfig: No objects file found in datadir ${rootDir}tmp/${appName}-data/`);
    }
}

// Read config of the adapter
async function getOfflineState(id) {
    if (fs.existsSync(`${rootDir}tmp/${appName}-data/states.json`)) {
        const states = JSON.parse(fs.readFileSync(`${rootDir}tmp/${appName}-data/states.json`).toString());
        return states[id];
    } else if (fs.existsSync(`${rootDir}tmp/${appName}-data/states.jsonl`)) {
        loadJSONLDB();
        const db = new JSONLDB(`${rootDir}tmp/${appName}-data/states.jsonl`);
        await db.open();

        const state = db.get(id);

        await db.close();
        return state;
    } else {
        console.error(`getAdapterConfig: No objects file found in datadir ${rootDir}tmp/${appName}-data/`);
    }
}

if (typeof module !== undefined && module.parent) {
    module.exports.getAdapterConfig = getAdapterConfig;
    module.exports.setAdapterConfig = setAdapterConfig;
    module.exports.startController = startController;
    module.exports.stopController = stopController;
    module.exports.setupController = setupController;
    module.exports.stopAdapter = stopAdapter;
    module.exports.startAdapter = startAdapter;
    module.exports.installAdapter = installAdapter;
    module.exports.appName = appName;
    module.exports.adapterName = adapterName;
    module.exports.getSecret = getSecret;
    module.exports.encrypt = encrypt;
    module.exports.setOfflineState = setOfflineState;
    module.exports.getOfflineState = getOfflineState;
    module.exports.stopCustomAdapter = stopCustomAdapter;
    module.exports.startCustomAdapter = startCustomAdapter;
    module.exports.installCustomAdapter = installCustomAdapter;
    module.exports.getObject = getObject;
    module.exports.setObject = setObject;
}
