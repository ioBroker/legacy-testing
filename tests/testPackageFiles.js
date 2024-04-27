/* jshint -W097 */
/* jshint strict:false */
/* jslint node: true */
/* jshint expr: true */
'use strict';

const expect = require('chai').expect;
const fs     = require('fs');

// node_modules/@iobroker/legacy-testing/tests/testPackageFiles.js
const adapterDir = process.env.IOBROKER_ROOT_DIR || `${__dirname}/../../../../`;
const alternativeAdapterDir = `${__dirname}/../../../../`;

describe('Test package.json and io-package.json', () => {
    it('Test package files', done => {
        console.log();

        const fileContentIOPackage = fs.readFileSync(`${adapterDir}/io-package.json`, 'utf8');
        const ioPackage = JSON.parse(fileContentIOPackage);

        const fileContentNPMPackage = fs.readFileSync(`${adapterDir}/package.json`, 'utf8');
        const npmPackage = JSON.parse(fileContentNPMPackage);

        expect(ioPackage).to.be.an('object');
        expect(npmPackage).to.be.an('object');

        expect(ioPackage.common.version, 'ERROR: Version number in io-package.json needs to exist').to.exist;
        expect(npmPackage.version, 'ERROR: Version number in package.json needs to exist').to.exist;

        expect(ioPackage.common.version, 'ERROR: Version numbers in package.json and io-package.json needs to match').to.be.equal(npmPackage.version);

        if (!ioPackage.common.news || !ioPackage.common.news[ioPackage.common.version]) {
            console.log('WARNING: No news entry for current version exists in io-package.json, no rollback in Admin possible!');
            console.log();
        }

        expect(npmPackage.author, 'ERROR: Author in package.json needs to exist').to.exist;
        expect(ioPackage.common.authors, 'ERROR: Authors in io-package.json needs to exist').to.exist;

        expect(ioPackage.common.license || ioPackage.common.licenseInformation?.license, 'ERROR: License missing in io-package in common.license or in common.licenseInformation.license').to.exist;

        if (ioPackage.common.name.includes('template')) {
            if (Array.isArray(ioPackage.common.authors)) {
                expect(ioPackage.common.authors.length, 'ERROR: Author in io-package.json needs to be set').to.not.be.equal(0);
                if (ioPackage.common.authors.length === 1) {
                    expect(ioPackage.common.authors[0], 'ERROR: Author in io-package.json needs to be a real name').to.not.be.equal('my Name <my@email.com>');
                }
            } else {
                expect(ioPackage.common.authors, 'ERROR: Author in io-package.json needs to be a real name').to.not.be.equal('my Name <my@email.com>');
            }
        } else {
            console.log('WARNING: Testing for set authors field in io-package skipped because template adapter');
            console.log();
        }

        expect(fs.existsSync(`${adapterDir}/README.md`) || fs.existsSync(`${alternativeAdapterDir}/README.md`), 'ERROR: README.md needs to exist! Please create one with description, detail information and changelog. English is mandatory.').to.be.true;

        if (!ioPackage.common.titleLang || typeof ioPackage.common.titleLang !== 'object') {
            console.log('WARNING: titleLang is not existing in io-package.json. Please add');
            console.log();
        }

        if (ioPackage.common.title &&
            (ioPackage.common.title.includes('iobroker') ||
            ioPackage.common.title.includes('ioBroker') ||
            ioPackage.common.title.includes('adapter') ||
            ioPackage.common.title.includes('Adapter'))
        ) {
            console.log('WARNING: title contains Adapter or ioBroker. It is clear anyway, that it is adapter for ioBroker.');
            console.log();
        }

        if (!ioPackage.common.controller && !ioPackage.common.onlyWWW && !ioPackage.common.noConfig) {
            if (ioPackage.common.materialize || (ioPackage.common.adminUI && ioPackage.common.adminUI.conifg === 'materialize')) {
                expect(fs.existsSync(`${adapterDir}/admin/index_m.html`), 'Admin3 support is enabled in io-package.json, but index_m.html is missing!').to.be.true;
            }
            if (ioPackage.common.jsonConfig || (ioPackage.common.adminUI && ioPackage.common.adminUI.conifg === 'json')) {
                expect(fs.existsSync(`${adapterDir}/admin/jsonConfig.json`) || fs.existsSync(`${adapterDir}/admin/jsonConfig.json5`), 'Admin3 support is enabled in io-package.json, but jsonConfig.json(5) is missing!').to.be.true;
            }
            if (ioPackage.common.adminUI && ioPackage.common.adminUI.custom === 'json') {
                expect(fs.existsSync(`${adapterDir}/admin/jsonCustom.json`) || fs.existsSync(`${adapterDir}/admin/jsonCustom.json5`), 'Custom config support is enabled in io-package.json, but jsonCustom.json(5) is missing!').to.be.true;
            }
            if (ioPackage.common.adminUI && ioPackage.common.adminUI.tab === 'html') {
                expect(fs.existsSync(`${adapterDir}/admin/tab.html`) || fs.existsSync(`${adapterDir}/admin/tab_m.html`), 'HTML-Tab support is enabled in io-package.json, but tab(_m).html is missing!').to.be.true;
            }
        }

        const licenseFileExists = fs.existsSync(`${adapterDir}/LICENSE`);
        const fileContentReadme = fs.existsSync(`${alternativeAdapterDir}/README.md`) ? fs.readFileSync(`${alternativeAdapterDir}/README.md`, 'utf8') : fs.readFileSync(`${adapterDir}/README.md`, 'utf8');

        if (!fileContentReadme.includes('## Changelog')) {
            console.log('Warning: The README.md should have a section ## Changelog');
            console.log();
        }

        expect((licenseFileExists || fileContentReadme.includes('## License')), 'A LICENSE must exist as LICENSE file or as part of the README.md').to.be.true;

        if (!licenseFileExists) {
            console.log('Warning: The License should also exist as LICENSE file');
            console.log();
        }

        if (!fileContentReadme.includes('## License')) {
            console.log('Warning: The README.md should also have a section ## License to be shown in Admin3');
            console.log();
        }
        done();
    });
});
