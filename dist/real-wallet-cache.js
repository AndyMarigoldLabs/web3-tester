import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mnemonicToAccount } from 'viem/accounts';
import { extensionManifestVersion } from './metamask-extension.js';
import { passwordForSetup } from './real-wallet-setup.js';
import { launchRealWallet, resolveRealWalletProfile, } from './real-wallet.js';
const READY_MARKER = '.web3-tester-profile-ready';
// Chromium singleton artifacts must never travel with a cloned profile.
const SINGLETON_FILES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
/**
 * Polls the profile's extension storage (IndexedDB leveldb + blob and Local
 * Extension Settings) from Node until a write newer than `since` lands and
 * the directories stay quiet for `quietMs`. Times out silently — the
 * onboarding dwell remains the backstop.
 */
export async function waitForExtensionStatePersisted(profileDir, extensionId, options = {}) {
    const since = options.since ?? Date.now();
    const quietMs = options.quietMs ?? 1_500;
    const timeoutMs = options.timeoutMs ?? 15_000;
    // A consumer profileDir can itself be a Chrome "Default"/"Profile N"
    // directory; resolve the actual profile root the same way launch does.
    const profile = resolveRealWalletProfile(profileDir);
    const root = profile.profileDirectory
        ? path.join(profile.userDataDir, profile.profileDirectory)
        : path.join(profile.userDataDir, 'Default');
    const watched = [
        path.join(root, 'IndexedDB', `chrome-extension_${extensionId}_0.indexeddb.leveldb`),
        path.join(root, 'IndexedDB', `chrome-extension_${extensionId}_0.indexeddb.blob`),
        path.join(root, 'Local Extension Settings', extensionId),
    ];
    const newestWrite = () => {
        let newest = 0;
        for (const dir of watched) {
            let entries;
            try {
                entries = fs.readdirSync(dir);
            }
            catch {
                continue;
            }
            for (const entry of entries) {
                try {
                    const mtime = fs.statSync(path.join(dir, entry)).mtimeMs;
                    if (mtime > newest)
                        newest = mtime;
                }
                catch {
                    // File rotated away mid-scan.
                }
            }
        }
        return newest;
    };
    const deadline = Date.now() + timeoutMs;
    let lastSeen = 0;
    let quietSince = 0;
    while (Date.now() < deadline) {
        const newest = newestWrite();
        if (newest > since) {
            if (newest !== lastSeen) {
                lastSeen = newest;
                quietSince = Date.now();
            }
            else if (Date.now() - quietSince >= quietMs) {
                return;
            }
        }
        await sleep(250);
    }
}
export const defaultProfileCacheDir = () => path.join(os.homedir(), '.cache', 'web3-tester', 'profiles');
const cacheKey = (options) => createHash('sha256')
    .update(JSON.stringify({
    seedPhrase: options.setup.seedPhrase,
    password: passwordForSetup(options.setup),
    extensionVersion: extensionManifestVersion(options.extensionPath),
    customizeKey: options.customize?.key,
}))
    .digest('hex')
    .slice(0, 16);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * Builds (once) and returns a cached, fully onboarded MetaMask profile
 * directory keyed by (seed phrase, password, extension version). The first
 * call walks MetaMask onboarding in a real browser; subsequent calls return
 * instantly. Use cloneWalletProfile to obtain a disposable per-test copy —
 * never launch the cached directory directly.
 */
