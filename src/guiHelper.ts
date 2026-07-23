/* This file helps to start and stop the browser and make screenshots of desired adapter
 * Do not forget to include in package.json:
 * "devDependencies": {
 *    "puppeteer": "^21.4.1",
 *    "colorette": "^1.2.1"
 * }
 **/
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { blue, cyan, red, yellow } from 'colorette';
import { existsSync, mkdirSync } from 'node:fs';
import { get } from 'node:http';

type Colorize = (text: string | number) => string;

let gBrowser: Browser | undefined;
let gPage: Page | undefined;

/**
 * The admin adapter reports "alive" before its web server accepts connections, so on slow
 * machines the first page load can fail with ERR_CONNECTION_REFUSED. Poll the server until
 * it answers (any HTTP status counts as ready). After the timeout the navigation is
 * attempted anyway, so the real error is still reported by the page load itself.
 */
function waitForServer(baseUrl: string, timeoutMs: number): Promise<void> {
    return new Promise(resolve => {
        const started = Date.now();
        let waitingReported = false;

        const tryOnce = (): void => {
            const request = get(baseUrl, response => {
                response.resume();
                resolve();
            });
            request.setTimeout(2000, () => request.destroy(new Error('timeout')));
            request.on('error', () => {
                if (Date.now() - started >= timeoutMs) {
                    console.log(
                        yellow(
                            `Web server at ${baseUrl} did not accept connections within ${Math.round(timeoutMs / 1000)} seconds`,
                        ),
                    );
                    resolve();
                } else {
                    if (!waitingReported) {
                        waitingReported = true;
                        console.log(`Waiting for the web server at ${baseUrl} to accept connections...`);
                    }
                    setTimeout(tryOnce, 500);
                }
            });
        };

        tryOnce();
    });
}

/**
 * This function starts the browser and opens the desired adapter
 *
 * @param adapterName could be just an adapter name or adapter name with path, like 'device-manager/tab_m.html'
 * @param rootDir the root directory of the project
 * @param headless whether the browser should be started in headless mode
 * @param pathUrl optional URL path to open instead of the default adapter page
 */
export async function startBrowser(
    adapterName: string,
    rootDir: string,
    headless?: boolean,
    pathUrl?: string,
): Promise<{ browser: Browser; page: Page }> {
    if (!rootDir.endsWith('/')) {
        rootDir += '/';
    }

    const browser = await puppeteer.launch({
        headless: headless === undefined ? false : headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const pages = await browser.pages();
    const timeout = 5000;
    pages[0].setDefaultTimeout(timeout);

    await pages[0].setViewport({
        width: 1920,
        height: 1080,
        deviceScaleFactor: 1,
    });

    gBrowser = browser;
    gPage = pages[0];

    // LOGGING
    gPage
        .on('console', message => {
            const type = message.type().substring(0, 3).toUpperCase();
            const colors: Record<string, Colorize> = {
                LOG: (text: string | number) => `${text}`,
                ERR: red,
                WAR: yellow,
                INF: cyan,
            };

            const color = colors[type] || blue;
            console.log(color(`[BROWSER] ${type} ${message.text()}`));
        })
        .on('pageerror', ({ message }) => console.log(red(`[BROWSER] ${message}`)));

    pathUrl ||= `/adapter/${adapterName.includes('/') ? (!adapterName.includes('?') ? `${adapterName}?` : adapterName) : `${adapterName}/index_m.html?`}&newReact=true&0&react=dark`;
    if (!pathUrl.startsWith('/')) {
        pathUrl = `/${pathUrl}`;
    }

    const baseUrl = 'http://127.0.0.1:8081';
    await waitForServer(baseUrl, 30_000);
    await gPage.goto(`${baseUrl}${pathUrl}`, { waitUntil: 'domcontentloaded' });

    // Create directory
    !existsSync(`${rootDir}tmp/screenshots`) && mkdirSync(`${rootDir}tmp/screenshots`);
    await gPage.screenshot({ path: `${rootDir}tmp/screenshots/00_starting.png` });

    return { browser, page: pages[0] };
}

export async function stopBrowser(browser?: Browser): Promise<void> {
    browser ||= gBrowser;
    await browser?.close();
}

export async function screenshot(rootDir: string, page?: Page, fileName?: string): Promise<void> {
    if (!rootDir.endsWith('/')) {
        rootDir += '/';
    }
    page ||= gPage;
    await page?.screenshot({ path: `${rootDir}tmp/screenshots/${fileName}.png` });
}
