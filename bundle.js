const fs = require('fs');
const path = require('path');
const browserify = require('browserify');

browserify(path.join(__dirname, 'node_modules/mediasoup-client/lib/index.js'), { standalone: 'mediasoup' })
    .bundle()
    .pipe(fs.createWriteStream(path.join(__dirname, 'src/public', 'mediasoup-client-bundle.js')));