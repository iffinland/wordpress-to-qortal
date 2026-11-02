import { appendFileSync } from 'node:fs';
import { JournalStore } from '../../lib/engine/storage/journal.js';

const [root, mode = 'torn'] = process.argv.slice(2);

const store = await JournalStore.open({
  root,
  compactEveryTransactions: 1000,
  onBeforeJournalFsync: async ({ payload, journalPath, txnSeq }) => {
    if (txnSeq !== 3) {
      return;
    }
    // Simulate a process killed between writing transaction bytes and fsync.
    appendFileSync(journalPath, mode === 'torn' ? payload.slice(0, Math.floor(payload.length / 2)) : payload);
    process.kill(process.pid, 'SIGKILL');
  }
});

for (let index = 1; index <= 5; index += 1) {
  await store.transaction((draft) => {
    draft.counters.crash = index;
  });
}
await store.close();