export async function buildWalletProfile(options) {
    if (!options.setup.seedPhrase) {
        throw new Error('buildWalletProfile requires setup.seedPhrase.');
    }
    const cacheDir = options.cacheDir ?? defaultProfileCacheDir();
    const profileDir = path.join(cacheDir, cacheKey(options));
    const marker = path.join(profileDir, READY_MARKER);
    if (options.force) {
        fs.rmSync(profileDir, { recursive: true, force: true });
    }
    else if (fs.existsSync(marker)) {
        return profileDir;
    }
    // mkdir is atomic: exactly one concurrent builder wins the lock; the rest
    // wait for the ready marker. Locks left behind by killed builders are
    // considered stale after 5 minutes and stolen.
    const lockDir = `${profileDir}.lock`;
    const lockIsStale = () => {
        try {
            return Date.now() - fs.statSync(lockDir).mtimeMs > 300_000;
        }
        catch {
            return false;
        }
    };
    fs.mkdirSync(cacheDir, { recursive: true });
    try {
        fs.mkdirSync(lockDir);
    }
    catch {
        if (lockIsStale()) {
            fs.rmSync(lockDir, { recursive: true, force: true });
            return buildWalletProfile(options);
        }
        const deadline = Date.now() + 180_000;
        while (Date.now() < deadline) {
            if (fs.existsSync(marker)) {
                return profileDir;
            }
            if (!fs.existsSync(lockDir) || lockIsStale()) {
                // The builder died without producing a profile; take over.
                fs.rmSync(lockDir, { recursive: true, force: true });
                return buildWalletProfile(options);
            }
            await sleep(250);
        }
        throw new Error(`Timed out waiting for another process to finish building the wallet profile at ${profileDir}.`);
    }
    // Builds with a customize hook can exceed the 5-minute stale-lock
    // threshold; refresh the lock mtime so a waiting worker never steals it
    // mid-build.
    const heartbeat = setInterval(() => {
        try {
            const now = new Date();
            fs.utimesSync(lockDir, now, now);
        }
        catch {
            // Lock already gone — the finally below is about to run anyway.
        }
    }, 60_000);
    heartbeat.unref?.();
    try {
        fs.rmSync(profileDir, { recursive: true, force: true });
        fs.mkdirSync(profileDir, { recursive: true });
        const session = await launchRealWallet({
            extensionPath: options.extensionPath,
            profileDir,
            setup: options.setup,
            headless: options.headless,
            // Verifying against the seed-derived address guarantees the build
            // actually imported a wallet — a silently skipped onboarding would
            // otherwise produce a cached profile with no vault.
            expectedAddress: mnemonicToAccount(options.setup.seedPhrase).address,
        });
        if (options.customize) {
            const mutationsStartedAt = Date.now();
            await options.customize.run(session);
            // 13.x flushes extension state to IndexedDB on a debounce: dwell past
            // the debounce window (the same fix onboarding needs), then wait for
            // the post-mutation write to land and go quiet before closing — a
            // missed flush silently loses the customization.
            await sleep(3_000);
            await waitForExtensionStatePersisted(profileDir, session.extensionId, {
                since: mutationsStartedAt,
                quietMs: 3_000,
                timeoutMs: 20_000,
            });
        }
        await session.close();
        fs.writeFileSync(marker, JSON.stringify({ createdAt: new Date().toISOString() }));
        return profileDir;
    }
    catch (error) {
        fs.rmSync(profileDir, { recursive: true, force: true });
        throw error;
    }
    finally {
        clearInterval(heartbeat);
        fs.rmSync(lockDir, { recursive: true, force: true });
    }
}
/**
 * Copies a cached profile into a disposable directory (per test or per
 * worker) so parallel runs never collide on Chromium's profile singleton
 * lock and tests cannot dirty the cache.
 */
export async function cloneWalletProfile(cachedProfileDir, targetDir) {
    if (!fs.existsSync(path.join(cachedProfileDir, READY_MARKER))) {
        throw new Error(`${cachedProfileDir} is not a completed web3-tester profile cache (missing ${READY_MARKER}).`);
    }
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.cpSync(cachedProfileDir, targetDir, { recursive: true });
    for (const file of [READY_MARKER, ...SINGLETON_FILES]) {
        fs.rmSync(path.join(targetDir, file), { force: true });
    }
    return targetDir;
}
//# sourceMappingURL=real-wallet-cache.js.map