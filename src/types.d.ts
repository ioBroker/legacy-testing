/*
 * Ambient module declarations for the optional peer packages used by `guiHelper`.
 * These packages are intentionally NOT dependencies of this module - the adapter
 * under test provides them (see the comment at the top of `guiHelper.ts`).
 * The declarations below only describe the small surface that is used here so the
 * project can be type-checked without installing puppeteer/colorette.
 * In a consumer project the real type definitions of these packages take precedence.
 */
declare module 'puppeteer' {
    export interface ConsoleMessage {
        type(): string;
        text(): string;
    }

    export interface Page {
        setDefaultTimeout(timeout: number): void;
        setViewport(viewport: { width: number; height: number; deviceScaleFactor?: number }): Promise<void>;
        on(event: 'console', handler: (message: ConsoleMessage) => void): Page;
        on(event: 'pageerror', handler: (error: { message: string }) => void): Page;
        goto(url: string, options?: { waitUntil?: string }): Promise<void>;
        screenshot(options: { path: string }): Promise<void>;
    }

    export interface Browser {
        pages(): Promise<Page[]>;
        close(): Promise<void>;
    }

    export interface LaunchOptions {
        headless?: boolean;
        args?: string[];
    }

    export function launch(options?: LaunchOptions): Promise<Browser>;

    const puppeteer: { launch: typeof launch };
    export default puppeteer;
}

declare module 'colorette' {
    export type Color = (text: string | number) => string;
    export const blue: Color;
    export const cyan: Color;
    export const red: Color;
    export const yellow: Color;
}
