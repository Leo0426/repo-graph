import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { benchmarkResultsPath } from './benchmark.js';
import { createBackup, RecoveryError, restoreBackup, verifyBackup } from './recovery.js';

const [command, first, second, ...extra] = process.argv.slice(2);
if (!command || command === '--help') {
    console.log('Usage: npm run recovery -- backup <new-directory> | verify <backup> | restore <backup> <new-directory>');
} else {
    try {
        let result: unknown;
        if (!first || extra.length) throw new RecoveryError('RECOVERY_INVALID_COMMAND');
        if (command === 'backup' && !second) {
            const database = resolve(process.env.REPOGRAPH_DB_PATH ?? join(homedir(), '.repograph', 'typescript', 'index.db'));
            result = await createBackup({ database, assets: process.env.REPOGRAPH_ASSETS_ROOT ?? database + '-assets',
                benchmark: benchmarkResultsPath(database), projectsRoot: process.env.REPOGRAPH_PROJECTS_ROOT }, first);
        } else if (command === 'verify' && !second) result = await verifyBackup(first);
        else if (command === 'restore' && second) result = await restoreBackup(first, second);
        else throw new RecoveryError('RECOVERY_INVALID_COMMAND');
        console.log(JSON.stringify(result));
    } catch (error) {
        const fsCode = (error as NodeJS.ErrnoException).code;
        const code = error instanceof RecoveryError ? error.message : fsCode === 'EEXIST' ? 'RECOVERY_DESTINATION_EXISTS'
            : fsCode === 'ENOENT' ? 'RECOVERY_INPUT_MISSING' : 'RECOVERY_IO_FAILED';
        console.error(JSON.stringify({ error: code }));
        process.exitCode = code === 'RECOVERY_INVALID_COMMAND' ? 2 : 1;
    }
}
