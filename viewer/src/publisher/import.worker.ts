/// <reference lib="webworker" />
import {
  buildFolderMap,
  buildFolderMapFromZip,
  validateHandoffPackage,
} from "./handoff";
self.onmessage = async (
  event: MessageEvent<{ files: File[]; zip: boolean }>,
) => {
  try {
    self.postMessage({
      phase: "Reading package",
      detail: "Unpacking and checking file sizes…",
    });
    const files = event.data.zip
      ? await buildFolderMapFromZip(event.data.files[0])
      : await buildFolderMap(event.data.files);
    self.postMessage({
      phase: "Validating package",
      detail: "Checking the manifest, dependencies and every file hash…",
    });
    self.postMessage({ result: await validateHandoffPackage(files) });
  } catch (error) {
    self.postMessage({ error: (error as Error).message });
  }
};
