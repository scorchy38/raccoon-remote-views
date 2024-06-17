const NodeMediaServer = require('node-media-server');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mediasoup = require('mediasoup');

const config = {
    rtmp: {
        port: 1935,
        chunk_size: 60000,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60
    },
    http: {
        port: 8000,
        allow_origin: '*'
    }
};

const nms = new NodeMediaServer(config);
nms.run();

const app = express();
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // Replace with your allowed origins
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

app.get('/rtpCapabilities', (req, res) => {
    if (router) {
        res.json(router.rtpCapabilities);
    } else {
        res.status(404).send('Router not initialized');
    }
});

const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: '*', // Replace with the origin(s) you want to allow
        methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true,
    },
});
app.use(express.static('server/public')); // Serve static files from public directory


let worker;
let router;
let producerTransport;
let producer;
let consumerTransport;
let consumer;

const createWorker = async () => {
    worker = await mediasoup.createWorker();
    worker.on('died', () => {
        console.error('mediasoup worker has died');
        setTimeout(() => process.exit(1), 2000);
    });
};

const createRouter = async () => {
    router = await worker.createRouter({
        mediaCodecs: [
            {
                kind: 'video',
                mimeType: 'video/VP8',
                clockRate: 90000,
            }
        ],
    });
};

const createTransport = async () => {
    const transport = await router.createWebRtcTransport({
        listenIps: [{ ip: '0.0.0.0', announcedIp: 'PUBLIC IP' }],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
    });

    transport.on('dtlsstatechange', (dtlsState) => {
        if (dtlsState === 'closed') {
            transport.close();
        }
    });

    return transport;
};

io.on('connection', async (socket) => {
    socket.on('getRouterRtpCapabilities', (callback) => {
        callback(router.rtpCapabilities);
    });

    socket.on('createProducerTransport', async (callback) => {
        producerTransport = await createTransport();
        callback({
            id: producerTransport.id,
            iceParameters: producerTransport.iceParameters,
            iceCandidates: producerTransport.iceCandidates,
            dtlsParameters: producerTransport.dtlsParameters,
        });
    });

    socket.on('createConsumerTransport', async (callback) => {
        consumerTransport = await createTransport();
        callback({
            id: consumerTransport.id,
            iceParameters: consumerTransport.iceParameters,
            iceCandidates: consumerTransport.iceCandidates,
            dtlsParameters: consumerTransport.dtlsParameters,
        });
    });

    socket.on('connectProducerTransport', async ({ dtlsParameters }, callback) => {
        await producerTransport.connect({ dtlsParameters });
        callback();
    });

    socket.on('produce', async ({ kind, rtpParameters }, callback) => {
        producer = await producerTransport.produce({ kind, rtpParameters });
        callback({ id: producer.id });
    });

    socket.on('connectConsumerTransport', async ({ dtlsParameters }, callback) => {
        await consumerTransport.connect({ dtlsParameters });
        callback();
    });

    socket.on('consume', async ({ rtpCapabilities }, callback) => {
        if (router.canConsume({ producerId: producer.id, rtpCapabilities })) {
            consumer = await consumerTransport.consume({
                producerId: producer.id,
                rtpCapabilities,
            });
            callback({
                id: consumer.id,
                kind: consumer.kind,
                rtpParameters: consumer.rtpParameters,
            });
        } else {
            callback({ error: 'Cannot consume' });
        }
    });
});

const runMediasoup = async () => {
    await createWorker();
    await createRouter();
};

runMediasoup();

server.listen(3000, () => {
    console.log('Server is running on port 3000');
});
