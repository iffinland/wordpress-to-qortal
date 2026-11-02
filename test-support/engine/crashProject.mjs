import { appendFileSync } from 'node:fs';
import { createEngine } from '../../lib/engine/index.js';

const [dataRoot, name = 'Crash Project'] = process.argv.slice(2);

const engine = createEngine({
  dataRoot,
  storeOptions: {
    onBeforeJournalFsync: async ({ payload, journalPath, txnSeq }) => {
      if (txnSeq !== 3) {
        return;
      }
      appendFileSync(journalPath, payload.slice(0, Math.floor(payload.length / 2)));
      process.kill(process.pid, 'SIGKILL');
    }
  }
});

const project = await engine.projects.create({ name });
const handle = await engine.projects.open(project.id);
for (let index = 1; index <= 5; index += 1) {
  await handle.events.emit({
    type: 'progress_updated',
    code: 'CRASH_TEST_EVENT',
    message: `event ${index}`,
    progress: { completed: index, total: 5 }
  });
}
await handle.close();
