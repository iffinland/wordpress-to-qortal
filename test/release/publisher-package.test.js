import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,copyFile,readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {unzipSync} from 'fflate';
test('Publisher ZIP preserves fixed DOS timestamps across build timezones',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'publisher-package-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(path.join(root,'scripts'),{recursive:true});
 await mkdir(path.join(root,'viewer/dist-publisher/assets'),{recursive:true});
 await copyFile(new URL('../../scripts/createPublisherQappZip.js',import.meta.url),path.join(root,'scripts/createPublisherQappZip.mjs'));
 await writeFile(path.join(root,'viewer/package.json'),JSON.stringify({version:'0.8.0-beta.2'}));
 await writeFile(path.join(root,'viewer/dist-publisher/index.html'),'<html>Publisher</html>');
 await writeFile(path.join(root,'viewer/dist-publisher/assets/main.js'),'console.log("fixed");');
 // Make the installed fflate package resolvable from the isolated packaging fixture.
 const {symlink}=await import('node:fs/promises');
 await symlink(path.resolve(import.meta.dirname,'../../node_modules'),path.join(root,'node_modules'),'dir');
 const results=[];
 for(const TZ of ['UTC','Europe/Helsinki','America/New_York','Asia/Tokyo']){
  const result=JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/createPublisherQappZip.mjs')],{env:{...process.env,TZ},encoding:'utf8'}));
  const bytes=await readFile(result.zip);results.push({result,bytes});
  const entries=unzipSync(bytes);
  assert.equal(new TextDecoder().decode(entries['index.html']),'<html>Publisher</html>');
  assert.equal((bytes.readUInt16LE(10)>>11)&31,2);
 }
 for(const result of results.slice(1)){
  assert.deepEqual(result.bytes,results[0].bytes);
  assert.equal(result.result.sha256,results[0].result.sha256);
 }
});
