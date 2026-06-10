import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
/**
 * The MetaMask build the adapter's selectors are maintained against. Bump
 * deliberately and re-run the real-wallet smoke suite when changing it
 * (`WEB3_TESTER_REAL_WALLET_SMOKE=true npm test`).
 *
 * The adapter is validated end to end against current MetaMask 13.x (the
 * "multichain" UI) and still works on the last 12.x line — the smoke suite
 * passes on both. Set WEB3_TESTER_METAMASK_VERSION=12.23.1 to test the older
 * UI generation.
 */
export const DEFAULT_METAMASK_VERSION = '13.34.1';
export const defaultExtensionCacheDir = () => path.join(os.homedir(), '.cache', 'web3-tester', 'metamask');
const releaseUrl = (version) => `https://github.com/MetaMask/metamask-extension/releases/download/v${version}/metamask-chrome-${version}.zip`;
const unzip = async (zipPath, destination) => {
    const [command, args] = process.platform === 'win32'
        ? [
            'powershell.exe',
            ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destination}' -Force`],
        ]
        : ['unzip', ['-o', '-q', zipPath, '-d', destination]];
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
    });
    const [code] = (await once(child, 'exit'));
    if (code !== 0) {
        throw new Error(`Failed to unzip MetaMask extension (${command} exited with ${code}).\n${stderr}`);
    }
};
/**
 * Downloads and unpacks a pinned MetaMask release into a local cache and
 * returns the unpacked extension directory, suitable for
 * launchRealWallet({ extensionPath }). Subsequent calls hit the cache.
 */
export async function prepareMetaMaskExtension(options = {}) {
    const version = options.version ?? process.env.WEB3_TESTER_METAMASK_VERSION ?? DEFAULT_METAMASK_VERSION;
    const cacheDir = options.cacheDir ?? defaultExtensionCacheDir();
    const destination = path.join(cacheDir, `metamask-chrome-${version}`);
    const manifestPath = path.join(destination, 'manifest.json');
    if (!options.force && fs.existsSync(manifestPath)) {
        return destination;
    }
    const url = options.downloadUrl ?? releaseUrl(version);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download MetaMask ${version} from ${url}: HTTP ${response.status}. ` +
            `Check the version exists (https://github.com/MetaMask/metamask-extension/releases) ` +
            `or set WEB3_TESTER_METAMASK_VERSION / options.version.`);
    }
    const zipBytes = Buffer.from(await response.arrayBuffer());
    if (options.sha256) {
        const actual = createHash('sha256').update(zipBytes).digest('hex');
        if (actual !== options.sha256.toLowerCase()) {
            throw new Error(`MetaMask ${version} download failed integrity check: expected sha256 ${options.sha256}, got ${actual}.`);
        }
    }
    fs.mkdirSync(cacheDir, { recursive: true });
    const zipPath = path.join(cacheDir, `metamask-chrome-${version}.zip`);
    fs.writeFileSync(zipPath, zipBytes);
    // Extract into a staging directory and rename so a partially extracted
    // cache entry can never be mistaken for a complete one.
    const staging = `${destination}.tmp-${process.pid}`;
    fs.rmSync(staging, { recursive: true, force: true });
    try {
        await unzip(zipPath, staging);
        if (!fs.existsSync(path.join(staging, 'manifest.json'))) {
            throw new Error(`MetaMask zip for ${version} did not contain a manifest.json at its root.`);
        }
        fs.rmSync(destination, { recursive: true, force: true });
        fs.renameSync(staging, destination);
    }
    finally {
        fs.rmSync(staging, { recursive: true, force: true });
        fs.rmSync(zipPath, { force: true });
    }
    return destination;
}
/** Reads the version field of an unpacked extension's manifest.json. */
export function extensionManifestVersion(extensionPath) {
    const manifestPath = path.join(extensionPath, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!manifest.version) {
        throw new Error(`No version field in ${manifestPath}.`);
    }
    return manifest.version;
}
//# sourceMappingURL=metamask-extension.js.map