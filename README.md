# legacy-tests
Legacy test modules for ioBroker

**This is a legacy repository. Please use the new test framework `@iobroker/testing` for new adapters** 

## How to replace existing tests
1. add to package.json=>devDependencies: `"@iobroker/legacy-testing": "^0.0.4"`
2. Remove from package.json=>devDependencies: `chai`
3. Replace in `tests/testAdapter.js` the code `const setup  = require('./lib/setup');` with `const setup = require('@iobroker/legacy-testing');`
4. Replace whole file `tests/testPackageFiles.js` with `require('@iobroker/legacy-testing/tests/testPackageFiles');`

## Usage of the specific js-controller version 
Set process.env.JS_CONTROLLER_VERSION to version e.g. `5.0.5-alpha.0-20230617-464b0fd6`

## Changelog
<!-- ### **WORK IN PROGRESS** -->
### **WORK IN PROGRESS**
* (foxriver76) use hardcoded appName instead of inference with a heuristic approach

### 1.0.7 (2023-12-19)
* (foxriver76) allow re-initialization after config change

### 1.0.6 (2023-12-19)
* (foxriver76) allow to specify the `rootDir`

### 1.0.5 (2023-12-15)
* (bluefox) Added support for vis-1 testing

### 1.0.4 (2023-12-15)
* (bluefox) Allowed GUI tests for tab_m.html too

### 1.0.3 (2023-10-26)
* (bluefox) Added helper files to test react admin GUI

### 1.0.1 (2023-10-16)
* (bluefox) Made `common.title` not required

### 1.0.0 (2023-09-18)
* (bluefox) Corrected error if systemConfig requested

### 0.3.7 (2023-07-07)
* (bluefox) Allowed using the specific version of js-controller

### 0.3.6 (2023-05-08)
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

Copyright (c) 2022-2023 bluefox <dogafox@gmail.com>

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
