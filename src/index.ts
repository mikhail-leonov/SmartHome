import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { networkInterfaces } from 'os';
import pc from 'picocolors';
import Twig from 'twig';

const logger = console;

const packageJsonPath = path.join(process.cwd(), 'package.json');
let SERVER_VERSION = 'unknown';
try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    SERVER_VERSION = packageJson.version || 'unknown';
} catch (err) {
    logger.error(pc.red('Could not read package.json version'));
}

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

function getLocalIpAddress(): string {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name] || []) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

Twig.cache(false);
app.set('views', path.join(process.cwd(), 'src/views'));
app.set('view engine', 'twig');

app.use('/public', express.static(path.join(__dirname, '..', 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    res.render('index');
});

const server = app.listen(PORT, '0.0.0.0', () => {
    const localUrl = `http://localhost:${PORT}`;
    const networkUrl = `http://${getLocalIpAddress()}:${PORT}`;
    logger.error(pc.green(`FB2 Manager v${SERVER_VERSION} listening on:`));
    logger.error(pc.green(` - Local:   ${localUrl}`));
    logger.error(pc.green(` - Network: ${networkUrl}`));
});

async function shutdown() {
    logger.error(pc.green('Shutting down gracefully...'));
    await new Promise<void>((resolve) => {
        server.close(() => {
            logger.info(pc.green('HTTP server closed'));
            resolve();
        });
    });
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);