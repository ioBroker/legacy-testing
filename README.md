# legacy-tests
Legacy test modules for ioBroker

**This is a legacy repository. Please use the new test framework `@iobroker/testing` for new adapters** 

## How to replace existing tests
1. add to package.json=>devDependencies: `"@iobroker/legacy-testing": "^0.0.4"`
2. Remove from package.json=>devDependencies: `chai`
3. Replace in `tests/testAdapter.js` the code `const setup  = require('./lib/setup');` with `const setup = require('@iobroker/legacy-testing');`
4. Replace whole file `tests/testPackageFiles.js` with `require('@iobroker/legacy-testing/tests/testPackageFiles');`

## Changelog
<!-- ### **WORK IN PROGRESS** -->
### 0.2.6 (2023-05-07)
* (bluefox) Added possibility to install additional adapters at start
* (bluefox) Added setOfflineState/getOfflineState

### 0.1.1 (2022-12-22)
* (bluefox) Extended testPackageFiles.js with checks

### 0.1.0 (2022-12-22)
* (bluefox) Corrected testPackageFiles.js

### 0.0.4 (2022-11-21)
* (bluefox) Added testPackageFiles.js

### 0.0.3 (2022-11-21)
* (bluefox) initial release

## License
MIT License

Copyright (c) 2022 bluefox <dogafox@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
